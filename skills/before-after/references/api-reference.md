# before-after — API Reference

Exact Meta Graph API surface the current-state pull uses. Pinned to **v25.0** (`API_VERSION` in `scripts/lib/meta-graph.js`). All calls go through `createGraph()` (auto retry/backoff, pagination, `appsecret_proof`). URLs are drawn from `skills/references-shared.md`. Readable standalone.

## Version & auth

- **Version:** v25.0 — latest, released 2026-02-18; the project pin is current.
  Versions list: https://developers.facebook.com/docs/graph-api/changelog/versions/
- **Token:** `META_ACCESS_TOKEN` (system-user / page token) via `load-env.js`.
- **appsecret_proof:** appended automatically when `META_APP_SECRET` is set.

## Endpoints used (by capture function)

### Facebook — `captureFacebookCurrent(graph, pageId)`
- `GET /{page-id}` fields: `id,name,fan_count,about,category,website,phone,emails,location,picture,cover`
  - Page node: https://developers.facebook.com/docs/graph-api/reference/page/
- `GET /{page-id}/posts` (paginated, ≤50) fields: `id,created_time,reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions)`, `since=<30d ago>`
  - Page /feed: https://developers.facebook.com/docs/graph-api/reference/page/feed/
- Skipped when `isTbd(pageId)`.

### Instagram — `captureInstagramCurrent(graph, igId)`
- `GET /{ig-user-id}` fields: `id,username,followers_count,media_count`
- `GET /{ig-user-id}/media` (paginated, ≤50) fields: `id,timestamp,like_count,comments_count,insights.metric(reach)`, `since=<30d ago>`
  - Media Insights: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
- Skipped when `isTbd(igId)`.

> **`impressions` → `views`:** for IG media created on/after 2024-07-02, `impressions` requests after 2025-04-21 error out. This skill uses `reach` (unaffected) for the IG engagement denominator — keep it that way; do **not** add `impressions`.

### Paid — `capturePaidCurrent(graph, adAccountId, pixelId)`
- `GET /act_{id}/insights` fields: `spend,impressions,clicks,actions,action_values,purchase_roas,cost_per_action_type`, `date_preset=last_30d`, `level=account`
  - Marketing API rate limits: https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
- `GET /{pixel-id}/stats` `start_time=<30d ago>` (skipped when `isTbd(pixelId)`).
- Action-type resolution (first match wins):
  - leads: `lead`, `offsite_conversion.fb_pixel_lead`, `complete_registration`
  - purchases: `purchase`, `offsite_conversion.fb_pixel_purchase`
  - revenue: `action_values` → `purchase`, `offsite_conversion.fb_pixel_purchase`
- ROAS: `purchase_roas[0].value`, else `revenue/spend` when both present.

## Rate limiting

- Headers: `X-App-Usage`, `X-Business-Use-Case-Usage`. Error codes: **4** (app), **17** (user, `API_EC_USER_TOO_MANY_CALLS`), **613** (custom limit).
  - https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- `meta-graph.js` retries retryable codes with backoff; it does **not** auto-retry hard errors. The run does one account-level insights call + paginated post/media pulls (≤50 each) — well within per-run BUC limits.

## Error handling

- Each capture is wrapped in `.catch` in the JS; a failed surface returns `{error}` / `[]` and renders "—" rather than aborting the report.
- Full Meta errors (code, type, `fbtrace_id`) surface via the shared client.
  - https://developers.facebook.com/docs/graph-api/guides/error-handling/

**Last verified:** 2026-06-22
