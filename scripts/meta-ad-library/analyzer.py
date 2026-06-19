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


def infer_format(ad: dict) -> str:
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


def score_competitor(metrics: dict, all_metrics: list[dict]) -> float:
    max_ads = max(m["total_ads"] for m in all_metrics) or 1

    volume_score = min(100, (metrics["total_ads"] / max_ads) * 100)
    spend_score = SPEND_TIER_SCORES.get(metrics["spend_tier"], 10)
    format_score = (len(metrics["formats"]) / 3) * 100
    cadence_score = min(100, metrics["cadence_ads_per_week"] * 30)
    max_imp = max(m["avg_impressions_upper"] for m in all_metrics) or 1
    impression_score = min(100, (metrics["avg_impressions_upper"] / max_imp) * 100)

    total = (
        volume_score * 0.25 +
        spend_score * 0.25 +
        format_score * 0.20 +
        cadence_score * 0.15 +
        impression_score * 0.15
    )
    return round(total, 1)


def analyze_competitor(page_name: str, ads: list[dict], days: int) -> dict:
    formats_counter: Counter = Counter(infer_format(ad) for ad in ads)
    active_ads = [
        ad for ad in ads
        if not ad.get("ad_delivery_stop_time")
    ]
    monthly_spend, spend_tier = estimate_spend(ads, days)

    return {
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
    }


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
