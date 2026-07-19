#!/usr/bin/env python3
"""Scraper-health canary — detect silent /pre-audit scraper rot.

The public FB/IG scrapers can break silently when Meta changes markup or
tightens soft-blocks; because collection is fail-soft, a fully rotted scraper
still produces a confident-looking report from empty passes. This canary probes
the primary collectors against known-stable public targets and reports, per
pass, whether the *primary* path still parses — separately from whether the
Tavily fallback saved it.

Run weekly (cron) or on demand:

    python scraper_health.py [--fb nasa] [--ig nasa] [--site https://www.nasa.gov]

Exit codes: 0 = all primary paths healthy · 1 = a primary FB/IG path rotted
(fallback may still be covering) · 2 = a pass returned no data at all.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
try:
    from load_env import load_env
    load_env()
except Exception:  # noqa: BLE001 — canary must run even without the env helper
    pass

import collectors  # noqa: E402
import tavily  # noqa: E402


def _classify(pass_name: str, res: dict, signal_keys: list[str]) -> dict:
    status = res.get("status", "unknown")
    via = "tavily" if res.get("collected_via") == "tavily" else (
        "primary" if status == "ok" else "none")
    signal_ok = any(res.get(k) not in (None, "", False) for k in signal_keys)
    return {
        "pass": pass_name,
        "status": status,
        "via": via,
        "signal_ok": signal_ok,
        "primary_ok": via == "primary" and signal_ok,
        "primary_status": res.get("primary_status"),
    }


def main() -> None:
    p = argparse.ArgumentParser(description="Probe /pre-audit scrapers for silent rot")
    p.add_argument("--fb", default="nasa", help="stable public FB page handle")
    p.add_argument("--ig", default="nasa", help="stable public IG handle")
    p.add_argument("--site", default="https://www.nasa.gov", help="stable public website")
    args = p.parse_args()

    now = datetime.now(timezone.utc)
    now_ts = int(now.timestamp())

    fb = _classify("facebook", collectors.collect_facebook(args.fb), ["likes", "talking_about"])
    ig = _classify("instagram", collectors.collect_instagram(args.ig, now_ts=now_ts),
                   ["followers", "posts_total"])
    site = _classify("website", collectors.collect_website(args.site),
                     ["viewport_meta", "external_scripts"])

    passes = [fb, ig, site]
    scraper_passes = [fb, ig]  # the gray-zone paths most prone to rot
    primary_rot = [x["pass"] for x in scraper_passes if not x["primary_ok"]]
    no_data = [x["pass"] for x in passes if x["via"] == "none"]

    health = "ok" if not primary_rot else ("down" if no_data else "degraded")
    report = {
        "checked_at": now.isoformat(),
        "health": health,
        "tavily_available": tavily.available(),
        "primary_rot": primary_rot,
        "no_data": no_data,
        "passes": passes,
    }
    print(json.dumps(report, indent=2))
    sys.exit(2 if no_data else (1 if primary_rot else 0))


if __name__ == "__main__":
    main()
