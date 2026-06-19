#!/usr/bin/env python3
"""Persist analyzed Meta Ad Library snapshots to Supabase.

Two target tables:
  - competitor_snapshots  (per-client competitor scan)
  - market_snapshots      (per-niche category sweep)
  - prospect_audits       (pre-sale audit run for an unsigned prospect)

Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from env. Idempotent on (client_id|prospect_slug, generated_at).
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from load_env import load_env  # noqa: E402
load_env()

TABLE_COMPETITOR = "competitor_snapshots"
TABLE_MARKET = "market_snapshots"
TABLE_PROSPECT = "prospect_audits"


def _env() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[ERROR] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.", file=sys.stderr)
        sys.exit(1)
    return url, key


def _post(table: str, row: dict) -> dict:
    url, key = _env()
    endpoint = f"{url}/rest/v1/{table}"
    resp = requests.post(
        endpoint,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        },
        json=row,
        timeout=30,
    )
    if resp.status_code >= 300:
        print(f"[ERROR] Supabase {table} insert: {resp.status_code} {resp.text[:300]}", file=sys.stderr)
        sys.exit(1)
    return resp.json()[0] if resp.json() else {}


def persist_competitor(analyzed_path: str, client_id: str, slug: str) -> str:
    """Save analyzed competitor JSON to competitor_snapshots, return snapshot id."""
    data = json.loads(Path(analyzed_path).read_text())
    meta = data["meta"]
    competitors = data["competitors"]

    snapshot_id = str(uuid.uuid4())
    row = {
        "id": snapshot_id,
        "client_id": client_id,
        "slug": slug,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "country": meta.get("country"),
        "lookback_days": meta.get("days"),
        "competitor_count": len(competitors),
        "total_ads_observed": sum(c.get("total_ads", 0) for c in competitors),
        "summary": {
            "top_spender": max(competitors, key=lambda x: x.get("estimated_monthly_spend_usd", 0), default={}).get("page_name"),
            "most_active": max(competitors, key=lambda x: x.get("total_ads", 0), default={}).get("page_name"),
            "ranked": [{"rank": c["rank"], "name": c["page_name"], "score": c["score"]} for c in competitors],
        },
        "payload": data,
    }
    _post(TABLE_COMPETITOR, row)
    print(f"  [persist] competitor_snapshots ← {snapshot_id} ({slug})")
    return snapshot_id


def persist_market(analyzed_path: str, niche_key: str, business_name: str | None = None) -> str:
    data = json.loads(Path(analyzed_path).read_text())
    snapshot_id = str(uuid.uuid4())
    row = {
        "id": snapshot_id,
        "niche": niche_key,
        "business_name": business_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "category_count": len(data.get("categories", [])),
        "payload": data,
    }
    _post(TABLE_MARKET, row)
    print(f"  [persist] market_snapshots ← {snapshot_id} ({niche_key})")
    return snapshot_id


def persist_prospect(report_path: str, slug: str, business_name: str, score: int, summary: dict) -> str:
    snapshot_id = str(uuid.uuid4())
    row = {
        "id": snapshot_id,
        "prospect_slug": slug,
        "business_name": business_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "health_score": score,
        "report_path": report_path,
        "summary": summary,
    }
    _post(TABLE_PROSPECT, row)
    print(f"  [persist] prospect_audits ← {snapshot_id} ({slug})")
    return snapshot_id


def main():
    parser = argparse.ArgumentParser(description="Persist Meta Ad Library snapshots to Supabase")
    sub = parser.add_subparsers(dest="kind", required=True)

    c = sub.add_parser("competitor")
    c.add_argument("--input", required=True, help="Analyzed JSON path")
    c.add_argument("--client-id", required=True)
    c.add_argument("--slug", required=True)

    m = sub.add_parser("market")
    m.add_argument("--input", required=True)
    m.add_argument("--niche", required=True)
    m.add_argument("--business")

    p = sub.add_parser("prospect")
    p.add_argument("--report", required=True)
    p.add_argument("--slug", required=True)
    p.add_argument("--business", required=True)
    p.add_argument("--score", type=int, required=True)
    p.add_argument("--summary", required=True, help="JSON summary string")

    args = parser.parse_args()
    if args.kind == "competitor":
        persist_competitor(args.input, args.client_id, args.slug)
    elif args.kind == "market":
        persist_market(args.input, args.niche, args.business)
    elif args.kind == "prospect":
        persist_prospect(args.report, args.slug, args.business, args.score, json.loads(args.summary))


if __name__ == "__main__":
    main()
