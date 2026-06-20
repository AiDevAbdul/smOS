#!/usr/bin/env python3
"""Fetch ads from Meta Ad Library API for given competitor pages."""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import load_env  # noqa: E402
load_env()

API_BASE = "https://graph.facebook.com/v25.0/ads_archive"
DEFAULT_FIELDS = (
    "id,page_id,page_name,ad_creation_time,ad_delivery_start_time,"
    "ad_delivery_stop_time,ad_creative_bodies,ad_creative_link_captions,"
    "ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url,"
    "publisher_platforms,impressions,spend,estimated_audience_size,languages,"
    "call_to_action_type,bylines"
)


def get_token() -> str:
    token = os.environ.get("META_ACCESS_TOKEN", "")
    if not token:
        print(
            "\n[ERROR] META_ACCESS_TOKEN not set.\n"
            "Setup:\n"
            "  1. https://developers.facebook.com → create app → add Marketing API\n"
            "  2. Generate User Token with ads_read scope\n"
            "  3. export META_ACCESS_TOKEN=<your_token>\n"
        )
        sys.exit(1)
    return token


def resolve_page_id_from_url(page_url: str) -> str | None:
    """
    Extract numeric page ID from a Facebook page URL by scraping the page HTML.
    Looks for patterns like "page_id":"<id>" or entity_id in the page source.
    """
    slug = page_url.rstrip("/").split("/")[-1]
    # If it's already numeric, return as-is
    if slug.isdigit():
        return slug

    url = f"https://www.facebook.com/{slug}/"
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                )
            },
            timeout=15,
        )
    except requests.RequestException as e:
        print(f"  [WARN] Could not fetch page for '{slug}': {e}")
        return None

    html = resp.text
    patterns = [
        r'"page_id"\s*:\s*"(\d{10,20})"',
        r'"pageID"\s*:\s*"(\d{10,20})"',
        r'entity_id=(\d{10,20})',
        r'"identifier"\s*:\s*"(\d{10,20})"',
    ]
    for pattern in patterns:
        m = re.search(pattern, html)
        if m:
            return m.group(1)

    return None


def fetch_ads_for_page_id(page_id: str, page_label: str, country: str, days: int, token: str, media_type: str | None = None) -> list[dict]:
    """Fetch all ads for a specific numeric page ID using search_page_ids.

    Args:
        media_type: Optional filter — "ALL", "IMAGE", "VIDEO", "MEME", or "NONE".
                    When set, only ads of that media type are returned.
                    Each returned ad is tagged with _media_type for downstream use.
    """
    since_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    params = {
        "access_token": token,
        "ad_reached_countries": json.dumps(_parse_countries(country)),
        "search_page_ids": page_id,
        "ad_active_status": "ALL",
        "ad_delivery_date_min": since_date,
        "fields": DEFAULT_FIELDS,
        "limit": 100,
    }
    if media_type:
        params["media_type"] = media_type

    ads = _paginate(params, page_label)
    if media_type:
        for ad in ads:
            ad["_media_type"] = media_type
    return ads


def fetch_ads_by_terms(search_terms: str, country: str, days: int, token: str, media_type: str | None = None) -> list[dict]:
    """Fallback: fetch ads by keyword search across ad copy (less precise).

    Args:
        media_type: Optional filter — "ALL", "IMAGE", "VIDEO", "MEME", or "NONE".
                    When set, only ads of that media type are returned.
                    Each returned ad is tagged with _media_type for downstream use.
    """
    since_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    params = {
        "access_token": token,
        "ad_reached_countries": json.dumps(_parse_countries(country)),
        "search_terms": search_terms,
        "ad_active_status": "ALL",
        "ad_delivery_date_min": since_date,
        "fields": DEFAULT_FIELDS,
        "limit": 100,
    }
    if media_type:
        params["media_type"] = media_type

    ads = _paginate(params, search_terms)
    if media_type:
        for ad in ads:
            ad["_media_type"] = media_type
    return ads


def _parse_countries(country: str) -> list[str]:
    """Parse country argument into list of ISO-3166-1 alpha-2 codes.

    Meta's ad_reached_countries requires explicit ISO codes — there is no "ALL".
    Accepts a single code ("US"), comma-separated list ("US,CA,GB"), or "WW"/"ALL"
    which expands to a broad default set.
    """
    WORLDWIDE = ["US", "CA", "GB", "AU", "DE", "FR", "IT", "ES", "NL", "BR", "MX", "IN", "PK", "AE", "SA"]
    raw = country.strip().upper()
    if raw in ("ALL", "WW", "WORLDWIDE"):
        return WORLDWIDE
    codes = [c.strip() for c in raw.split(",") if c.strip()]
    for c in codes:
        if not (len(c) == 2 and c.isalpha()):
            print(f"\n[ERROR] Invalid country code '{c}'. Use ISO-3166-1 alpha-2 (e.g. US, GB, PK) or 'ALL' for worldwide set.\n")
            sys.exit(1)
    return codes


def _paginate(params: dict, label: str) -> list[dict]:
    """Run paginated requests and return all ads."""
    all_ads = []
    page_num = 1
    retries = 0

    while True:
        try:
            resp = requests.get(API_BASE, params=params, timeout=30)
        except requests.RequestException as e:
            print(f"  [WARN] Network error for '{label}': {e}")
            break

        if resp.status_code == 429:
            if retries >= 3:
                print(f"  [WARN] Rate limit hit for '{label}', skipping after 3 retries.")
                break
            wait = int(resp.headers.get("Retry-After", 10))
            print(f"  [WARN] Rate limited — waiting {wait}s (retry {retries + 1}/3)")
            time.sleep(wait)
            retries += 1
            continue

        if resp.status_code != 200:
            print(f"  [WARN] API error {resp.status_code} for '{label}': {resp.text[:200]}")
            break

        retries = 0
        data = resp.json()
        ads = data.get("data", [])
        all_ads.extend(ads)
        print(f"  Page {page_num}: fetched {len(ads)} ads (total: {len(all_ads)})")

        paging = data.get("paging", {})
        if not paging.get("next"):
            break

        params["after"] = paging["cursors"]["after"]
        page_num += 1
        time.sleep(0.5)

    return all_ads


def main():
    parser = argparse.ArgumentParser(description="Fetch Meta Ads competitor data")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--urls", nargs="+",
        help="Facebook page URLs (e.g. https://www.facebook.com/Nike/). Resolves to page IDs for exact matching."
    )
    group.add_argument(
        "--page-ids", nargs="+",
        help="Numeric Facebook page IDs for exact matching."
    )
    group.add_argument(
        "--pages", nargs="+",
        help="Keyword search terms (less precise — searches ad copy, not page names)."
    )
    parser.add_argument("--country", default="US", help="ISO-3166-1 alpha-2 code, comma-separated list (US,CA,GB), or 'ALL' for worldwide set (default: US)")
    parser.add_argument("--days", type=int, default=90, help="Lookback days (default: 90)")
    parser.add_argument("--output", default=None, help="Output JSON file path")
    parser.add_argument(
        "--media-type", default=None,
        choices=["ALL", "IMAGE", "VIDEO", "MEME", "NONE"],
        help="Filter by media type (default: no filter = all types)",
    )
    args = parser.parse_args()

    token = get_token()
    Path("reports").mkdir(exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_path = args.output or f"reports/raw_{timestamp}.json"

    result = {
        "meta": {
            "timestamp": timestamp,
            "country": args.country,
            "days": args.days,
            "competitors": [],
        },
        "data": {},
    }

    if args.urls:
        for url in args.urls:
            slug = url.rstrip("/").split("/")[-1]
            print(f"\nResolving page ID for: {url}")
            page_id = resolve_page_id_from_url(url)
            if not page_id:
                print(f"  [WARN] Could not resolve page ID for '{slug}' — skipping.")
                continue
            print(f"  Resolved page ID: {page_id}")
            result["meta"]["competitors"].append(slug)
            print(f"  Fetching ads...")
            ads = fetch_ads_for_page_id(page_id, slug, args.country, args.days, token, media_type=args.media_type)
            result["data"][slug] = ads
            _report_result(slug, ads)

    elif args.page_ids:
        for page_id in args.page_ids:
            label = f"page:{page_id}"
            result["meta"]["competitors"].append(label)
            print(f"\nFetching ads for page ID: {page_id}")
            ads = fetch_ads_for_page_id(page_id, label, args.country, args.days, token, media_type=args.media_type)
            result["data"][label] = ads
            _report_result(label, ads)

    else:
        for term in args.pages:
            result["meta"]["competitors"].append(term)
            print(f"\nFetching ads for search term: '{term}'")
            print("  [NOTE] --pages uses keyword search across ad copy, not exact page matching.")
            print("         Use --urls for exact page lookup.")
            ads = fetch_ads_by_terms(term, args.country, args.days, token, media_type=args.media_type)
            result["data"][term] = ads
            _report_result(term, ads)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\nRaw data saved to: {output_path}")
    return output_path


def _report_result(label: str, ads: list[dict]) -> None:
    if not ads:
        print(f"  [WARN] No ads found for '{label}' — page may have no paid ads or privacy restrictions.")
    else:
        from collections import Counter
        pages = Counter(ad.get("page_name", "unknown") for ad in ads)
        print(f"  Done: {len(ads)} total ads across {len(pages)} page(s): {list(pages.keys())[:5]}")


if __name__ == "__main__":
    main()
