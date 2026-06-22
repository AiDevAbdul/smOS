# content-plan — Downstream API Reference

`/content-plan` makes **no external API calls itself** — its only side effect
beyond writing files is a best-effort PostgREST insert into Supabase. This file
documents the **downstream contract**: the Meta endpoints `/publish` calls with
the calendar this skill emits, so the calendar is shaped to satisfy them. Pinned
to **Graph API v25.0** (the project version; current as of 2026-02-18).

## 1. Instagram Content Publishing (the primary consumer)

`/publish` posts each `platform: instagram` item via the two-step flow:

1. `POST /{ig-user-id}/media` — create a container.
2. `POST /{ig-user-id}/media_publish` — publish that container.

| Item field (this skill) | Maps to | Notes |
|--------------------------|---------|-------|
| `format: reels` / `video` | `media_type=REELS`, `video_url` | Requires `video_url` (publishable gate) |
| `format: image` | `image_url` | Requires `image_url` |
| `format: carousel` | `media_type=CAROUSEL`, child containers | Requires `items[]` ≥ 2 slides |
| `message` | `caption` | Keyword-first; carries hashtags |
| `publish_at` | scheduling layer | ISO-8601; `/publish` decides native vs queued |

| Resource | URL |
|----------|-----|
| Content Publishing guide (two-step flow; 100 posts/24h) | https://developers.facebook.com/docs/instagram-platform/content-publishing/ |
| Create Media container (`/media` params) | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ |
| Publish Media (`/media_publish`) | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish/ |
| Content Publishing Limit (live quota) | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/ |
| Media Insights (`impressions`→`views`) | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ |

**Rate / quota notes (inform calendar volume):**
- IG allows **100 API-published posts per rolling 24h** (a carousel counts as 1).
  A 4-week, 12-item calendar is well under this — but `/publish` must read the live
  `content_publishing_limit` `quota_total` rather than assume 100.
- For media created on/after **2024-07-02**, `impressions` requests after
  **2025-04-21** error out — use `views`. Relevant when setting pillar targets.

## 2. Facebook Pages (for `platform: facebook` items)

`/publish` posts FB items via `POST /{page-id}/feed` with a Page token.

| Resource | URL |
|----------|-----|
| Pages API — Posts | https://developers.facebook.com/docs/pages-api/posts/ |
| Page `/feed` edge (message, link, scheduled) | https://developers.facebook.com/docs/graph-api/reference/page/feed/ |

This skill defaults items to `instagram`; `facebook` / `threads` are valid
platforms in the schema and produced only if a custom plan sets them.

## 3. Rate Limiting & Error Codes (downstream)

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage`; codes 4 / 17 / 613 |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | `fbtrace_id`, recovery |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Confirm v25.0 pin / lifecycle |

## 4. Supabase persistence (this skill's only side-effect call)

Best-effort insert via PostgREST (`scripts/lib/supabase.js`):

- `POST {SUPABASE_URL}/rest/v1/content_plans` with the SERVICE key.
- Row: `{ client_id, slug, period, plan }`.
- No-ops (`{ skipped: true }`) when `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are
  unset; any error is caught and logged as `supabase persist skipped` — it never
  blocks writing the JSON deliverables.

## Keeping Current

When bumping the Graph API version, update the pin here and in `schemas/`/`scripts/lib`,
and re-confirm the IG publish limit and `impressions`→`views` status against the
links above. Canonical doc-URL map: `skills/references-shared.md`.

**Last verified:** 2026-06-22
