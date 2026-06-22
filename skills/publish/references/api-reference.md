# /publish — Meta Graph API Reference

Exact endpoints, parameters, version, and rate limits for the organic publishing surface.
All calls go through `scripts/lib/meta-graph.js` (`createGraph`), which pins the version,
appends `access_token` + `appsecret_proof`, runs the fail-closed write guard, and retries
transient failures. Sourced from `skills/references-shared.md` (verified 2026-06-22).

## Version & Base

- **API version:** `v25.0` (current; released 2026-02-18). Base host `https://graph.facebook.com/v25.0`.
- Versioning / lifecycle: https://developers.facebook.com/docs/graph-api/changelog/versions/

## Facebook Pages — Publishing

| Action | Endpoint | Key params | Token |
|--------|----------|-----------|-------|
| Text / link post | `POST /{page_id}/feed` | `message`, `link` | Page token |
| Photo post | `POST /{page_id}/photos` | `url` (hosted image), `message` | Page token |
| Native schedule | same edges + `published=false`, `scheduled_publish_time=<unix s>` | must be ≥ 10 min in future | Page token |

- Pages API — Posts: https://developers.facebook.com/docs/pages-api/posts/
- Page `/feed` edge (full params): https://developers.facebook.com/docs/graph-api/reference/page/feed/
- Page token scopes: `pages_manage_posts`, `pages_read_engagement` — https://developers.facebook.com/docs/pages-api/getting-started/

A FB post returns `{ id }` (or `post_id` for some edges); the script stores `result.id || result.post_id`.

## Instagram — Two-Step Container Publishing

The IG flow is always: (1) create a media container, (2) publish it. Video/Reels/Carousel
containers process asynchronously and MUST be polled to `status_code == FINISHED` before publish.

| Step | Endpoint | Key params |
|------|----------|-----------|
| Create container | `POST /{ig-user-id}/media` | image: `image_url`, `caption` · video: `media_type=VIDEO`, `video_url` · reels: `media_type=REELS`, `video_url`, `share_to_feed`, `cover_url` |
| Carousel child | `POST /{ig-user-id}/media` | `is_carousel_item=true` + (`image_url`) or (`media_type=VIDEO`, `video_url`) |
| Carousel parent | `POST /{ig-user-id}/media` | `media_type=CAROUSEL`, `children=<id,id,...>`, `caption` |
| Poll status | `GET /{container-id}?fields=status_code,status` | `status_code` ∈ `IN_PROGRESS`/`FINISHED`/`ERROR`/`EXPIRED` |
| Publish | `POST /{ig-user-id}/media_publish` | `creation_id=<container-id>` → returns `{ id }` (the media ID) |

- Content Publishing guide: https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Create Media (`/media`): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
- Publish Media (`/media_publish`): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish/

### Publishing quota
- 100 API-published posts per rolling 24h (a carousel = 1 post).
- Read live quota: `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config` —
  https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/
- The runner does not pre-count; it detects the limit *error* and stops further IG publishes.

## Rate Limiting & Error Handling

| Concern | Detail | URL |
|---------|--------|-----|
| Error envelope | `error.{code,type,message,fbtrace_id,error_subcode}` | https://developers.facebook.com/docs/graph-api/guides/error-handling/ |
| App rate limit | code **4** | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ |
| User rate limit | code **17** (`API_EC_USER_TOO_MANY_CALLS`) | same |
| Custom/page limits | code **613**, **32** | same |
| Usage headers | `X-App-Usage`, `X-Business-Use-Case-Usage` | same |
| Token expired/invalid | code **190** (also 102/463/467 OAuthException) | error-handling page |

### How `meta-graph.js` reacts (no extra logic needed in this skill)
- **Retryable** (codes 1,2,4,17,32,341,613,80000–80008; HTTP 429/500/502/503/504; net
  ECONNRESET/ETIMEDOUT/ECONNABORTED/EAI_AGAIN/ENOTFOUND): exponential backoff + full jitter,
  honoring any `Retry-After` header, up to `maxRetries = 4`.
- **Token expired** (190/102/463/467): throws non-retryable `TokenExpiredError` — re-auth.
- **Other Meta errors:** thrown as `Meta API <code>: <message> (type=…, trace=…)`; the runner
  catches per-item, marks `error`, and continues.
- **Writes** (`POST`/`DELETE`) run `guardGraphWrite()` once before the request leaves the
  process — a blocked write never goes out.

## appsecret_proof

When `META_APP_SECRET` is set, every call includes `appsecret_proof = HMAC-SHA256(token)`
keyed by the app secret. Required for apps with "Require App Secret" enabled.

## Last verified

2026-06-22 — against `skills/references-shared.md`. Re-fetch the Content Publishing guide and
rate-limiting page if Meta ships a version past v25.0 or changes the IG quota.
