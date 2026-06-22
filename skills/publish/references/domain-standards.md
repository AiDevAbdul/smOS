# /publish — Domain Standards (Organic Publishing)

Self-contained embedded expertise for the organic content calendar runner. Thresholds,
taxonomies, timing, and formulas live here so the runtime never has to discover them.

## Platform / Format Taxonomy

`platform` ∈ {`facebook`, `instagram`}. `format` is dispatched as:

| platform | format | API path | Notes |
|----------|--------|----------|-------|
| facebook | `post` | `POST /{page_id}/feed` | text + optional `link` |
| facebook | `image` | `POST /{page_id}/photos` | needs `image_url`; falls back to `/feed` if none |
| instagram | `image` | `/media` → `/media_publish` | needs `image_url`; no container poll required |
| instagram | `video` | `/media` (`media_type=VIDEO`) → poll → publish | needs `video_url` |
| instagram | `reels` | `/media` (`media_type=REELS`) → poll → publish | `share_to_feed` default true; optional `cover_url` |
| instagram | `carousel` | 2–10 child `/media` → parent `CAROUSEL` → publish | slides via `item.items[]` |

Carousel slide type is read from `media_type` (`IMAGE`/`VIDEO`) or `format` (`image`/`video`);
VIDEO slides are polled to `FINISHED` before the parent is assembled.

## Hard Limits & Floors (CONSTANT — encoded in the skill)

| Constant | Value | Source of truth |
|----------|-------|-----------------|
| IG publish quota | 100 API posts / rolling 24h (carousel counts as 1) | IG Content Publishing guide |
| Carousel slides | min 2, max 10 | IG carousel spec |
| IG container poll timeout | 60 000 ms per item | `IG_CONTAINER_TIMEOUT_MS` |
| IG container poll interval | 3 000 ms | `IG_CONTAINER_POLL_MS` |
| FB native scheduling floor | `publish_at` ≥ now + 600 s (10 min) | Meta rejects sooner |
| Graph API version | v25.0 | `scripts/lib/meta-graph.js` |

> Do not hardcode the IG quota as a gate — the live `content_publishing_limit` endpoint
> returns the real per-account `quota_total`. The skill instead reacts to the limit *error*
> (see below) rather than pre-counting, which is robust to per-account quota differences.

## Due-Selection Rule

An item is "due" iff `status == "pending"` AND (`publish_at` is absent OR
`new Date(publish_at) <= now`). Items already `scheduled`/`published`/`error` are skipped.
Missing `publish_at` is treated as "publish immediately".

## Native FB Scheduling vs Just-In-Time

- `schedule_native: false` (default) → the script publishes *now* (item must already be due).
- `schedule_native: true` → the script posts with `published=false` + `scheduled_publish_time`
  (unix seconds). Meta holds and publishes it server-side; the item is marked `scheduled`,
  not `published`. Requires the publish time to be ≥ 10 min in the future.

Formula: `ts = floor(publish_at_ms / 1000)`; reject if `ts < floor(now_ms/1000) + 600`.

## IG Limit Detection

The run sets `ig_limit_reached` and stops further IG publishes when an error message matches
(case-insensitive): `application request limit`, `exceeded the maximum number of posts`, or
`100 posts within 24 hours`. Facebook items in the same run still complete.

## Failure Isolation Doctrine

One bad item must never poison the batch. Each item runs in its own try/catch: on failure the
item gets `status="error"` + the verbatim Meta message, a log row is appended, and the loop
continues. No in-run retries — transient items are recovered by resetting `status` to
`pending` and re-invoking `/publish`. The Graph client (`meta-graph.js`) already handles
*transport-level* retries (rate-limit/5xx/network) with backoff+jitter; the skill does not
add a second retry layer on top.

## Good vs Bad Calendar Items

GOOD — IG reels, due, fully specified:
```json
{ "id": "ig-2026-06-22-reel-1", "platform": "instagram", "format": "reels",
  "publish_at": "2026-06-22T09:00:00Z", "message": "New drop 🔥",
  "video_url": "https://cdn.example.com/r1.mp4", "cover_url": "https://cdn.example.com/r1.jpg",
  "share_to_feed": true, "status": "pending" }
```

GOOD — FB natively scheduled (≥10 min out):
```json
{ "id": "fb-2026-06-22-1", "platform": "facebook", "format": "post",
  "publish_at": "2026-06-22T18:00:00Z", "message": "Doors open Friday.",
  "schedule_native": true, "status": "pending" }
```

BAD — IG image with no media (throws "instagram image requires image_url"):
```json
{ "id": "x1", "platform": "instagram", "format": "image", "message": "hi", "status": "pending" }
```

BAD — carousel with 1 slide (throws "requires items: 2–10 slides"):
```json
{ "id": "x2", "platform": "instagram", "format": "carousel",
  "items": [{ "format": "image", "image_url": "https://..." }], "status": "pending" }
```

BAD — native schedule 2 min out (throws the 10-min floor violation):
```json
{ "id": "x3", "platform": "facebook", "format": "post", "schedule_native": true,
  "publish_at": "<now+2min>", "status": "pending" }
```

## Keeping Current

If Meta changes the IG quota, the container flow, or the scheduling floor, update the
constants table above AND the named constants in `skills/publish/publish.js`
(`IG_CONTAINER_TIMEOUT_MS`, `IG_CONTAINER_POLL_MS`, the `600` floor). Re-verify the cited
docs in `api-reference.md` and bump the "Last verified" date in `SKILL.md`.
