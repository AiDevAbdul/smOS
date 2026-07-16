#!/usr/bin/env python3
"""Classify ad copy into the smOS 6-theme angle taxonomy.

Taxonomy (from skills/research.md): pain, aspiration, social_proof, urgency, price, authority.

Calls Claude (claude-sonnet-4-6) with structured-output JSON. Batches one request per
competitor (all their ad bodies in one call), and caches results to .cache/classify_<hash>.json
so re-runs over the same copy set are free.
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import load_env  # noqa: E402
load_env()

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"
TAXONOMY = ["pain", "aspiration", "social_proof", "urgency", "price", "authority"]

SYSTEM = (
    "You classify Meta ad copy into exactly one primary angle per ad. "
    "Allowed angles: pain, aspiration, social_proof, urgency, price, authority. "
    "Return JSON only — no prose."
)


def _key() -> str:
    k = os.environ.get("ANTHROPIC_API_KEY", "")
    if not k:
        print("[ERROR] ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    return k


def _hash(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def classify_competitor(name: str, ad_bodies: list[str], cache_dir: Path) -> dict:
    """Return {angle_counts, dominant_angle, examples, ad_classifications}."""
    bodies = [b for b in ad_bodies if b and b.strip()]
    if not bodies:
        return {"angle_counts": {}, "dominant_angle": None, "examples": {}, "ad_classifications": []}

    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_key = _hash(f"{name}::" + "||".join(bodies))
    cache_path = cache_dir / f"classify_{cache_key}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    numbered = "\n".join(f"[{i}] {b[:500]}" for i, b in enumerate(bodies))
    prompt = (
        f"Classify each ad below into ONE angle from: {', '.join(TAXONOMY)}.\n\n"
        f"Ads from {name}:\n{numbered}\n\n"
        'Return JSON: {"classifications":[{"index":int,"angle":str,"why":"6 words max"}]}'
    )

    resp = requests.post(
        ANTHROPIC_URL,
        headers={
            "x-api-key": _key(),
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": MODEL,
            "max_tokens": 4000,
            "system": SYSTEM,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=60,
    )
    if resp.status_code >= 300:
        print(f"  [WARN] classifier API {resp.status_code}: {resp.text[:200]}", file=sys.stderr)
        return {"angle_counts": {}, "dominant_angle": None, "examples": {}, "ad_classifications": [], "error": resp.text[:200]}

    text = resp.json()["content"][0]["text"].strip()
    # Strip optional markdown fences
    if text.startswith("```"):
        text = text.split("```", 2)[1].lstrip("json").strip()
    parsed = json.loads(text)

    counts: dict[str, int] = {a: 0 for a in TAXONOMY}
    examples: dict[str, str] = {}
    classifications = []
    for item in parsed.get("classifications", []):
        idx = item.get("index")
        angle = item.get("angle", "").lower()
        if angle not in TAXONOMY or not isinstance(idx, int) or idx >= len(bodies):
            continue
        counts[angle] += 1
        examples.setdefault(angle, bodies[idx][:200])
        classifications.append({"index": idx, "angle": angle, "why": item.get("why", ""), "body": bodies[idx][:200]})

    dominant = max(counts, key=counts.get) if any(counts.values()) else None
    result = {
        "angle_counts": counts,
        "dominant_angle": dominant,
        "examples": examples,
        "ad_classifications": classifications,
    }
    cache_path.write_text(json.dumps(result, indent=2))
    return result


# ── Creative-matrix scoring (feeds the /pre-audit competitor table) ─────────
# Five 0–10 dimensions the standardized pre-audit report renders per competitor.
MATRIX_DIMS = [
    "hook_strength", "visual_strategy", "cta_match",
    "psychological_trigger", "run_duration_score",
]
MATRIX_SYSTEM = (
    "You are a senior Meta performance creative strategist scoring a competitor's ad "
    "approach for a sales audit. Score each dimension 0–10 (10 = best-in-class). "
    "Base scores on the evidence given; be discerning, not generous. Return JSON only."
)


def _clamp10(v) -> float:
    try:
        return round(max(0.0, min(10.0, float(v))), 1)
    except (TypeError, ValueError):
        return 0.0


def score_creative_matrix(name: str, ads: list[dict], cache_dir: Path,
                          stats: dict | None = None) -> dict:
    """LLM-score a competitor's creative approach on the 5 report dimensions.

    Content-addressed cache (same ads + stats ⇒ same file ⇒ reproducible re-runs).
    Returns {} when there is nothing to score or the API key is absent, so the
    caller can degrade gracefully — the report renders "—" for a missing matrix.
    """
    stats = stats or {}
    bodies = [b for ad in ads for b in (ad.get("ad_creative_bodies") or []) if b and b.strip()]
    ctas = sorted({ad.get("call_to_action_type") for ad in ads if ad.get("call_to_action_type")})
    formats = stats.get("format_mix", {})
    if not bodies or not os.environ.get("ANTHROPIC_API_KEY"):
        return {}

    cache_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = json.dumps(
        {"n": name, "b": bodies, "c": ctas, "f": formats,
         "age": stats.get("avg_creative_age_days"), "surv": stats.get("survival_past_60d_pct")},
        sort_keys=True,
    )
    cache_path = cache_dir / f"matrix_{_hash(fingerprint)}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    numbered = "\n".join(f"[{i}] {b[:400]}" for i, b in enumerate(bodies[:25]))
    prompt = (
        f"Competitor: {name}\n"
        f"Active ad copy samples ({len(bodies)} total):\n{numbered}\n\n"
        f"CTAs used: {', '.join(ctas) or 'unknown'}\n"
        f"Format mix: {json.dumps(formats) or 'unknown'}\n"
        f"Avg creative age (days): {stats.get('avg_creative_age_days', 'unknown')}\n"
        f"% ads surviving past 60d: {stats.get('survival_past_60d_pct', 'unknown')} "
        f"(11.3% is the industry benchmark; higher = winning creatives kept alive)\n\n"
        "Score these 0–10:\n"
        "- hook_strength: how arresting the opening lines are\n"
        "- visual_strategy: sophistication implied by format mix + copy (video/carousel variety)\n"
        "- cta_match: how well CTAs fit the funnel intent\n"
        "- psychological_trigger: use of persuasion (proof, urgency, authority, loss aversion)\n"
        "- run_duration_score: creative longevity — score from the survival % vs the 11.3% benchmark\n\n"
        'Return JSON only: {"hook_strength":n,"visual_strategy":n,"cta_match":n,'
        '"psychological_trigger":n,"run_duration_score":n,"rationale":"12 words max"}'
    )

    try:
        resp = requests.post(
            ANTHROPIC_URL,
            headers={"x-api-key": _key(), "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": MODEL, "max_tokens": 500, "system": MATRIX_SYSTEM,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=60,
        )
        if resp.status_code >= 300:
            print(f"  [WARN] creative-matrix API {resp.status_code}: {resp.text[:160]}", file=sys.stderr)
            return {}
        text = resp.json()["content"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1].lstrip("json").strip()
        parsed = json.loads(text)
    except (requests.RequestException, KeyError, ValueError, IndexError) as exc:
        print(f"  [WARN] creative-matrix scoring failed for {name}: {exc}", file=sys.stderr)
        return {}

    result = {d: _clamp10(parsed.get(d)) for d in MATRIX_DIMS}
    if parsed.get("rationale"):
        result["rationale"] = str(parsed["rationale"])[:120]
    cache_path.write_text(json.dumps(result, indent=2))
    return result


def enrich_analyzed(analyzed_path: str, raw_path: str, cache_dir: str | None = None) -> dict:
    """Take an analyzed JSON, add `angle_analysis` to each competitor from their raw ad bodies."""
    analyzed = json.loads(Path(analyzed_path).read_text())
    raw = json.loads(Path(raw_path).read_text())
    cache = Path(cache_dir or ".cache/meta-ad-library")

    for comp in analyzed.get("competitors", []):
        name = comp["page_name"]
        ads = raw.get("data", {}).get(name, [])
        bodies: list[str] = []
        for ad in ads:
            for b in (ad.get("ad_creative_bodies") or []):
                bodies.append(b)
        print(f"Classifying {len(bodies)} ad bodies for {name}…")
        comp["angle_analysis"] = classify_competitor(name, bodies, cache)

    Path(analyzed_path).write_text(json.dumps(analyzed, indent=2))
    print(f"\nEnriched analysis saved to: {analyzed_path}")
    return analyzed


def main():
    parser = argparse.ArgumentParser(description="Classify ad copy into 6-theme angle taxonomy")
    parser.add_argument("--analyzed", required=True, help="analyzed_*.json from analyzer.py")
    parser.add_argument("--raw", required=True, help="raw_*.json from client.py (for full ad bodies)")
    parser.add_argument("--cache", default=".cache/meta-ad-library")
    args = parser.parse_args()
    enrich_analyzed(args.analyzed, args.raw, args.cache)


if __name__ == "__main__":
    main()
