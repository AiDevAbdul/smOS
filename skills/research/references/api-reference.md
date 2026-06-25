# /research — API Reference

The only external API this skill touches is the **Meta Graph API Ad Library** (`/ads_archive`),
called directly through `scripts/lib/meta-graph.js`. There is **no MCP `search_ad_library`
tool** in this path — `/ads_archive` is canonical. Read this file before changing search
params, field selection, or rate-limit handling.

## Version & Base

- **API version:** `v25.0` (pinned in `scripts/lib/meta-graph.js`: `API_VERSION = "v25.0"`).
- **Base URL:** `https://graph.facebook.com/v25.0`.
- **Auth:** `META_ACCESS_TOKEN` query param, plus `appsecret_proof` (HMAC-SHA256 of the token keyed by the app secret) when the secret is present.
- v25.0 is current (released 2026-02-18). Confirm at the Versions list before re-pinning.

## Endpoint: GET /ads_archive

The Ad Library is **public** — it needs only a valid access token, NOT ad-account access.

`research.js` resolution call (line ~44):
```
GET /ads_archive
  search_terms        = <competitor name>
  ad_reached_countries= ["<CC>"]        # JSON-encoded array string
  ad_active_status    = "ACTIVE"
  fields              = "page_id,page_name"
  limit               = 25
```

`client.py` fetch pass passes resolved page IDs (`search_page_ids`, ≤10), the country, and
the lookback window; it returns full ad bodies and snapshot URLs.

### Key request params

| Param | Notes |
|-------|-------|
| `search_terms` | Free-text brand search (resolution pass) |
| `search_page_ids` | Up to **10** page IDs (fetch pass) |
| `ad_reached_countries` | JSON-encoded array string, e.g. `["US"]` — required |
| `ad_active_status` | `ACTIVE` / `INACTIVE` / `ALL` |
| `ad_type` | Default `ALL`; `POLITICAL_AND_ISSUE_ADS` for transparency set |
| `ad_delivery_date_min/max` | Derived from `--days` lookback |
| `limit` | Page size (25 in resolution; 50 typical in fetch) |

### Returned fields (Archived Ad node)

`page_id`, `page_name`, `ad_creative_bodies[]`, `ad_creative_link_titles[]`,
`ad_creative_link_descriptions[]`, `ad_snapshot_url`, `spend` (range),
`impressions` (range), `funding_entity`, `currency`, demographic/region distribution.
Spend and impressions are **ranges**, never exact.

## Rate Limiting & Errors

`client.py`'s `_paginate()` handles rate-limit responses uniformly — both HTTP 429 and
HTTP 400 with error code 4/17/613 trigger the same exponential backoff path:

| Code | Meaning | Behaviour in `client.py` |
|------|---------|--------------------------|
| 4 | App-level throttle | Backoff 30s × 2^retry, up to 3 retries, then skip term |
| 17 | User-level (`API_EC_USER_TOO_MANY_CALLS`) | Same backoff path |
| 613 | Custom rate limit | Same backoff path |
| 429 | HTTP throttle | Same backoff path (uses `Retry-After` header if present) |
| other 4xx/5xx | Unexpected error | Log and skip (no retry) |

Watch the `X-App-Usage` / `X-Business-Use-Case-Usage` response headers. Always log the
full error — `code`, `type`, `fbtrace_id` — for debugging. After 3 failed retries on a
term, proceed to the next term rather than aborting the whole category.

## Semantic Term Expansion (market.py `--fetch` mode)

`market.py` expands each category's search coverage across three layers before hitting the
Ad Library API. All results are merged and **deduplicated by ad `id`** so the same ad
matched by multiple terms is counted once:

| Layer | Source | Count | Cost |
|-------|--------|-------|------|
| Seed terms | `data/niches/<niche>.json` → `search_terms[]` | 2/category | Free |
| Synonym terms | `data/niches/<niche>.json` → `synonym_terms[]` | 10–12/category | Free |
| LLM variants | claude-haiku, disk-cached after first run | ~8/category | Cheap (one-time) |

Total: up to **20 unique terms per category**, capped to avoid quota exhaustion.

Cache file: `reports/terms_cache_<cat_key>.json`. Delete to force regeneration.
Use `--no-llm` to skip the LLM layer (runs only seed + synonyms — still 12–14 terms).

## Cited Sources

| Resource | URL |
|----------|-----|
| Ads Archive (ads_archive) | https://developers.facebook.com/docs/graph-api/reference/ads_archive/ |
| Archived Ad node | https://developers.facebook.com/docs/graph-api/reference/archived-ad/ |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ |

**Last verified:** 2026-06-22 (URLs resolve on developers.facebook.com; v25.0 confirmed latest).
