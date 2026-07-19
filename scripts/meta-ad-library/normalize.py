#!/usr/bin/env python3
"""/pre-audit stage 2 — NORMALIZE.

Flattens the raw pass files in ``prospects/<slug>/data/raw/`` into a single
long-format ledger ``prospects/<slug>/data/signals.csv`` — one row per signal:

    slug,pass,entity,metric,value,unit,status,source,fetched_at

The long shape is the reconciliation between "the source of truth is a CSV a
human can open in Sheets" and "the report data is deeply nested": nested keys
become dotted ``metric`` paths (``meta_pixel.installed``, ``format_mix.VID``,
``creative_matrix.hook_strength``) that ``build.py`` re-inflates. Missing or
blocked signals are emitted with their ``status`` rather than dropped, so the
ledger never implies absence it did not observe.

This stage is the single point where the raw ad envelopes are turned into the
quantitative ad metrics (active/new/age/survival/format-mix) — computed here,
deterministically, from delivery timestamps.

    python normalize.py <slug> [--audit-date ISO]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ["slug", "pass", "entity", "metric", "value", "unit", "status", "source", "fetched_at"]


def _root() -> Path:
    if os.environ.get("SMOS_DATA_ROOT"):
        return Path(os.environ["SMOS_DATA_ROOT"]).resolve()
    return Path(__file__).resolve().parent.parent.parent


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def _infer_format(ad: dict) -> str:
    if "video" in (ad.get("ad_snapshot_url") or "").lower():
        return "VID"
    if len(ad.get("ad_creative_bodies") or []) > 1:
        return "CAR"
    return "IMG"


def _epoch(v) -> int | None:
    if not v:
        return None
    try:
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def ad_metrics(ads: list[dict], now_ts: int) -> dict:
    """Deterministic quantitative ad metrics from raw Ad Library ads."""
    if not ads:
        return {"active_ads_last_90d": 0, "new_ads_last_14d": 0,
                "avg_creative_age_days": None, "survival_past_60d_pct": None, "format_mix": {}}
    active, new14, ages, survived, fmt = 0, 0, [], 0, {}
    for ad in ads:
        start = _epoch(ad.get("ad_delivery_start_time"))
        stop = _epoch(ad.get("ad_delivery_stop_time"))
        is_active = not ad.get("ad_delivery_stop_time")
        if is_active:
            active += 1
        if start and (now_ts - start) <= 14 * 86400:
            new14 += 1
        if start:
            end = stop or now_ts
            age_days = max(0, (end - start) / 86400)
            ages.append(age_days)
            if age_days >= 60:
                survived += 1
        f = _infer_format(ad)
        fmt[f] = fmt.get(f, 0) + 1
    return {
        "active_ads_last_90d": active,
        "new_ads_last_14d": new14,
        "avg_creative_age_days": round(sum(ages) / len(ages)) if ages else None,
        "survival_past_60d_pct": round(100 * survived / len(ads), 1) if ads else None,
        "format_mix": fmt,
    }


def _flatten(prefix: str, obj, unit_hint: str = "") -> list[tuple[str, str, str]]:
    """(metric, value, unit) rows from a nested dict/scalar, skipping meta keys."""
    rows: list[tuple[str, str, str]] = []
    skip = {"status", "fetched_at", "url", "data", "competitors", "page_id"}
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in skip:
                continue
            rows += _flatten(f"{prefix}.{k}" if prefix else k, v, unit_hint)
    else:
        if obj is None:
            return rows
        unit = "bool" if isinstance(obj, bool) else (
            "count" if isinstance(obj, int) else
            "rate" if isinstance(obj, float) else "text")
        rows.append((prefix, str(obj), unit))
    return rows


def build_rows(slug: str, raw: Path, now_ts: int) -> list[dict]:
    rows: list[dict] = []

    def add(pass_, entity, metric, value, unit, status, source, fetched_at):
        rows.append({"slug": slug, "pass": pass_, "entity": entity, "metric": metric,
                     "value": "" if value is None else value, "unit": unit,
                     "status": status, "source": source or "", "fetched_at": fetched_at or ""})

    for pass_, fname in [("facebook", "facebook.json"), ("instagram", "instagram.json"),
                         ("website", "website.json")]:
        d = _load(raw / fname)
        status = d.get("status", "not_found")
        src, fa = d.get("url", ""), d.get("fetched_at", "")
        if status == "ok":
            for metric, value, unit in _flatten("", d):
                add(pass_, "self", metric, value, unit, "ok", src, fa)
        else:
            add(pass_, "self", "_status", status, "text", status, src, fa)

    # Ad Library — self
    self_env = _load(raw / "ads_self.json")
    s_status, s_fa = self_env.get("status", "not_found"), self_env.get("fetched_at", "")
    if self_env.get("data"):
        for metric, value, unit in _flatten("", ad_metrics(self_env["data"], now_ts)):
            add("ads", "self", metric, value, unit, "ok", self_env.get("url", ""), s_fa)
    else:
        add("ads", "self", "_status", s_status, "text", s_status, self_env.get("url", ""), s_fa)

    # Ad Library — competitors
    comp_env = _load(raw / "ads_competitors.json")
    c_fa = comp_env.get("fetched_at", "")
    for comp in comp_env.get("competitors", []):
        name = comp.get("page_name") or comp.get("url") or "competitor"
        # prefer the resolved page_name from the first ad
        if comp.get("data"):
            name = comp["data"][0].get("page_name") or name
        entity = f"competitor:{name}"
        if comp.get("data"):
            metrics = ad_metrics(comp["data"], now_ts)
            # Attach the LLM creative-matrix scores (0–10) collect.py wrote, if any,
            # so they land in signals.csv as creative_matrix.<dim> rows.
            if comp.get("creative_matrix"):
                metrics["creative_matrix"] = {
                    k: v for k, v in comp["creative_matrix"].items() if k != "rationale"
                }
            for metric, value, unit in _flatten("", metrics):
                add("ads", entity, metric, value, unit, "ok", comp.get("url", ""), c_fa)
        else:
            add("ads", entity, "_status", comp.get("status", "empty"), "text",
                comp.get("status", "empty"), comp.get("url", ""), c_fa)
    return rows


def main() -> None:
    p = argparse.ArgumentParser(description="Normalize raw pre-audit passes into signals.csv")
    p.add_argument("slug")
    p.add_argument("--audit-date", help="ISO date; defaults to manifest or now")
    args = p.parse_args()

    data_dir = _root() / "prospects" / args.slug / "data"
    raw = data_dir / "raw"
    manifest = _load(raw / "manifest.json")
    audit_iso = args.audit_date or manifest.get("fetched_at")
    audit_dt = (datetime.fromisoformat(audit_iso.replace("Z", "+00:00"))
                if audit_iso else datetime.now(timezone.utc))
    now_ts = int(audit_dt.timestamp())

    rows = build_rows(args.slug, raw, now_ts)
    out = data_dir / "signals.csv"
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"[normalize] wrote {out} ({len(rows)} signals)")


if __name__ == "__main__":
    main()
