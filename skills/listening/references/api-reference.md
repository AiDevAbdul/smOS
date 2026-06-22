# Listening — API Reference

Exact Meta Graph API surface used by `/listening`. Cited from
`skills/references-shared.md`. The project pins **Graph API v25.0** (current —
released 2026-02-18). All calls go through `scripts/lib/meta-graph.js`
(`createGraph(token)`), which enforces the guard chokepoint, retries transient
errors, and surfaces token-expiry (code 190) non-retryably.

## Base

| Item | Value |
|---|---|
| Host | `https://graph.facebook.com` |
| Version | `v25.0` (constant `API_VERSION` in `meta-graph.js`) |
| Auth | Per-client page/IG token via `scripts/lib/tokens.js` → `META_PAGE_TOKEN_<SLUG>` (or profile `accounts.*_token`); global fallback discouraged |

## 1. IG Business Discovery (competitor benchmark)

Read any **public** business/creator account's public stats from the client's own
IG Business account. No scraping; fully within Graph.

- **Call:** `GET /{our-ig-business-id}`
- **Field expansion:**
  `business_discovery.username(<handle>){followers_count,media_count,media.limit(20){like_count,comments_count,timestamp,media_type}}`
- **Returns:** `business_discovery.followers_count`, `media_count`, and up to 20 recent
  media each with `like_count`, `comments_count`, `timestamp`, `media_type`.
- **Constraints:** target must be a public Business/Creator account; personal/private
  accounts and bad handles error (caught → stub). Strip leading `@`, trim handle.

Docs:

| Resource | URL |
|---|---|
| Graph API docs root | https://developers.facebook.com/docs/graph-api/ |
| Media Insights (impressions→views note) | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ |
| Versions list (confirm v25.0) | https://developers.facebook.com/docs/graph-api/changelog/versions/ |

> Metric note: per `references-shared.md`, for media created on/after 2024-07-02 the
> `impressions` metric errors after 2025-04-21 — use `views`. `/listening` does not
> request `impressions`; it derives engagement from `like_count` + `comments_count`,
> which are unaffected.

## 2. IG `/tags` (brand mentions)

- **Call:** `GET /{our-ig-business-id}/tags`
- **Fields:** `caption,permalink,timestamp,username`; `limit=25`
- **Returns:** media in which the client's IG account is tagged — mapped to
  `{source:"instagram", text:caption, url:permalink, at:timestamp}`.
- **Failure:** caught and logged; `mentions` left empty, run continues.

Docs: Graph API docs root (above). `/tags` is part of the Instagram Platform Graph API.

## 3. Errors & rate limits

| Resource | URL | Use For |
|---|---|---|
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits; `X-App-Usage`; codes 4 / 17 / 613 |

Retry behavior (handled in `meta-graph.js`):

| Class | Codes | Behavior |
|---|---|---|
| Retryable Meta | 1, 2, 4, 17, 32, 341, 613, 80000–80008 | Exponential backoff + jitter |
| Retryable HTTP | 429, 500, 502, 503, 504 | Backoff |
| Token expiry | 190, 102, 463, 467 | Non-retryable `TokenExpiredError` — re-auth |

`/listening` itself does not retry; it relies on `meta-graph.js` and falls back to
stubs on persistent failure.

## Keeping current

- Re-confirm v25.0 is current at the Versions list before bumping `API_VERSION`.
- If Business Discovery field names or limits change, update §1 and
  `domain-standards.md` §2 together.
- **Last verified:** 2026-06-22
