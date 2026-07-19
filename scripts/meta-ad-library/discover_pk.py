#!/usr/bin/env python3
"""Bounded Ad Library category-discovery sweep.

Resolving a specific FB page URL -> Ad Library page_id is not possible via any
public Graph API for New-Pages-Experience pages (their HTML ids are rejected
with code 33). The reliable API-only path to a competitor set is the reverse:
sweep the *category* by service terms, aggregate the ads by (page_name, page_id),
and keep the advertisers whose page name looks like the niche. Every page_id
returned this way IS a valid Ad Library id (it came from real ad rows), so it can
be re-queried precisely with search_page_ids afterwards.
"""
import argparse, json, os, sys, time, re
from collections import defaultdict
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import load_env  # noqa: E402
load_env()

API = "https://graph.facebook.com/v25.0/ads_archive"


def sweep(term, countries, token, max_pages, since):
    params = {
        "access_token": token,
        "ad_reached_countries": json.dumps(countries),
        "search_terms": term,
        "ad_active_status": "ALL",
        "ad_delivery_date_min": since,
        "fields": "page_id,page_name,ad_delivery_start_time,ad_creative_bodies,"
                  "publisher_platforms,call_to_action_type",
        "limit": 100,
    }
    ads, page, retries = [], 1, 0
    while page <= max_pages:
        try:
            r = requests.get(API, params=params, timeout=25)
        except requests.RequestException as e:
            print(f"    net err: {e}", file=sys.stderr); break
        if r.status_code == 429 or (r.status_code == 400 and
                r.json().get("error", {}).get("code") in (4, 17, 613)):
            if retries >= 2:
                print("    rate-limited, giving up this term", file=sys.stderr); break
            w = 20 * (retries + 1); print(f"    rate-limited, wait {w}s", file=sys.stderr)
            time.sleep(w); retries += 1; continue
        if r.status_code != 200:
            print(f"    err {r.status_code}: {r.text[:120]}", file=sys.stderr); break
        d = r.json(); rows = d.get("data", []); ads.extend(rows)
        nxt = d.get("paging", {}).get("next")
        if not nxt or not rows:
            break
        params["after"] = d["paging"]["cursors"]["after"]; page += 1; time.sleep(0.4)
    return ads


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--terms", nargs="+", required=True)
    ap.add_argument("--country", default="PK")
    ap.add_argument("--max-pages", type=int, default=5)
    ap.add_argument("--since", default="2025-01-01")
    ap.add_argument("--match", default=None,
                    help="regex; keep only pages whose name matches (niche filter)")
    ap.add_argument("--output", required=True)
    a = ap.parse_args()
    token = os.environ.get("META_ACCESS_TOKEN") or sys.exit("META_ACCESS_TOKEN not set")
    countries = [c.strip().upper() for c in a.country.split(",")]

    by_page = defaultdict(lambda: {"page_name": None, "ads": [], "starts": []})
    for t in a.terms:
        print(f"sweeping: {t!r}", file=sys.stderr)
        for ad in sweep(t, countries, token, a.max_pages, a.since):
            pid = ad.get("page_id")
            if not pid:
                continue
            e = by_page[pid]; e["page_name"] = ad.get("page_name")
            e["ads"].append(ad)
            if ad.get("ad_delivery_start_time"):
                e["starts"].append(ad["ad_delivery_start_time"])

    rx = re.compile(a.match, re.I) if a.match else None
    pages = []
    for pid, e in by_page.items():
        name = e["page_name"] or ""
        if rx and not rx.search(name):
            continue
        pages.append({
            "page_id": pid, "page_name": name,
            "ad_count_sampled": len(e["ads"]),
            "earliest_start": min(e["starts"]) if e["starts"] else None,
            "latest_start": max(e["starts"]) if e["starts"] else None,
            "sample_ctas": sorted({x.get("call_to_action_type") for x in e["ads"] if x.get("call_to_action_type")}),
        })
    pages.sort(key=lambda x: -x["ad_count_sampled"])
    out = {"terms": a.terms, "country": countries, "since": a.since,
           "total_pages": len(by_page), "kept_pages": len(pages), "pages": pages}
    Path(a.output).parent.mkdir(parents=True, exist_ok=True)
    json.dump(out, open(a.output, "w"), ensure_ascii=False, indent=2)
    print(f"\nkept {len(pages)}/{len(by_page)} pages -> {a.output}")
    for p in pages[:20]:
        print(f"  {p['ad_count_sampled']:3d}  {p['page_name']}  ::  {p['page_id']}")


if __name__ == "__main__":
    main()
