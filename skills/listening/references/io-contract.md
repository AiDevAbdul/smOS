# Listening — I/O Contract

Full input/output schemas, example payloads, and edge-case handling for
`/listening`. Authoritative shape lives in `schemas/listening_snapshot.js`
(`normalize`, `normalizeCompetitor`, `validate`); this file documents it.

## Inputs

### Argument
`node skills/listening/listening.js <slug>` — `<slug>` required (exit 2 if absent).

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

### Validation (`schema.validate`)
Fails (exit 4, writes nothing) when:
- `captured_at` is missing/empty — "a snapshot must be timestamped to trend it".
- Both `competitors` and `mentions` are empty — "nothing captured".
- Any competitor has no `handle`.

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
| No `accounts.instagram_business_id` | No live pull; competitor stubs from handles |
| No page token | Note printed; stubs emitted (no live benchmark) |
| `SMOS_OFFLINE=1` | All live pulls skipped; stubs or capture only |
| `listening_capture.json` has `competitors` | Live path skipped; capture used verbatim (then normalized) |
| One handle private/typo | Logged; that competitor becomes a `{handle, platform}` stub |
| `/tags` fails | Logged; `mentions` stays empty |
| Zero competitors AND zero mentions | Validation fails (exit 4) — surface, do not write an empty snapshot |
| Profile missing | Exit 3 `HALT: <path> not found.` |

## Downstream consumers
`/strategy-brief` reads the latest `listening_snapshot.json`; `/portal` may surface
trend charts from stacked `listening_snapshots` rows.

**Last verified:** 2026-06-22
