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

## 2b. IG Hashtag Search (UNTAGGED mention discovery) — `--hashtag-search`

The only first-party path to a mention that does **not** @-tag the client. Two hops:

- **Resolve:** `GET /ig_hashtag_search?user_id={our-ig-business-id}&q={hashtag}` → `{data:[{id}]}`
- **Read:** `GET /{ig-hashtag-id}/recent_media?user_id={our-ig-business-id}&fields=id,caption,permalink,timestamp,media_type,like_count,comments_count&limit=25`

Documented ceilings (all reported in the run's `ig_hashtag` coverage row, never hidden):

| Constraint | Effect on coverage |
|---|---|
| Public accounts + top-level media only | Private accounts, stories, comments and reels-only-in-DM content are invisible |
| ~24h recency window on `recent_media` | A run is a *sample of now*, not a historical search — trends come from stacking runs |
| **30 unique hashtags per IG user per rolling 7 days** | Why `--hashtag-search` is opt-in. Keep the watchlist's hashtag list tight |
| Only hashtags you queried | A mention with no watched hashtag is unreachable — coverage stays `partial` |

A hashtag that fails to resolve or errors is recorded in the coverage row's `reason`; the
remaining hashtags still run.

## 2c. FB own-post comments (as far as FB allows) — `--fb-comments`

- **Call:** `GET /{page-id}/feed?fields=id,permalink_url,comments.limit(25){id,message,from,created_time}&limit=15`
- **Why only this:** the Graph API exposes **no public keyword or mention search on
  Facebook**. A post on a stranger's Page or in a Group is unreachable, full stop. This
  edge is the ceiling, and the coverage row says so.

## 2d. Web search (outside Meta, key-gated) — `--web-search`

- **Client:** `scripts/lib/web_search.js` → `POST https://api.tavily.com/search`
  (Node twin of the `/pre-audit` pipeline's `scripts/meta-ad-library/tavily.py`).
- **Auth:** `TAVILY_API_KEY`. Missing key ⇒ coverage `unavailable` with the reason —
  never a silent skip, never a fabricated result.
- **What it is:** an index of public pages matching the queried brand terms/keywords. It
  can surface a Reddit thread or a news article that never @-tagged the client.
- **What it is not:** a per-platform census. It cannot enumerate TikTok, X or LinkedIn
  mentions, and those platforms remain `unavailable` in the coverage report regardless.

## 2e. Platforms with NO reachable listening API

`NO_API_PLATFORMS` in `scripts/lib/listening_depth.js` — TikTok, X, LinkedIn, YouTube,
Reddit. Each is emitted every run as `status:"unavailable"`, `mentions:null`, with the
reason. They are listed *precisely so* their absence cannot be read as zero mentions.

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
- If the IG Hashtag Search quota or recency window changes, update §2b **and** the
  coverage `limitation` strings in `scripts/lib/listening_depth.js` together — the
  coverage row is what the client actually reads.
- **Last verified:** 2026-06-22 for §1/§2/§3. §2b–§2e added 2026-09-09 describing the
  calls `listening.js` makes; their doc pages were **not** re-fetched at that date —
  re-verify the hashtag quota against the Instagram Platform docs before quoting it to
  a client.
