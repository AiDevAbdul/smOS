#!/usr/bin/env python3
"""Diff two analyzed Meta Ad Library snapshots.

Surfaces:
  - new ads launched since prior snapshot (per competitor)
  - ads that have stopped delivering
  - changes in spend tier
  - changes in dominant format
  - changes in top CTA
  - top hooks that appeared / disappeared

Inputs can be local analyzed JSON files or Supabase snapshot IDs.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests


def _load_local(path: str) -> dict:
    return json.loads(Path(path).read_text())


def _load_supabase(snapshot_id: str, table: str = "competitor_snapshots") -> dict:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[ERROR] SUPABASE_URL / SUPABASE_SERVICE_KEY missing", file=sys.stderr)
        sys.exit(1)
    resp = requests.get(
        f"{url}/rest/v1/{table}",
        params={"id": f"eq.{snapshot_id}", "select": "payload"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    rows = resp.json()
    if not rows:
        print(f"[ERROR] snapshot {snapshot_id} not found in {table}", file=sys.stderr)
        sys.exit(1)
    return rows[0]["payload"]


def _index_ads_by_competitor(snapshot: dict) -> dict[str, set[str]]:
    """Map competitor name → set of ad IDs."""
    raw = snapshot.get("data") or {}
    return {name: {ad["id"] for ad in ads if ad.get("id")} for name, ads in raw.items()}


def _competitor_metrics(snapshot: dict) -> dict[str, dict]:
    return {c["page_name"]: c for c in snapshot.get("competitors", [])}


def diff_snapshots(prior: dict, current: dict) -> dict:
    prior_ads = _index_ads_by_competitor(prior)
    curr_ads = _index_ads_by_competitor(current)
    prior_m = _competitor_metrics(prior)
    curr_m = _competitor_metrics(current)

    out: dict = {"competitors": {}, "summary": {}}
    all_names = set(prior_ads) | set(curr_ads) | set(prior_m) | set(curr_m)

    for name in sorted(all_names):
        p_ads = prior_ads.get(name, set())
        c_ads = curr_ads.get(name, set())
        new_ids = sorted(c_ads - p_ads)
        killed_ids = sorted(p_ads - c_ads)
        survived = sorted(c_ads & p_ads)

        p = prior_m.get(name, {})
        c = curr_m.get(name, {})

        changes = []
        if p.get("spend_tier") != c.get("spend_tier") and p and c:
            changes.append(f"spend tier {p.get('spend_tier')} → {c.get('spend_tier')}")
        p_fmts, c_fmts = p.get("formats", {}), c.get("formats", {})
        p_dom = max(p_fmts, key=p_fmts.get) if p_fmts else None
        c_dom = max(c_fmts, key=c_fmts.get) if c_fmts else None
        if p_dom != c_dom and p_dom and c_dom:
            changes.append(f"dominant format {p_dom} → {c_dom}")
        p_ctas = set((p.get("top_ctas") or [])[:3])
        c_ctas = set((c.get("top_ctas") or [])[:3])
        added_ctas = c_ctas - p_ctas
        dropped_ctas = p_ctas - c_ctas
        if added_ctas:
            changes.append("new CTAs: " + ", ".join(sorted(added_ctas)))
        if dropped_ctas:
            changes.append("dropped CTAs: " + ", ".join(sorted(dropped_ctas)))

        out["competitors"][name] = {
            "new_ad_count": len(new_ids),
            "killed_ad_count": len(killed_ids),
            "survived_ad_count": len(survived),
            "new_ad_ids_sample": new_ids[:10],
            "killed_ad_ids_sample": killed_ids[:10],
            "changes": changes,
        }

    out["summary"] = {
        "total_new_ads": sum(c["new_ad_count"] for c in out["competitors"].values()),
        "total_killed_ads": sum(c["killed_ad_count"] for c in out["competitors"].values()),
        "competitors_with_changes": [n for n, c in out["competitors"].items() if c["changes"] or c["new_ad_count"] or c["killed_ad_count"]],
    }
    return out


def main():
    parser = argparse.ArgumentParser(description="Diff two Meta Ad Library snapshots")
    parser.add_argument("--prior", required=True, help="Prior analyzed JSON path OR Supabase snapshot id (when --supabase)")
    parser.add_argument("--current", required=True, help="Current analyzed JSON path OR Supabase snapshot id")
    parser.add_argument("--supabase", action="store_true", help="Treat --prior/--current as Supabase snapshot IDs")
    parser.add_argument("--table", default="competitor_snapshots")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    if args.supabase:
        prior = _load_supabase(args.prior, args.table)
        current = _load_supabase(args.current, args.table)
    else:
        prior = _load_local(args.prior)
        current = _load_local(args.current)

    result = diff_snapshots(prior, current)

    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2))
        print(f"\nDiff saved to: {args.output}")

    s = result["summary"]
    print(f"\n── Snapshot Diff ─────────────────────────────────")
    print(f"  New ads:        {s['total_new_ads']}")
    print(f"  Killed ads:     {s['total_killed_ads']}")
    print(f"  Movers:         {len(s['competitors_with_changes'])} competitor(s)")
    for name in s["competitors_with_changes"][:10]:
        c = result["competitors"][name]
        bits = []
        if c["new_ad_count"]:
            bits.append(f"+{c['new_ad_count']} new")
        if c["killed_ad_count"]:
            bits.append(f"-{c['killed_ad_count']} killed")
        bits.extend(c["changes"])
        print(f"    · {name}: {'; '.join(bits)}")
    print("──────────────────────────────────────────────────\n")


if __name__ == "__main__":
    main()
