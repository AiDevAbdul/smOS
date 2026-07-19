#!/usr/bin/env python3
"""Reusable LLM-powered search term expansion for Meta Ad Library discovery.

Extracted from market.py so discover_pk.py and the research.js --discover flow
can expand seed terms without pulling in the full market analyzer.

Three layers (in order):
  1. seed_terms — caller-provided base terms
  2. synonym_terms — static curated synonyms (optional)
  3. LLM-expanded terms — claude-haiku generates additional variants,
     cached to disk so repeat runs cost nothing

Usage as library:
    from term_expansion import expand_terms
    terms = expand_terms("dental", "Dental Clinics", ["dentist", "dental office"], cache_dir=Path("./cache"))

Usage as CLI:
    python term_expansion.py --category dental --label "Dental Clinics" --seeds "dentist" "dental office" --cache-dir ./cache
"""

import argparse
import json
import re
import sys
from pathlib import Path


def expand_terms(cat_key: str, cat_label: str, seed_terms: list[str],
                 synonym_terms: list[str] | None = None,
                 cache_dir: Path | None = None,
                 no_llm: bool = False) -> list[str]:
    """Return a deduplicated list of all search terms for a category.

    Layers (in order):
      1. seed_terms — caller-provided base terms
      2. synonym_terms — static curated synonyms (optional)
      3. LLM-expanded terms — claude-haiku generates additional variants,
         cached to disk so repeat runs cost nothing

    Cap: at most 20 unique terms to avoid excessive API calls.
    """
    synonym_terms = synonym_terms or []

    # LLM expansion (skip if --no-llm or no cache dir)
    llm_terms: list[str] = []
    if not no_llm:
        cache_path = (cache_dir / f"terms_cache_{cat_key}.json") if cache_dir else None

        # Load LLM cache if it exists
        if cache_path and cache_path.exists():
            try:
                with open(cache_path, encoding="utf-8") as f:
                    llm_terms = json.load(f).get("llm_terms", [])
                print(f"    [cache] Loaded {len(llm_terms)} LLM terms for '{cat_key}'",
                      file=sys.stderr)
            except (json.JSONDecodeError, OSError):
                llm_terms = []

        if not llm_terms:
            llm_terms = _llm_expand(cat_key, cat_label, seed_terms, synonym_terms)
            if llm_terms and cache_path:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump({"cat_key": cat_key, "llm_terms": llm_terms}, f, indent=2)
                print(f"    [llm] Generated {len(llm_terms)} terms -> cached to {cache_path.name}",
                      file=sys.stderr)

    # Merge all layers, preserve order, deduplicate case-insensitively
    all_terms: list[str] = []
    seen: set[str] = set()
    for term in seed_terms + synonym_terms + llm_terms:
        key = term.strip().lower()
        if key and key not in seen:
            seen.add(key)
            all_terms.append(term.strip())

    return all_terms[:20]  # cap at 20 terms


def _llm_expand(cat_key: str, cat_label: str, seed_terms: list[str],
                synonym_terms: list[str]) -> list[str]:
    """Call claude-haiku to generate additional semantic search term variants.
    Returns empty list if the SDK isn't available or the API call fails."""
    try:
        import anthropic
    except ImportError:
        print(f"    [WARN] anthropic SDK not installed -- skipping LLM expansion for '{cat_key}'",
              file=sys.stderr)
        return []

    already_covered = seed_terms + synonym_terms
    prompt = (
        f"You are a Meta Ad Library search expert.\n"
        f"Generate 8 short keyword phrases (2-4 words each) to find '{cat_label}' ads on Facebook/Instagram.\n"
        f"These terms are ALREADY covered -- do NOT repeat them: {already_covered}\n"
        f"Focus on: slang, location-qualified variants, pain-point phrases, and service differentiators.\n"
        f"Return ONLY a JSON array of strings. No markdown. No explanation."
    )
    try:
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        # Strip markdown fences if the model wrapped in ```json
        raw = re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip()
        terms = json.loads(raw)
        if isinstance(terms, list):
            return [str(t) for t in terms if t]
    except Exception as e:
        print(f"    [WARN] LLM expansion failed for '{cat_key}': {e}", file=sys.stderr)
    return []


def main():
    ap = argparse.ArgumentParser(description="Expand search terms for Ad Library discovery")
    ap.add_argument("--category", required=True, help="Category key (e.g. 'dental')")
    ap.add_argument("--label", required=True, help="Human label (e.g. 'Dental Clinics')")
    ap.add_argument("--seeds", nargs="+", required=True, help="Seed search terms")
    ap.add_argument("--synonyms", nargs="*", default=[], help="Curated synonym terms")
    ap.add_argument("--cache-dir", default=None, help="Dir to cache LLM expansions")
    ap.add_argument("--no-llm", action="store_true", help="Skip LLM expansion")
    a = ap.parse_args()

    cache_dir = Path(a.cache_dir) if a.cache_dir else None
    terms = expand_terms(a.category, a.label, a.seeds, a.synonyms, cache_dir, a.no_llm)
    print(json.dumps(terms, indent=2))


if __name__ == "__main__":
    main()
