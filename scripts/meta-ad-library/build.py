#!/usr/bin/env python3
"""/pre-audit stage 3 — BUILD.

Reads the ``signals.csv`` ledger (the source of truth) and re-inflates it into
the three render-contract JSONs the standardized template consumes:

    prospects/<slug>/data/page_audit.json
    prospects/<slug>/data/competitor_summary.json
    prospects/<slug>/data/synthesis.json

Scoring is deterministic and lives HERE, in code — five equal-weight 0–100
dimensions summed to the 0–100 headline score (rubric in
``skills/pre-audit/references/domain-standards.md``). Re-running with the same
CSV yields byte-identical JSON.

Qualitative prose (headline, wins/gaps, recommendations, next steps) is
template-filled from the scored signals by default, so the pipeline is fully
autonomous. An optional, human/model-authored ``data/narrative.json`` overrides
any of those fields for polish — merged last, never required.

    python build.py <slug>
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import benchmarks as _bench

# Core public passes the data-quality gate watches. If ≥2 are blocked, the
# report is flagged low-confidence rather than shipping a confident-looking
# score built on empty data.
CORE_PASSES = [("facebook", "self"), ("instagram", "self"),
               ("website", "self"), ("ads", "self")]

# Signal-ledger columns build.py depends on. A hand-edited signals.csv missing
# any of these gets a clear error instead of a raw KeyError traceback.
REQUIRED_COLUMNS = {"pass", "entity", "metric", "value", "unit"}


def _root() -> Path:
    if os.environ.get("SMOS_DATA_ROOT"):
        return Path(os.environ["SMOS_DATA_ROOT"]).resolve()
    return Path(__file__).resolve().parent.parent.parent


def _coerce(value: str, unit: str):
    if unit == "bool":
        return value == "True"
    if unit == "count":
        try:
            return int(value)
        except ValueError:
            return None
    if unit == "rate":
        try:
            return float(value)
        except ValueError:
            return None
    return value


def _inflate(pairs: list[tuple[str, str, str]]) -> dict:
    """Dotted metric paths → nested dict, coercing by unit."""
    out: dict = {}
    for metric, value, unit in pairs:
        node = out
        parts = metric.split(".")
        for key in parts[:-1]:
            node = node.setdefault(key, {})
        node[parts[-1]] = _coerce(value, unit)
    return out


def read_signals(csv_path: Path):
    """Group signal rows by (pass, entity) → list[(metric,value,unit)] + status map.

    Also returns the max ``fetched_at`` seen, so downstream timestamps derive
    from the data (reproducible) rather than wall-clock time.
    """
    if not csv_path.exists():
        raise SystemExit(f"[build] signals.csv not found at {csv_path} — run collect+normalize "
                         f"(or --collect) first.")
    groups: dict[tuple[str, str], list] = defaultdict(list)
    status: dict[tuple[str, str], str] = {}
    fetched_at = ""
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"[build] signals.csv is missing required column(s): "
                             f"{', '.join(sorted(missing))}. Expected header: "
                             f"slug,pass,entity,metric,value,unit,status,source,fetched_at")
        for line_no, r in enumerate(reader, start=2):
            if r.get("pass") is None or r.get("entity") is None or r.get("metric") is None:
                raise SystemExit(f"[build] signals.csv row {line_no} is malformed "
                                 f"(pass/entity/metric required): {r}")
            key = (r["pass"], r["entity"])
            fetched_at = max(fetched_at, r.get("fetched_at") or "")
            if r["metric"] == "_status":
                status[key] = r["value"]
            else:
                groups[key].append((r["metric"], r["value"], r["unit"]))
    return groups, status, fetched_at


# ── Scoring rubric (0–100 per dimension, equal 20% weights) ────────────────
def _clamp(x: float) -> int:
    return int(max(0, min(100, round(x))))


def score(page: dict, comp: dict) -> dict:
    fb, ig, site = page.get("facebook", {}), page.get("instagram", {}), page.get("website", {})
    self_ads = comp.get("self", {})
    competitors = comp.get("competitors", {})

    # 1. Profile & brand presence
    pc = 0
    pc += 25 if fb.get("likes") else 0
    pc += 15 if fb.get("has_profile_pic") else 0
    pc += 15 if fb.get("about") else 0
    pc += 20 if ig.get("followers") else 0
    pc += 15 if ig.get("is_business_account") else 0
    pc += 10 if ig.get("bio") else 0
    page_completeness = _clamp(pc)

    # 2. Organic posting consistency (IG cadence + recency)
    ppw = ig.get("posts_per_week") or 0
    rec = ig.get("recency_days")
    posting = min(100, (ppw / 3) * 70)  # 3+/wk ⇒ full cadence credit
    if rec is not None:
        posting += 30 if rec <= 14 else (15 if rec <= 30 else 0)
    posting_consistency = _clamp(posting) if (ppw or rec is not None) else 0

    # 3. Paid ad maturity (volume + survival)
    active = self_ads.get("active_ads_last_90d", 0) or 0
    surv = self_ads.get("survival_past_60d_pct")
    ad_mat = min(70, active * 10)
    surv_bench = _bench.value("ad_survival_60d_pct", 11.3) or 11.3
    if surv is not None:
        ad_mat += min(30, (surv / surv_bench) * 30)  # industry survival benchmark
    ad_maturity = _clamp(ad_mat)

    # 4. Competitor position (inverse outspend — you vs the loudest competitor)
    max_comp = max((c.get("active_ads_last_90d", 0) or 0 for c in competitors.values()),
                   default=0)
    if max_comp == 0:
        outspend_gap_inverse = 55 if active == 0 else 80  # greenfield: nobody advertising
    else:
        outspend_gap_inverse = _clamp((active / max_comp) * 100)

    # 5. Technical foundation (tracking stack)
    tf = 0
    tf += 40 if (site.get("meta_pixel") or {}).get("installed") else 0
    tf += 20 if (site.get("ga4") or {}).get("installed") else 0
    tf += 15 if (site.get("gtm") or {}).get("installed") else 0
    tf += 25 if site.get("conversion_events") else 0
    pixel_tracking = _clamp(tf) if site else 0

    dims = {
        "page_completeness": page_completeness,
        "posting_consistency": posting_consistency,
        "ad_maturity": ad_maturity,
        "outspend_gap_inverse": outspend_gap_inverse,
        "pixel_tracking": pixel_tracking,
    }
    total = _clamp(sum(dims.values()) / len(dims))
    return dims, total, max_comp


def synthesize(page: dict, comp: dict, scored_at: str) -> dict:
    dims, total, max_comp = score(page, comp)
    fb, ig, site = page.get("facebook", {}), page.get("instagram", {}), page.get("website", {})
    self_ads = comp.get("self", {})
    active = self_ads.get("active_ads_last_90d", 0) or 0
    ratio = round(max_comp / active) if active and max_comp else max_comp

    # Template-filled wins/gaps from the scored signals (autonomous default).
    wins, gaps = [], []
    if fb.get("likes"):
        wins.append(f"Established Facebook presence — {fb['likes']:,} likes to build on")
    if ig.get("is_business_account"):
        wins.append("Instagram Business account already set up for discovery + insights")
    if (site.get("ga4") or {}).get("installed"):
        wins.append("GA4 installed — web analytics foundation is in place")
    if max_comp == 0 and active == 0:
        wins.append("Greenfield paid landscape — no competitor is running Meta ads yet")

    if not (site.get("meta_pixel") or {}).get("installed"):
        gaps.append("No Meta Pixel — every ad click is unmeasured and un-retargetable")
    if active == 0:
        gaps.append(f"Zero active ads vs. {max_comp} from the top competitor" if max_comp
                    else "Zero active paid advertising — 100% reliant on organic reach")
    if not site or site.get("_status"):
        gaps.append("No website tracking surface detected — conversion intent is invisible")
    if not ig.get("followers"):
        gaps.append("No Instagram presence — missing the primary visual discovery channel")

    headline = (
        "First-mover advantage — no competitor is running paid ads in this market"
        if max_comp == 0 and active == 0 else
        f"Competitors are running {ratio}× your ad volume — you're ceding the paid lane"
        if ratio and ratio > 1 else
        "Solid foundation with clear, fixable gaps in tracking and paid maturity"
    )

    return {
        "score": total,
        "headline": headline,
        "outspend_ratio": ratio or 0,
        "outspend_ratio_source": ("category benchmark — no named competitor ads resolved"
                                  if max_comp == 0 else "top competitor active-ad volume vs. yours"),
        "dimensions": dims,
        "wins": (wins[:3] or ["Audit baseline captured"]),
        "gaps": (gaps[:3] or ["No material gaps detected in public signals"]),
        "recommendations": _default_recs(page, comp),
        "next_steps": {
            "day_30": "Install Meta Pixel + CAPI, launch first $50/day conversion test",
            "day_60": "Creative iteration, scale winning adsets, organic calendar live",
            "day_90": "Full-funnel reporting, retainer review, next-quarter growth plan",
        },
        "scored_at": scored_at,
    }


def _default_recs(page: dict, comp: dict) -> list[dict]:
    site = page.get("website", {})
    recs = []
    if not (site.get("meta_pixel") or {}).get("installed"):
        recs.append({"problem": "Ad spend is flying blind without a pixel",
                     "action": "Install Meta Pixel + Conversions API before any paid spend",
                     "impact": "high", "effort": "low"})
    if (comp.get("self", {}).get("active_ads_last_90d", 0) or 0) == 0:
        recs.append({"problem": "No paid presence in a market competitors are (or aren't) contesting",
                     "action": "Launch a $50/day conversion campaign with the best organic creative",
                     "impact": "high", "effort": "medium"})
    recs.append({"problem": "Organic reach is capped without a consistent Reels cadence",
                 "action": "Repurpose existing content into 3 Reels/week to feed paid + organic",
                 "impact": "medium", "effort": "medium"})
    return recs[:3]


def main() -> None:
    p = argparse.ArgumentParser(description="Build render-contract JSONs from signals.csv")
    p.add_argument("slug")
    args = p.parse_args()

    data_dir = _root() / "prospects" / args.slug / "data"
    groups, status, fetched_at = read_signals(data_dir / "signals.csv")
    fetched_at = fetched_at or datetime.now(timezone.utc).isoformat()

    # page_audit.json
    page = {
        "facebook": _inflate(groups.get(("facebook", "self"), [])),
        "instagram": _inflate(groups.get(("instagram", "self"), [])),
        "website": _inflate(groups.get(("website", "self"), [])),
        "fetched_at": fetched_at,
    }
    for pass_, key in [("facebook", "facebook"), ("instagram", "instagram"), ("website", "website")]:
        st = status.get((pass_, "self"))
        if st and st != "ok":
            page[key]["fetch_status"] = st

    # competitor_summary.json — competitors as a dict keyed by name (render contract)
    competitors = {}
    for (pass_, entity), pairs in groups.items():
        if pass_ == "ads" and entity.startswith("competitor:"):
            competitors[entity.split(":", 1)[1]] = _inflate(pairs)
    comp = {
        "self": _inflate(groups.get(("ads", "self"), [])),
        "competitors": competitors,
        "fetched_at": fetched_at,
    }

    syn = synthesize(page, comp, fetched_at)

    # ── Minimum-data-quality gate ──
    # A pass is "blocked" when normalize recorded a non-ok _status for it. If
    # ≥2 of the 4 core public passes are blocked, the score rests on too little
    # observed data — flag it so the renderer can watermark LOW CONFIDENCE
    # rather than ship a confident-looking PDF built from empty passes.
    blocked = sorted(p for (p, ent) in CORE_PASSES
                     if status.get((p, ent)) not in (None, "", "ok"))
    syn["data_quality"] = {
        "core_passes": len(CORE_PASSES),
        "blocked_passes": blocked,
        "low_confidence": len(blocked) >= 2,
    }

    # Optional narrative override (human/model polish) — merged last.
    narrative_path = data_dir / "narrative.json"
    if narrative_path.exists():
        try:
            syn.update({k: v for k, v in json.loads(narrative_path.read_text()).items()
                        if v is not None})
        except ValueError:
            print("[build] narrative.json unreadable — using template defaults")

    for name, obj in [("page_audit.json", page), ("competitor_summary.json", comp),
                      ("synthesis.json", syn)]:
        (data_dir / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False))
    print(json.dumps({"slug": args.slug, "score": syn["score"],
                      "dimensions": syn["dimensions"],
                      "data_quality": syn["data_quality"],
                      "competitors": list(competitors)}, indent=2))


if __name__ == "__main__":
    main()
