# /inbox — API Reference

Exact Meta Graph API surface used by `inbox.js`. All calls run through
`scripts/lib/meta-graph.js` (`createGraph(token)`), which pins the version, computes
`appsecret_proof`, runs the fail-closed guard chokepoint on writes, and retries transient
errors with backoff. Self-contained; cite URLs from `skills/references-shared.md`.

## Version & base

- **API version:** `v25.0` (`scripts/lib/meta-graph.js` → `API_VERSION`). Current latest,
  released 2026-02-18. Confirm: https://developers.facebook.com/docs/graph-api/changelog/versions/
- **Base URL:** `https://graph.facebook.com/v25.0`
- **Auth:** per-client **page token** (resolved by `scripts/lib/tokens.js`) + `appsecret_proof`.

## Read edges (all GET)

| Surface | Edge | Key fields requested | Doc |
|---------|------|----------------------|-----|
| FB DMs | `GET /{page_id}/conversations` `platform=messenger` | `id,snippet,unread_count,updated_time,participants{id,name}` limit 25 | https://developers.facebook.com/docs/pages-api/getting-started/ |
| FB Page comments | `GET /{page_id}/feed` | `id,permalink_url,comments.limit(25){id,message,from,created_time}` limit 15 | https://developers.facebook.com/docs/graph-api/reference/page/feed/ |
| IG DMs | `GET /{page_id\|ig_id}/conversations` `platform=instagram` | `id,snippet,unread_count,updated_time,participants{id,username}` limit 25 | https://developers.facebook.com/docs/pages-api/getting-started/ |
| IG comments | `GET /{ig_id}/media` | `id,caption,permalink,comments.limit(25){id,text,username,timestamp}` limit 15 | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ |
| IG mentions | `GET /{ig_id}/tags` | `id,caption,permalink,timestamp,username` limit 25 | https://developers.facebook.com/docs/instagram-platform/content-publishing/ |

Notes:
- IG conversations are read on the linked **Page** id with `platform=instagram` (Messenger
  Platform routes IG messaging through the connected Page), falling back to the IG id.
- IG media metric naming changed `impressions`→`views`; this skill reads comments/tags, not
  insights, so it is unaffected — but if insights are added, use `views`.

## Required permissions (page token)

- `pages_messaging` — read/send FB + IG DMs (Messenger Platform).
- `pages_read_engagement`, `pages_manage_metadata` — read Page feed + comments.
- `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages` — IG media,
  comments, mentions, DMs.

## Send (reply) — gated, not done by the puller

Replying uses the Messenger Send API / comment reply edges and is **only** invoked after
`inboxItem.validateReply` passes. RESPONSE-type DM sends are refused outside the
**24-hour standard messaging window** (Messenger Platform policy). Auto-send additionally
requires an `approvals.js` record.

## Rate limits & error handling

- **Doc:** https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ and
  https://developers.facebook.com/docs/graph-api/guides/error-handling/
- **Headers:** `X-App-Usage`, `X-Business-Use-Case-Usage` (read by callers to back off early).
- **Retryable codes** (handled in `meta-graph.js`): 1, 2, 4 (app limit), 17 (user limit),
  32 (page limit), 341, 613 (calls-per-hour), 80000–80008; HTTP 429/5xx; net `ECONNRESET` etc.
  Retried with exponential backoff + jitter.
- **Non-retryable token codes:** 190, 102, 463, 467 → surfaced as `TokenExpiredError` so the
  caller prompts a re-auth instead of hammering a dead token.
- Every Graph error is logged with `code`, `type`, and `fbtrace_id`.

## Per-edge isolation

`inbox.js` wraps each edge in its own try/catch and logs `"<edge> pull failed: <msg>"`. A
single failing surface (e.g. missing IG permission) degrades that surface only; the rest of
the queue still builds.

**Last verified:** 2026-06-22
