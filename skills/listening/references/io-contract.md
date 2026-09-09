# Listening — I/O Contract

Full input/output schemas, example payloads, and edge-case handling for
`/listening`. Authoritative shape lives in `schemas/listening_snapshot.js`
(`normalize`, `normalizeCompetitor`, `validate`); this file documents it.

## Inputs

### Argument + flags
`node skills/listening/listening.js <slug> [flags]` — `<slug>` required (exit 2 if absent).

| Flag | Mode |
|---|---|
| `--show-watchlist` | read-only, prints watchlist, exits 0 |
| `--add-brand-term T` `--add-keyword T` `--add-hashtag T` `--add-competitor H` (repeatable) | mutate watchlist, print, exit 0 — no API calls |
| `--remove T` | mutate watchlist, print, exit 0 |
| `--hashtag-search` `--fb-comments` `--web-search` | enable an untagged-discovery source for this capture |
| `--baseline-window N` | rolling-baseline window in points (default 14) |
| `--no-timeseries` | skip appending this run to the baseline |

### `clients/{slug}/data/listening_watchlist.json` (read + written)
Authoritative once it exists; seeded from the profile on first run so nothing is lost.
```json
{
  "client_slug": "acme", "updated_at": "2026-09-09T10:00:00Z",
  "brand_terms": ["acme care", "acmecare"],
  "keywords": ["oil change"],
  "hashtags": ["acmecare", "carrepair"],
  "competitors": [{ "handle": "rivalbrand", "name": "Rival Brand", "terms": ["rivalbrand", "rival brand"] }]
}
```
All terms are canonical: trimmed, lowercased, leading `#`/`@` stripped (`canonTerm`).
An unreadable file is exit 6 (**never** silently an empty watchlist); an empty watchlist
is exit 7.

### `clients/{slug}/data/listening_timeseries.json` (read + appended)
Append-only, idempotent per `captured_at`, one point per run:
```json
{ "client_slug": "acme", "points": [
  { "captured_at": "2026-09-08T10:00:00Z", "mentions": 6, "all_matched_mentions": 11,
    "untagged": 8, "classified": 6, "negative": 1,
    "sources_measured": ["ig_tags", "ig_hashtag"], "is_floor": true }
] }
```
`mentions` is the **brand-attributable** count — the volume a crisis is about. An
unreadable file is treated as NO baseline, not a zero baseline.

### `clients/{slug}/client_profile.json` (read)
Fields consulted (first present wins):

| Need | Profile path(s) |
|---|---|
| Competitor handles | `competitors[].handle` / `competitors[].name`, else `competitor_handles[]` |
| Tracked keywords | `tracked_keywords[]`, else `seo_keywords[]` |
| Client IG id | `accounts.instagram_business_id` |

### `clients/{slug}/listening_capture.json` (optional, read)
Manual/3rd-party export merged instead of a live pull. When `competitors` is
present here, the live Business Discovery path is skipped.
```json
{
  "competitors": [
    { "handle": "rivalbrand", "platform": "instagram", "followers": 48200,
      "follower_growth_30d": 1100, "posts_per_week": 4.3,
      "engagement_rate": 2.81, "top_formats": ["REELS","IMAGE"] }
  ],
  "mentions": [
    { "source": "twitter", "text": "love this brand", "sentiment": "positive",
      "url": "https://x.com/...", "at": "2026-06-21T10:00:00Z" }
  ]
}
```

### Environment
`SMOS_OFFLINE=1` (skip all live pulls), page/IG token (`META_PAGE_TOKEN_<SLUG>`
or profile), Supabase URL + service key.

## Output 1 — `clients/{slug}/listening_snapshot.json`

Produced by `schema.normalize(...)`, then `schema.validate(...)`.

```json
{
  "client_slug": "acme",
  "captured_at": "2026-06-22T14:03:11.482Z",
  "keywords": ["acme widgets", "acme support"],
  "mentions": [
    { "source": "instagram", "text": "tagged us in their story",
      "sentiment": null, "url": "https://instagram.com/p/...",
      "at": "2026-06-21T09:12:00Z" }
  ],
  "competitors": [
    { "handle": "rivalbrand", "platform": "instagram", "followers": 48200,
      "follower_growth_30d": null, "posts_per_week": 4.3,
      "engagement_rate": 2.81, "top_formats": ["REELS","IMAGE"] }
  ]
}
```

### Field semantics

| Field | Type | Rule |
|---|---|---|
| `client_slug` | string\|null | from `client_slug`/`slug` |
| `captured_at` | ISO string | **required** by `validate` — must be non-empty |
| `keywords` | string[] | from `keywords`/`tracked_terms` |
| `mentions[].source` | string\|null | platform of the mention |
| `mentions[].text` | string | default `""` |
| `mentions[].sentiment` | `positive`\|`neutral`\|`negative`\|null | never invented |
| `mentions[].url` | string\|null | `url`/`link` |
| `mentions[].at` | string\|null | `at`/`timestamp`/`created_time` |
| `competitors[].handle` | string\|null | **required per competitor** by `validate` |
| `competitors[].platform` | string | lowercased; default `instagram` |
| `competitors[].followers` | number | coerced to `0` if missing |
| `competitors[].follower_growth_30d` | number\|null | finite or `null` |
| `competitors[].posts_per_week` | number\|null | `posts_per_week`/`cadence`, finite or `null` |
| `competitors[].engagement_rate` | number\|null | finite or `null` |
| `competitors[].top_formats` | string[] | array, possibly empty |
| `mentions[].mention_id` | string | deterministic over (source, url, at, text-prefix) — a re-pulled mention is not a new row |
| `mentions[].discovery` | `tagged`\|`untagged`\|null | `tagged` when the client was @-tagged **or** the source is tagged-only |
| `mentions[].matched_terms` | `{brand_terms,keywords,hashtags,competitors}` | canonical terms the text hit |
| `mentions[].about_client` | boolean\|null | true when tagged, or when a brand term appears; false ⇒ counted for a competitor, not the client |

### Depth layers (E5)

**`coverage[]`** — one row per source, plus one per unreachable platform:
```json
{ "source": "ig_hashtag", "platform": "instagram", "discovers": "untagged",
  "status": "partial", "mentions": 7, "truncated": false,
  "queried": "#acmecare, #carrepair",
  "limitation": "public top-level posts carrying a queried hashtag only; ~24h recency window; 30 unique hashtags per IG user per rolling 7 days" }
```
| `status` | Meaning | `mentions` |
|---|---|---|
| `partial` | ran; its ceiling is partial (every smOS source is) | number (0 = looked, found nothing) |
| `unavailable` | no API path / no token / no key | **null** |
| `error` | the call failed | **null** |
| `skipped` | deliberately not run (offline, flag off) | **null** |

**`mention_total`** — `{ total, is_floor, basis, unmeasured, reason }`. `total` is `null`
when no source produced data. `is_floor` is true whenever a contributing source is partial
or truncated, or any platform is unmeasured — i.e. essentially always.

**`share_of_voice`** — client vs named competitors over the measured platforms only:
```json
{ "entities": [{ "entity": "Acme Care", "is_client": true, "mentions": 2, "share_pct": 66.7 },
               { "entity": "Rival Brand", "handle": "rivalbrand", "mentions": 1, "share_pct": 33.3 }],
  "total_attributed": 3, "basis_platforms": ["instagram"], "unmeasured_platforms": ["tiktok","x"],
  "confidence": 0.25, "is_floor": true, "status": "computed", "reason": "..." }
```
`status` is `no_data` (nothing measured — shares `null`), `no_attributable_mentions`
(measured but nothing matched — shares `null`, *not* a 0/100 split) or `computed`. With no
`brand_terms` the client row's `mentions`/`share_pct` are `null` with a reason.

**`crisis`** — see `domain-standards.md` §5 for the weights and bands:
```json
{ "severity": "elevated", "status": "computed", "score": 0.6, "confidence": 0.63,
  "severity_provisional": false, "requires_human": true,
  "baseline": { "mean": 5, "stddev": 0.63, "points": 5, "sufficient": true, "required": 5 },
  "sentiment": { "negative_share": null, "classified": 2, "required": 5, "sufficient": false },
  "signals": [{ "name": "volume_spike", "weight": 3, "score": 1, "detail": { "ratio": 5 } }],
  "evidence": ["volume 25 vs baseline mean 5 over 5 point(s) = 5x"] }
```
`severity` is `null` with `status:"insufficient_data"` when fewer than 5 prior points
exist, or when no signal had data.

### Validation (`schema.validate`)
Fails (exit 4, writes nothing) when:
- `captured_at` is missing/empty — "a snapshot must be timestamped to trend it".
- `competitors`, `mentions` **and** `coverage` are all empty — "nothing captured".
- Any competitor has no `handle`.
- A `coverage[]` row has no `status`.
- A `coverage[]` row that did not run carries a non-null `mentions` — "an unreached source
  must report null, never 0".
- A `coverage[]` row that ran has no numeric `mentions`.

## Output 2 — Supabase `listening_snapshots` (append-only)

Best-effort when `supabaseConfigured()`. One row per run:
```json
{ "client_id": "<uuid via clientIdBySlug>", "slug": "acme",
  "captured_at": "2026-06-22T14:03:11.482Z", "snapshot": { /* full snapshot */ } }
```
Append-only by design — trends come from stacking rows, never updating one.
Insert failure is logged (`supabase persist skipped`) and is non-fatal.

## Output 3 — stdout
`listening: N competitors · M mentions · K keywords → listening_snapshot.json`

## Edge cases

| Case | Handling |
|---|---|
| No `accounts.instagram_business_id` | No live pull; competitor stubs from handles; live sources `unavailable` (`mentions: null`) |
| No page token | Note printed; stubs emitted (no live benchmark); live sources `unavailable` |
| `SMOS_OFFLINE=1` | All live pulls skipped (`status:"skipped"`, `mentions:null`); stubs or capture only |
| Watchlist file unreadable | Exit 6 HALT — never degraded to an empty watchlist |
| Watchlist empty (and profile carried no terms) | Exit 7 with the `--add-*` command to run |
| `--web-search` without `TAVILY_API_KEY` | `web_search` coverage row `unavailable` with the reason |
| Every web-search query fails | `web_search` row is `error` (`mentions: null`) — not 0 |
| A mention matching nothing on the watchlist | Discarded; the count is reported as `discarded_unmatched` |
| Fewer than 5 prior time-series points | `crisis.severity: null`, `status: "insufficient_data"` |
| Fewer than 5 sentiment-classified mentions | `negative_skew` signal excluded from the denominator (not scored 0); `confidence` drops |
| Time series unreadable | Treated as NO baseline; a reason is appended to `crisis.reasons` |
| `listening_capture.json` has `competitors` | Live path skipped; capture used verbatim (then normalized) |
| One handle private/typo | Logged; that competitor becomes a `{handle, platform}` stub |
| `/tags` fails | Logged; `mentions` stays empty |
| Zero competitors AND zero mentions AND zero coverage rows | Validation fails (exit 4) — surface, do not write an empty snapshot. (A run that produced coverage rows but no mentions is valid: "we looked, here is exactly how far we could see" is a real finding.) |
| Profile missing | Exit 3 `HALT: <path> not found.` |

## Downstream consumers
`/strategy-brief` reads the latest `listening_snapshot.json`; `/portal` surfaces the
competitor/mention counts and may chart trends from stacked `listening_snapshots` rows or
from `listening_timeseries.json`. Anything that quotes a mention count or a share to a
human MUST carry the `is_floor` / `basis_platforms` / `confidence` qualifiers with it.

**Last verified:** 2026-06-22; depth layers (watchlist, coverage, share of voice, crisis,
time series) added 2026-09-09.
