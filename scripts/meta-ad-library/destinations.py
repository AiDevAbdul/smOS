#!/usr/bin/env python3
"""Extract landing page destinations and offer types from fetched Ad Library data.

Works on already-fetched ad data (raw JSON files from client.py or collect.py) --
no additional HTTP requests are made.

CLI usage:
    python destinations.py --input raw_*.json
    python destinations.py --input reports/raw_20260715_120000.json --output destinations.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

OFFER_PATTERNS: dict[str, re.Pattern] = {
    "free_trial": re.compile(r"free trial|try free|start free", re.IGNORECASE),
    "discount": re.compile(r"\d+%\s*off|save \d+%|discount", re.IGNORECASE),
    "bogo": re.compile(r"buy one get|bogo|2[- ]?for[- ]?1", re.IGNORECASE),
    "money_back": re.compile(r"money[- ]?back|guarantee|risk[- ]?free", re.IGNORECASE),
    "free_shipping": re.compile(r"free shipping|free delivery", re.IGNORECASE),
    "limited_time": re.compile(
        r"limited time|ends? (today|soon|tonight)|last chance", re.IGNORECASE
    ),
    "free_quote": re.compile(r"free (quote|estimate|consultation)", re.IGNORECASE),
    "coupon": re.compile(r"coupon|promo code|use code", re.IGNORECASE),
}

_APP_STORE_DOMAINS = frozenset({
    "play.google.com",
    "apps.apple.com",
    "itunes.apple.com",
    "appgallery.huawei.com",
})

_MESSENGER_PATTERNS = re.compile(
    r"m\.me/|messenger\.com|wa\.me/|api\.whatsapp\.com|t\.me/", re.IGNORECASE
)


def _extract_domains_from_text(text: str) -> list[str]:
    """Pull domain names from URLs embedded in text."""
    domains: list[str] = []
    for url_match in re.finditer(r"https?://[^\s\"'<>]+", text):
        try:
            parsed = urlparse(url_match.group())
            host = parsed.hostname
            if host:
                # Strip www. prefix for cleaner counting
                host = re.sub(r"^www\.", "", host)
                domains.append(host)
        except Exception:
            pass
    return domains


def _classify_destination(domain: str) -> str:
    """Classify a domain into a destination category."""
    if domain in _APP_STORE_DOMAINS:
        return "app_store"
    if "facebook.com" in domain or "fb.com" in domain:
        return "facebook"
    if "instagram.com" in domain:
        return "instagram"
    if "messenger.com" in domain or domain == "m.me":
        return "messenger"
    if "wa.me" in domain or "whatsapp.com" in domain:
        return "whatsapp"
    if "t.me" in domain or "telegram.org" in domain:
        return "telegram"
    return "website"


def _gather_ad_text(ad: dict) -> str:
    """Concatenate all text fields from an ad for pattern matching."""
    parts: list[str] = []
    for field in (
        "ad_creative_bodies",
        "ad_creative_link_captions",
        "ad_creative_link_titles",
        "ad_creative_link_descriptions",
    ):
        val = ad.get(field)
        if isinstance(val, list):
            parts.extend(str(v) for v in val)
        elif isinstance(val, str):
            parts.append(val)
    return " ".join(parts)


def _gather_urls_from_ad(ad: dict) -> list[str]:
    """Extract all URL-bearing text from an ad to find domains."""
    parts: list[str] = []
    for field in (
        "ad_creative_link_captions",
        "ad_creative_link_descriptions",
        "ad_creative_link_titles",
        "ad_creative_bodies",
    ):
        val = ad.get(field)
        if isinstance(val, list):
            parts.extend(str(v) for v in val)
        elif isinstance(val, str):
            parts.append(val)
    snapshot = ad.get("ad_snapshot_url", "")
    if snapshot:
        parts.append(snapshot)
    return parts


def extract_destinations(ads: list[dict]) -> dict:
    """From fetched ad data, extract destination and offer signals.

    Returns:
        landing_domains: Counter of domains ads link to (excluding Meta's own)
        offers_detected: list of {type, count, example_body} for each offer pattern found
        has_app_install: whether any ads point to app stores
        destination_types: Counter of destination categories (website, app_store, messenger, etc.)
    """
    landing_domains: Counter[str] = Counter()
    destination_types: Counter[str] = Counter()
    offer_hits: dict[str, list[str]] = {k: [] for k in OFFER_PATTERNS}
    has_app_install = False

    for ad in ads:
        # --- Domain extraction ---
        url_texts = _gather_urls_from_ad(ad)
        ad_domains: set[str] = set()
        for text in url_texts:
            for domain in _extract_domains_from_text(text):
                ad_domains.add(domain)
        # Also treat link captions as potential display domains (e.g. "example.com")
        for field in ("ad_creative_link_captions",):
            val = ad.get(field)
            if isinstance(val, list):
                for caption in val:
                    caption_clean = str(caption).strip().lower()
                    # Display URLs often appear as bare domains in captions
                    if re.match(r"^[a-z0-9]([a-z0-9\-]*\.)+[a-z]{2,}$", caption_clean):
                        ad_domains.add(re.sub(r"^www\.", "", caption_clean))

        for domain in ad_domains:
            # Skip Meta snapshot domains — those are Meta's ad preview, not the landing page
            if "facebook.com/ads/archive" in domain:
                continue
            landing_domains[domain] += 1
            dest_type = _classify_destination(domain)
            destination_types[dest_type] += 1
            if dest_type == "app_store":
                has_app_install = True

        # --- Messenger / WhatsApp detection from CTA or text ---
        full_text = _gather_ad_text(ad)
        if _MESSENGER_PATTERNS.search(full_text):
            destination_types["messenger"] += 1

        cta = ad.get("call_to_action_type", "")
        if cta:
            cta_upper = cta.upper()
            if "MESSAGE" in cta_upper or "WHATSAPP" in cta_upper:
                destination_types["messenger"] += 1
            elif "INSTALL" in cta_upper or "DOWNLOAD" in cta_upper or "USE_APP" in cta_upper:
                has_app_install = True
                destination_types["app_store"] += 1

        # --- Offer pattern detection ---
        for offer_type, pattern in OFFER_PATTERNS.items():
            if pattern.search(full_text):
                # Capture a short example (first body line)
                bodies = ad.get("ad_creative_bodies", [])
                example = bodies[0][:120] if bodies else full_text[:120]
                offer_hits[offer_type].append(example)

    # Build offers_detected list (only types that were actually found)
    offers_detected: list[dict] = []
    for offer_type, examples in offer_hits.items():
        if examples:
            offers_detected.append({
                "type": offer_type,
                "count": len(examples),
                "example_body": examples[0],
            })
    offers_detected.sort(key=lambda o: o["count"], reverse=True)

    return {
        "landing_domains": dict(landing_domains.most_common(20)),
        "offers_detected": offers_detected,
        "has_app_install": has_app_install,
        "destination_types": dict(destination_types),
    }


def summarize_offers(competitors: dict[str, list[dict]]) -> dict:
    """Per-competitor offer summary for the report.

    Args:
        competitors: mapping of competitor label -> list of ad dicts.

    Returns:
        dict keyed by competitor label, each containing:
        - top_domains: list of (domain, count) tuples (top 5)
        - offer_types: list of detected offer types with counts
        - primary_destination: most common destination type
        - has_app_install: bool
    """
    summary: dict[str, dict] = {}

    for label, ads in competitors.items():
        if not ads:
            summary[label] = {
                "top_domains": [],
                "offer_types": [],
                "primary_destination": "unknown",
                "has_app_install": False,
            }
            continue

        dest = extract_destinations(ads)
        domain_counts = dest["landing_domains"]
        # Filter out Meta's own domains from top-domains list
        filtered = {
            d: c for d, c in domain_counts.items()
            if not any(x in d for x in ("facebook.com", "fb.com", "instagram.com"))
        }
        top_domains = sorted(filtered.items(), key=lambda x: x[1], reverse=True)[:5]

        dest_types = dest["destination_types"]
        primary = max(dest_types, key=dest_types.get) if dest_types else "unknown"

        summary[label] = {
            "top_domains": top_domains,
            "offer_types": [
                {"type": o["type"], "count": o["count"]} for o in dest["offers_detected"]
            ],
            "primary_destination": primary,
            "has_app_install": dest["has_app_install"],
        }

    return summary


def _load_ads_from_file(path: Path) -> dict[str, list[dict]]:
    """Load ads from a raw JSON file (client.py or collect.py format).

    Supports two formats:
      - client.py output: {"data": {"label": [ads...]}, ...}
      - collect.py output: {"data": [ads...]} or {"competitors": [{"data": [ads...]}, ...]}

    Returns a dict of label -> ads list.
    """
    raw = json.loads(path.read_text(encoding="utf-8"))

    # client.py format: {"meta": {...}, "data": {"slug1": [...], "slug2": [...]}}
    if isinstance(raw.get("data"), dict):
        return {label: ads for label, ads in raw["data"].items() if isinstance(ads, list)}

    # collect.py ads_competitors.json format
    if "competitors" in raw and isinstance(raw["competitors"], list):
        result: dict[str, list[dict]] = {}
        for i, comp in enumerate(raw["competitors"]):
            label = comp.get("url") or comp.get("page_id") or f"competitor_{i}"
            ads = comp.get("data", [])
            if isinstance(ads, list):
                result[label] = ads
        return result

    # collect.py ads_self.json format: {"data": [...]}
    if isinstance(raw.get("data"), list):
        label = raw.get("url") or raw.get("page_id") or path.stem
        return {label: raw["data"]}

    # Bare list of ads
    if isinstance(raw, list):
        return {path.stem: raw}

    print(f"[WARN] Unrecognized format in {path}, skipping.", file=sys.stderr)
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract destination/offer signals from fetched Ad Library data"
    )
    parser.add_argument(
        "--input", nargs="+", required=True,
        help="Raw JSON file(s) from client.py or collect.py",
    )
    parser.add_argument(
        "--output", default=None,
        help="Output JSON file path (default: stdout)",
    )
    args = parser.parse_args()

    all_competitors: dict[str, list[dict]] = {}
    for input_path in args.input:
        p = Path(input_path)
        if not p.exists():
            print(f"[WARN] File not found: {p}", file=sys.stderr)
            continue
        loaded = _load_ads_from_file(p)
        for label, ads in loaded.items():
            all_competitors.setdefault(label, []).extend(ads)

    if not all_competitors:
        print("[ERROR] No ad data found in input files.", file=sys.stderr)
        sys.exit(1)

    total_ads = sum(len(ads) for ads in all_competitors.values())
    print(
        f"[destinations] Loaded {total_ads} ads across "
        f"{len(all_competitors)} competitor(s).",
        file=sys.stderr,
    )

    result = {
        "per_competitor": summarize_offers(all_competitors),
        "combined": extract_destinations(
            [ad for ads in all_competitors.values() for ad in ads]
        ),
    }

    output_json = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_json, encoding="utf-8")
        print(f"[destinations] Wrote {out_path}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
