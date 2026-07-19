#!/usr/bin/env python3
"""/pre-audit stage 1 — COLLECT.

Runs all four public-data passes for a prospect and writes stable, overwritable
raw files into ``prospects/<slug>/data/raw/``. Deterministic filenames (no
timestamps) so re-running a prospect refreshes in place and the downstream
``normalize.py`` → ``build.py`` → render chain stays reproducible.

    python collect.py <slug> --fb <url> [--ig <handle>] [--site <url>]
        [--competitor <url> ...] [--country US] [--days 90] [--audit-date ISO]

Each pass fails soft: a blocked/absent surface is recorded with its ``status``
and never fabricated. The Ad Library passes need ``META_ACCESS_TOKEN``; without
it they are skipped (status ``no_token``) and the rest of the audit continues.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import load_env  # noqa: E402

load_env()

import collectors  # noqa: E402
import client as adlib  # noqa: E402
import classifier  # noqa: E402
from normalize import ad_metrics  # noqa: E402 — shared deterministic ad-metric calc


def _raw_dir(slug: str) -> Path:
    root = Path(__file__).resolve().parent.parent.parent
    import os
    if os.environ.get("SMOS_DATA_ROOT"):
        root = Path(os.environ["SMOS_DATA_ROOT"]).resolve()
    d = root / "prospects" / slug / "data" / "raw"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False))
    print(f"[collect] wrote {path.name} ({path.stat().st_size:,} bytes)")


def _collect_ads(page_url: str, label: str, country: str, days: int, token: str) -> dict:
    """Resolve a page id from a URL and pull its Ad Library ads (raw envelope)."""
    try:
        pid = adlib.resolve_page_id_from_url(page_url, country=country, token=token)
        if not pid:
            return {"status": "page_id_unresolved", "url": page_url, "data": []}
        ads = adlib.fetch_ads_for_page_id(pid, label, country, days, token)
        return {"status": "ok", "url": page_url, "page_id": pid, "data": ads}
    except Exception as exc:  # noqa: BLE001 — fail soft, never abort the audit
        return {"status": f"error:{type(exc).__name__}", "url": page_url, "data": []}


def main() -> None:
    p = argparse.ArgumentParser(description="Collect public pre-audit signals for a prospect")
    p.add_argument("slug")
    p.add_argument("--fb", help="Facebook page URL or handle")
    p.add_argument("--ig", help="Instagram handle or URL")
    p.add_argument("--site", help="Website URL")
    p.add_argument("--competitor", action="append", default=[], help="Competitor FB URL (repeatable)")
    p.add_argument("--country", default="US")
    p.add_argument("--days", type=int, default=90)
    p.add_argument("--audit-date", help="ISO date; defaults to now (drives IG recency)")
    args = p.parse_args()

    raw = _raw_dir(args.slug)
    audit_dt = (
        datetime.fromisoformat(args.audit_date.replace("Z", "+00:00"))
        if args.audit_date else datetime.now(timezone.utc)
    )
    now_ts = int(audit_dt.timestamp())
    fetched_at = audit_dt.astimezone(timezone.utc).isoformat()

    manifest = {"slug": args.slug, "fetched_at": fetched_at, "country": args.country,
                "window_days": args.days, "audit_date": audit_dt.date().isoformat()}

    # Pass 1a / 1b / 5 — organic + tracking surface
    fb = collectors.collect_facebook(args.fb) if args.fb else {"status": "not_found"}
    fb["fetched_at"] = fetched_at
    _write(raw / "facebook.json", fb)

    ig = collectors.collect_instagram(args.ig, now_ts=now_ts) if args.ig else {"status": "not_found"}
    ig["fetched_at"] = fetched_at
    _write(raw / "instagram.json", ig)

    site = collectors.collect_website(args.site) if args.site else {"status": "not_found"}
    site["fetched_at"] = fetched_at
    _write(raw / "website.json", site)

    # Pass 2 & 3 — Ad Library (self + competitors)
    import os
    token = os.environ.get("META_ACCESS_TOKEN", "")
    if not token:
        print("[collect] META_ACCESS_TOKEN not set — Ad Library passes skipped (status no_token).")
        self_ads = {"status": "no_token", "data": []}
        comp_ads = {"status": "no_token", "competitors": []}
    else:
        self_ads = _collect_ads(args.fb, args.slug, args.country, args.days, token) if args.fb \
            else {"status": "not_found", "data": []}
        comps = []
        cache_dir = Path(".cache/meta-ad-library")
        has_llm = bool(os.environ.get("ANTHROPIC_API_KEY"))
        if args.competitor and not has_llm:
            print("[collect] ANTHROPIC_API_KEY not set — competitor creative_matrix scoring skipped.")
        for url in args.competitor:
            res = _collect_ads(url, url, args.country, args.days, token)
            # LLM-score the creative approach (content-cached ⇒ reproducible). Fail-soft.
            if has_llm and res.get("data"):
                name = res["data"][0].get("page_name") or url
                stats = ad_metrics(res["data"], now_ts)
                matrix = classifier.score_creative_matrix(name, res["data"], cache_dir, stats)
                if matrix:
                    res["creative_matrix"] = matrix
            comps.append(res)
        comp_ads = {"status": "ok" if comps else "none", "competitors": comps}
    self_ads["fetched_at"] = fetched_at
    comp_ads["fetched_at"] = fetched_at
    _write(raw / "ads_self.json", self_ads)
    _write(raw / "ads_competitors.json", comp_ads)

    _write(raw / "manifest.json", manifest)
    print(json.dumps({"slug": args.slug, "raw_dir": str(raw),
                      "passes": {"facebook": fb["status"], "instagram": ig["status"],
                                 "website": site["status"], "ads_self": self_ads["status"],
                                 "ads_competitors": comp_ads["status"]}}, indent=2))


if __name__ == "__main__":
    main()
