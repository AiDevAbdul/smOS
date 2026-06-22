# brand-social — API Reference (downstream upload)

`brand-social.js` itself makes **no external API calls** — it only reads/writes
`brand_profile.json` on the local filesystem. The assets it specs are uploaded to live
accounts later by `/setup-accounts`. This file documents that downstream contract so the
specs produced here are upload-ready. All endpoints are **Meta Graph API v25.0** (the project
pin; confirmed current, released 2026-02-18). URLs are cited from `skills/references-shared.md`.

## 1. Where these assets land

| Asset produced here | Uploaded by `/setup-accounts` to |
|---------------------|-----------------------------------|
| `profile_picture_url` (FB) | Page photo via Pages API |
| `fb_cover_url` | Page cover via Pages API |
| `profile_picture_url` (IG) | IG profile via Instagram Platform |
| `bios.instagram` / `bios.facebook` | IG/Page profile bio fields |

## 2. Relevant endpoints & fields (v25.0)

| Resource | URL | Use |
|----------|-----|-----|
| Pages API — Get Started | https://developers.facebook.com/docs/pages-api/getting-started/ | Obtain a Page token (`pages_manage_posts`, `pages_read_engagement`) |
| Page node | https://developers.facebook.com/docs/graph-api/reference/page/ | Page fields; retrieve `access_token`; set Page picture/cover |
| IG Content Publishing | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | Two-step `/media` → `/media_publish`; 100 posts/rolling 24h |
| IG content_publishing_limit | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/ | Read live `quota_total` per account — do not hardcode the limit |
| Meta Ads Guide (specs) | https://www.facebook.com/business/ads-guide | Placement-by-placement image/video dimensions |

## 3. Rate limits (downstream)

| Resource | URL | Note |
|----------|-----|------|
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage` / `X-Business-Use-Case-Usage` headers; codes 4 (app), 17 (user), 613 (custom) |
| Handle Errors | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table, `fbtrace_id`; log and do not auto-retry |

- IG publishing: 100 API-published posts per rolling 24h (a carousel counts as 1). Read the
  live `quota_total` via `content_publishing_limit` rather than assuming the default.

## 4. Per-client tokens

When `/setup-accounts` uploads these assets in a multi-client setup, it resolves a per-client
token via `scripts/lib/tokens.js` (`META_PAGE_TOKEN_<SLUG>` etc.) — never the global page
token. `brand-social.js` uses no tokens.

**Last verified:** 2026-06-22
