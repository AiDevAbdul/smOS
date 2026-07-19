#!/usr/bin/env python3
"""Analyze raw Meta Ads data and score competitors."""

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path


SPEND_TIER_SCORES = {
    "Micro": 10,
    "Small": 30,
    "Medium": 55,
    "Large": 80,
    "Enterprise": 100,
}

COMMON_CTAS = [
    "Shop Now", "Learn More", "Sign Up", "Book Now", "Contact Us",
    "Download", "Get Offer", "Subscribe", "Watch More", "Apply Now",
    "Get Quote", "Order Now", "See Menu", "Donate Now", "Listen Now",
]


_DISPLAY_FORMAT_MAP = {
    "IMAGE": "image",
    "VIDEO": "video",
    "CAROUSEL": "carousel",
    "DYNAMIC": "dynamic",
    "DPA": "dynamic",
}

_MEDIA_TYPE_MAP = {
    "image": "image",
    "video": "video",
    "carousel": "carousel",
}


def infer_format(ad: dict) -> str:
    """Determine ad format from authoritative fields, falling back to heuristic.

    Priority:
      1. ``display_format`` (Meta canonical value on archived-ad nodes)
      2. ``media_type`` (secondary authoritative source)
      3. URL / body heuristic (legacy fallback)
    """
    display = ad.get("display_format", "")
    if display:
        mapped = _DISPLAY_FORMAT_MAP.get(display.upper())
        if mapped:
            return mapped

    media = ad.get("media_type", "")
    if media:
        mapped = _MEDIA_TYPE_MAP.get(media.lower())
        if mapped:
            return mapped

    # Legacy heuristic fallback
    snapshot = ad.get("ad_snapshot_url", "")
    bodies = ad.get("ad_creative_bodies", [])
    if "video" in snapshot.lower():
        return "video"
    if len(bodies) > 1:
        return "carousel"
    return "image"


def extract_ctas(ads: list[dict]) -> list[str]:
    found = []
    all_text = " ".join(
        " ".join(ad.get("ad_creative_bodies", []) or []) +
        " ".join(ad.get("ad_creative_link_titles", []) or []) +
        " ".join(ad.get("ad_creative_link_captions", []) or [])
        for ad in ads
    ).lower()
    for cta in COMMON_CTAS:
        if cta.lower() in all_text:
            found.append(cta)
    return found[:5]


def estimate_spend(ads: list[dict], days: int) -> tuple[float, str]:
    totals = []
    for ad in ads:
        spend = ad.get("spend", {})
        lo = float(spend.get("lower_bound", 0) or 0)
        hi = float(spend.get("upper_bound", 0) or 0)
        if hi > 0:
            totals.append((lo + hi) / 2)

    if not totals:
        return 0.0, "Unknown"

    total_spend = sum(totals)
    monthly = total_spend * (30 / max(days, 1))

    if monthly < 1_000:
        tier = "Micro"
    elif monthly < 10_000:
        tier = "Small"
    elif monthly < 50_000:
        tier = "Medium"
    elif monthly < 200_000:
        tier = "Large"
    else:
        tier = "Enterprise"

    return round(monthly, 2), tier


def avg_impressions(ads: list[dict]) -> float:
    uppers = []
    for ad in ads:
        imp = ad.get("impressions", {})
        hi = float(imp.get("upper_bound", 0) or 0)
        if hi > 0:
            uppers.append(hi)
    return round(sum(uppers) / len(uppers), 0) if uppers else 0.0


def cadence_per_week(ads: list[dict]) -> float:
    dates = []
    for ad in ads:
        dt = ad.get("ad_creation_time", "")
        if dt:
            try:
                dates.append(datetime.fromisoformat(dt.replace("Z", "+00:00")))
            except ValueError:
                pass
    if len(dates) < 2:
        return 0.0
    span = (max(dates) - min(dates)).days or 1
    return round(len(ads) / span * 7, 1)


def weekly_cadence_chart_data(ads: list[dict]) -> dict:
    """Return weekly ad count dict for chart rendering."""
    weekly: Counter = Counter()
    for ad in ads:
        dt_str = ad.get("ad_creation_time", "")
        if dt_str:
            try:
                dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
                week = dt.strftime("%Y-W%W")
                weekly[week] += 1
            except ValueError:
                pass
    return dict(sorted(weekly.items()))


def avg_copy_length(ads: list[dict]) -> int:
    lengths = []
    for ad in ads:
        bodies = ad.get("ad_creative_bodies") or []
        for b in bodies:
            if b:
                lengths.append(len(b.split()))
    return int(sum(lengths) / len(lengths)) if lengths else 0


def survival_metrics(ads: list[dict]) -> dict:
    """Compute creative age and survival stats from delivery timestamps.

    Returns dict with ``avg_creative_age_days``, ``survival_past_60d_pct``,
    and ``oldest_ad_days``.  All values are 0 when no parseable dates exist.
    """
    now = datetime.now().astimezone()
    ages: list[float] = []
    for ad in ads:
        # Prefer delivery start; fall back to creation time
        dt_str = ad.get("ad_delivery_start_time") or ad.get("ad_creation_time", "")
        if not dt_str:
            continue
        try:
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            age = (now - dt).total_seconds() / 86400
            if age >= 0:
                ages.append(age)
        except ValueError:
            pass

    if not ages:
        return {
            "avg_creative_age_days": 0.0,
            "survival_past_60d_pct": 0.0,
            "oldest_ad_days": 0,
        }

    survived = sum(1 for a in ages if a > 60)
    return {
        "avg_creative_age_days": round(sum(ages) / len(ages), 1),
        "survival_past_60d_pct": round(survived / len(ages) * 100, 1),
        "oldest_ad_days": int(max(ages)),
    }


def angle_diversity_score(ads: list[dict]) -> float:
    """Estimate creative-angle diversity from opening words of ad copy.

    Uses the first three words of each body as a proxy for the hook/angle.
    Returns a 0-100 score based on unique-opening ratio.
    """
    openers: set[str] = set()
    total = 0
    for ad in ads:
        bodies = ad.get("ad_creative_bodies") or []
        for body in bodies:
            if not body or not body.strip():
                continue
            total += 1
            words = body.strip().split()[:3]
            opener = " ".join(w.lower() for w in words)
            openers.add(opener)

    if total == 0:
        return 0.0
    # Ratio of unique openers to total bodies, scaled to 100
    return round(min(1.0, len(openers) / total) * 100, 1)


def confidence_level(total_ads: int) -> str:
    """Return sample-size confidence label."""
    if total_ads < 3:
        return "low"
    if total_ads < 10:
        return "medium"
    return "high"


def score_competitor(metrics: dict, all_metrics: list[dict]) -> float:
    """Score a competitor on a 0-100 scale.

    Weight allocation (works without spend/impressions — the normal case):
        volume          20%
        cadence         20%
        survival_rate   20%
        format_diversity 15%
        angle_diversity  15%
        spend_bonus      5%  (only contributes when spend data exists)
        impression_bonus 5%  (only contributes when impression data exists)
    """
    max_ads = max(m["total_ads"] for m in all_metrics) or 1

    volume_score = min(100, (metrics["total_ads"] / max_ads) * 100)
    cadence_score = min(100, metrics["cadence_ads_per_week"] * 30)
    survival_score = min(100, metrics.get("survival_past_60d_pct", 0))
    format_score = min(100, (len(metrics["formats"]) / 4) * 100)
    angle_score = metrics.get("angle_diversity", 0)

    # Spend & impression bonuses — meaningful only for political/EU ads
    spend_score = SPEND_TIER_SCORES.get(metrics["spend_tier"], 0) if metrics["spend_tier"] != "Unknown" else 0
    max_imp = max((m["avg_impressions_upper"] for m in all_metrics), default=0) or 1
    impression_score = min(100, (metrics["avg_impressions_upper"] / max_imp) * 100) if metrics["avg_impressions_upper"] > 0 else 0

    total = (
        volume_score * 0.20 +
        cadence_score * 0.20 +
        survival_score * 0.20 +
        format_score * 0.15 +
        angle_score * 0.15 +
        spend_score * 0.05 +
        impression_score * 0.05
    )
    return round(total, 1)


def analyze_competitor(page_name: str, ads: list[dict], days: int) -> dict:
    formats_counter: Counter = Counter(infer_format(ad) for ad in ads)
    active_ads = [
        ad for ad in ads
        if not ad.get("ad_delivery_stop_time")
    ]
    monthly_spend, spend_tier = estimate_spend(ads, days)
    surv = survival_metrics(active_ads)
    angle_div = angle_diversity_score(ads)
    conf = confidence_level(len(ads))

    result = {
        "page_name": page_name,
        "total_ads": len(ads),
        "active_ads": len(active_ads),
        "formats": dict(formats_counter),
        "top_ctas": extract_ctas(ads),
        "avg_copy_length": avg_copy_length(ads),
        "spend_tier": spend_tier,
        "estimated_monthly_spend_usd": monthly_spend,
        "avg_impressions_upper": avg_impressions(ads),
        "cadence_ads_per_week": cadence_per_week(ads),
        "weekly_cadence": weekly_cadence_chart_data(ads),
        # A3: Survival & age metrics (computed on active ads)
        "avg_creative_age_days": surv["avg_creative_age_days"],
        "survival_past_60d_pct": surv["survival_past_60d_pct"],
        "oldest_ad_days": surv["oldest_ad_days"],
        # Angle diversity (0-100)
        "angle_diversity": angle_div,
        # A4: Sample-size confidence
        "confidence": conf,
    }

    if conf == "low":
        result["sample_size_note"] = (
            f"Only {len(ads)} ad(s) found — scores may not be representative. "
            "Consider widening the date range or verifying the page name."
        )

    return result


def main():
    parser = argparse.ArgumentParser(description="Analyze Meta Ads competitor data")
    parser.add_argument("--input", required=True, help="Raw JSON file from meta_client.py")
    parser.add_argument("--output", default=None, help="Output analyzed JSON file path")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        raw = json.load(f)

    meta = raw["meta"]
    days = meta.get("days", 90)

    competitors = []
    for page_name, ads in raw["data"].items():
        print(f"Analyzing: {page_name} ({len(ads)} ads)")
        metrics = analyze_competitor(page_name, ads, days)
        competitors.append(metrics)

    for c in competitors:
        c["score"] = score_competitor(c, competitors)

    competitors.sort(key=lambda x: x["score"], reverse=True)
    for i, c in enumerate(competitors):
        c["rank"] = i + 1

    output_path = args.output or args.input.replace("raw_", "analyzed_")
    result = {"meta": meta, "competitors": competitors}

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\nAnalysis saved to: {output_path}")
    return output_path


if __name__ == "__main__":
    main()
