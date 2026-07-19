#!/usr/bin/env python3
"""Compute competitive whitespace gaps from classified ad data.

Takes analyzed competitor JSON files (output of classifier.py / analyzer.py) and
identifies angle, format, offer, and voice gaps the client can exploit. Gaps are
computed programmatically from angle frequency across competitors cross-referenced
against the client's USP for fit scoring.

    python gaps.py --analyzed analyzed_*.json --usp "client USP text" [--raw raw_*.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────

ANGLE_TAXONOMY = ["pain", "aspiration", "social_proof", "urgency", "price", "authority"]
GAP_TYPES = ["format", "angle", "offer", "voice"]

# Common formats and offer types to check for absence.
COMMON_FORMATS = ["image", "video", "carousel", "dynamic"]
COMMON_OFFER_TYPES = [
    "free_inspection", "free_quote", "warranty", "discount", "financing",
    "loyalty_program", "referral_bonus", "bundle_deal",
]

# Angle keywords that signal each taxonomy bucket in free-text (for USP matching).
_ANGLE_KEYWORDS: dict[str, list[str]] = {
    "pain": ["problem", "fix", "broken", "damage", "risk", "cost", "worry", "hassle", "pain"],
    "aspiration": ["dream", "transform", "premium", "luxury", "best", "upgrade", "perfect", "beautiful"],
    "social_proof": ["review", "customer", "testimonial", "rated", "trusted", "recommend", "years", "certified"],
    "urgency": ["limited", "now", "today", "hurry", "last chance", "deadline", "soon", "fast"],
    "price": ["price", "affordable", "cheap", "save", "discount", "deal", "value", "budget", "offer", "$"],
    "authority": ["expert", "certified", "specialist", "award", "board", "credential", "license", "official"],
}


# ── Core logic ───────────────────────────────────────────────────────────────

def _usp_angle_fit(angle: str, client_usp: str) -> str:
    """Estimate how well an angle fits the client's USP. Returns high/medium/low."""
    usp_lower = client_usp.lower()
    keywords = _ANGLE_KEYWORDS.get(angle, [])
    hits = sum(1 for kw in keywords if kw in usp_lower)
    if hits >= 3:
        return "high"
    if hits >= 1:
        return "medium"
    return "low"


def _collect_angle_counts(competitors: list[dict]) -> dict[str, dict[str, int]]:
    """Gather per-competitor angle counts from angle_analysis.angle_counts."""
    per_comp: dict[str, dict[str, int]] = {}
    for comp in competitors:
        name = comp.get("page_name", comp.get("name", "unknown"))
        analysis = comp.get("angle_analysis", {})
        counts = analysis.get("angle_counts", {})
        if counts:
            per_comp[name] = {a: counts.get(a, 0) for a in ANGLE_TAXONOMY}
    return per_comp


def _collect_formats(competitors: list[dict]) -> dict[str, dict[str, float]]:
    """Gather per-competitor format mix."""
    per_comp: dict[str, dict[str, float]] = {}
    for comp in competitors:
        name = comp.get("page_name", comp.get("name", "unknown"))
        fmt = comp.get("format_mix", comp.get("stats", {}).get("format_mix", {}))
        if fmt:
            per_comp[name] = fmt
    return per_comp


def _collect_offers(competitors: list[dict]) -> list[str]:
    """Gather all offer-type language seen across competitors."""
    offers: list[str] = []
    for comp in competitors:
        for offer in comp.get("offers_seen", comp.get("offers", [])):
            if isinstance(offer, str):
                offers.append(offer.lower())
    return offers


def compute_gaps(
    competitors: list[dict],
    client_usp: str,
    taxonomy: list[str] | None = None,
) -> list[dict]:
    """Compute competitive whitespace gaps programmatically.

    1. Tally angle frequency across all competitors (from angle_analysis.angle_counts)
    2. Identify under-served angles (used by <25% of competitors)
    3. Cross-reference each under-served angle against client_usp for fit
    4. Identify format gaps (formats no competitor uses)
    5. Identify offer gaps (common offer types not seen)
    6. Return [{type, observation, recommended_angle, frequency_pct, fit_score}]
    """
    taxonomy = taxonomy or ANGLE_TAXONOMY
    gaps: list[dict] = []
    n_comp = len(competitors)

    if n_comp == 0:
        return gaps

    # ── 1-3. Angle gaps ──────────────────────────────────────────────────
    per_comp_angles = _collect_angle_counts(competitors)
    n_with_data = len(per_comp_angles)

    if n_with_data > 0:
        # Count how many competitors USE each angle (count > 0).
        angle_presence: dict[str, int] = {a: 0 for a in taxonomy}
        for _name, counts in per_comp_angles.items():
            for angle in taxonomy:
                if counts.get(angle, 0) > 0:
                    angle_presence[angle] += 1

        for angle in taxonomy:
            present_count = angle_presence[angle]
            freq_pct = round((present_count / n_with_data) * 100, 1)

            # Under-served: used by <25% of competitors.
            if freq_pct < 25:
                fit = _usp_angle_fit(angle, client_usp)
                gaps.append({
                    "type": "angle",
                    "observation": (
                        f"{present_count} of {n_with_data} competitors use {angle} angles "
                        f"({freq_pct}% penetration)"
                    ),
                    "recommended_angle": (
                        f"Test {angle}-driven creative — low competition in this angle"
                    ),
                    "frequency_pct": freq_pct,
                    "fit_score": fit,
                })

    # ── 4. Format gaps ───────────────────────────────────────────────────
    per_comp_formats = _collect_formats(competitors)
    if per_comp_formats:
        n_fmt = len(per_comp_formats)
        for fmt in COMMON_FORMATS:
            users = sum(
                1 for fmix in per_comp_formats.values()
                if fmix.get(fmt, fmix.get(fmt.upper(), 0)) > 0
            )
            freq_pct = round((users / n_fmt) * 100, 1)
            if users == 0:
                gaps.append({
                    "type": "format",
                    "observation": f"No competitors use {fmt} format",
                    "recommended_angle": f"Test {fmt} ads to own an uncontested format",
                    "frequency_pct": 0.0,
                    "fit_score": "medium",
                })

    # ── 5. Offer gaps ────────────────────────────────────────────────────
    all_offers_text = " ".join(_collect_offers(competitors))
    if all_offers_text:
        for offer in COMMON_OFFER_TYPES:
            offer_key = offer.replace("_", " ")
            if offer_key not in all_offers_text:
                gaps.append({
                    "type": "offer",
                    "observation": f'No competitor mentions "{offer_key}" in their offers',
                    "recommended_angle": f"Consider a {offer_key} offer to differentiate",
                    "frequency_pct": 0.0,
                    "fit_score": _usp_angle_fit("price", client_usp),
                })

    # Sort: high-fit first, then by lowest frequency.
    fit_rank = {"high": 0, "medium": 1, "low": 2}
    gaps.sort(key=lambda g: (fit_rank.get(g["fit_score"], 9), g.get("frequency_pct") or 0))

    return gaps


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Compute competitive whitespace gaps from analyzed competitor data"
    )
    parser.add_argument(
        "--analyzed", nargs="+", required=True,
        help="analyzed_*.json files (from analyzer.py, enriched by classifier.py)",
    )
    parser.add_argument(
        "--usp", required=True,
        help="Client USP text for fit scoring",
    )
    parser.add_argument(
        "--raw", nargs="*", default=[],
        help="Optional raw_*.json files for additional offer/format data",
    )
    parser.add_argument(
        "--output", default=None,
        help="Output JSON path (default: stdout)",
    )
    args = parser.parse_args()

    # Merge all competitors from analyzed files.
    competitors: list[dict] = []
    for path_str in args.analyzed:
        path = Path(path_str)
        if not path.exists():
            print(f"[WARN] File not found: {path}", file=sys.stderr)
            continue
        data = json.loads(path.read_text())
        competitors.extend(data.get("competitors", []))

    # Optionally enrich with raw data (offers, formats from raw ad envelopes).
    for path_str in args.raw:
        path = Path(path_str)
        if not path.exists():
            continue
        raw = json.loads(path.read_text())
        raw_data = raw.get("data", {})
        # Match raw competitors to analyzed ones by page_name.
        name_to_comp = {c.get("page_name", c.get("name", "")): c for c in competitors}
        for page_name, ads in raw_data.items():
            if page_name in name_to_comp:
                comp = name_to_comp[page_name]
                # Inject raw offers if not already present.
                if not comp.get("offers_seen"):
                    offers = set()
                    for ad in ads:
                        for body in ad.get("ad_creative_bodies", []):
                            if body:
                                offers.add(body[:100])
                    comp["offers_seen"] = list(offers)[:20]

    if not competitors:
        print("[WARN] No competitors found in input files", file=sys.stderr)

    gaps = compute_gaps(competitors, args.usp)

    output = {
        "gaps": gaps,
        "meta": {
            "n_competitors": len(competitors),
            "usp": args.usp,
            "taxonomy": ANGLE_TAXONOMY,
            "gap_types": GAP_TYPES,
        },
    }

    text = json.dumps(output, indent=2)

    if args.output:
        Path(args.output).write_text(text)
        print(f"Gaps written to {args.output} ({len(gaps)} gaps found)", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
