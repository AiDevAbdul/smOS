# Creative Audit — API Reference

`/audit-creative` reads (never writes) two Meta Graph API edges through the shared guarded
client `scripts/lib/meta-graph.js`. The version is pinned there as `API_VERSION = "v25.0"`;
do not hardcode a different version in the skill.

Base URL: `https://graph.facebook.com/v25.0`. The client auto-attaches `appsecret_proof`
(HMAC-SHA256 of the token keyed by `META_APP_SECRET`) when the secret is set.

## 1. Organic Page posts

```
GET /{page_id}/posts
  ?fields=id,message,created_time,full_picture,permalink_url,
          attachments{type,media,subattachments}
  &limit=50
```

Mapped to: `asset_id` (id), `copy` (message), `created_at` (created_time),
`image_url` (`full_picture` or `attachments.data[0].media.image.src`),
`permalink` (permalink_url). Format derived from `attachments` (see domain-standards §3).

Skipped when `page_id` is missing or `isTbd(page_id)` is true (returns `[]`).

### Sampling cap & pagination extension path

The fetch uses a **single page, `limit=50`** with no cursor-following. This is an intentional
**most-recent sampling decision**, not a Graph limit: 50 recent posts is a representative health
sample for the immutable baseline, and it keeps the vision-scoring cost bounded. The Graph `/posts`
edge returns a `paging.cursors`/`paging.next` cursor that this skill deliberately ignores.

A high-volume client (more than 50 posts in the 90-day window) would otherwise be **silently
under-sampled** — only the newest 50 are scored. When the full window is required, switch the
fetch to the shared client's cursor-following helper already exported from `meta-graph.js`:

```js
// instead of: graph.get(`/${pageId}/posts`, { fields, limit: 50 })
const posts = await graph.paginate(`/${pageId}/posts`, { fields, limit: 100 }, 500);
// paginate() follows paging.next, strips/re-adds access_token + appsecret_proof
// per page, and caps at `max` (default 500) so a runaway page count can't loop.
```

`paginate()` returns the flat `data[]` array directly (no `.data` wrapper). Everything downstream
(format classification, 90-day filter, batching at `BATCH_SIZE`, aggregation) is asset-count-agnostic
and absorbs the larger set unchanged. Apply the same swap to the `adcreatives` pull in §2 if an
account exceeds 50 creatives. This is the documented extension; the default 50-cap stands until a
client's volume demands it.

| Resource | URL | Use For |
|----------|-----|---------|
| Page `/feed` edge | https://developers.facebook.com/docs/graph-api/reference/page/feed/ | Post fields: `message`, `full_picture`, `attachments`, `permalink_url` |
| Pages API — Posts | https://developers.facebook.com/docs/pages-api/posts/ | Read scopes: `pages_read_engagement` (+ `pages_show_list`) |
| Page node | https://developers.facebook.com/docs/graph-api/reference/page/ | Page token retrieval / `access_token` field |

## 2. Ad creatives

```
GET /act_{ad_account_id}/adcreatives
  ?fields=id,name,image_url,thumbnail_url,object_story_spec,
          effective_object_story_id,body,title
  &limit=50
```

Mapped to: `asset_id` (id), `image_url` (`image_url` or `thumbnail_url`),
`copy` (`body` or `object_story_spec.link_data.message` or `title`),
`created_at` = `null` (ad creatives carry no creation time here, so they bypass the 90-day filter).
Format from `object_story_spec`: `video_data` → video, `link_data.child_attachments` → carousel, else image.

The script prepends `act_` if absent. Skipped when `ad_account_id` is missing or `isTbd`.

Same `limit=50` single-page sampling as §1: an account with more than 50 creatives is sampled
to the newest 50. Use the same `graph.paginate()` swap (see §1) to score the full set.

| Resource | URL | Use For |
|----------|-----|---------|
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | `adcreatives` edge + `object_story_spec` structure |
| Graph API docs root | https://developers.facebook.com/docs/graph-api/ | Field-selection / edge syntax |

## 3. Version, rate limits & errors

| Resource | URL | Use For |
|----------|-----|---------|
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current (released 2026-02-18) |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/page limits; `X-App-Usage` / `X-Business-Use-Case-Usage`; codes 4 / 17 / 32 / 613 |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account read limits for the `adcreatives` pull |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |

**Retry behavior (handled by `meta-graph.js`, not this skill):** transient codes
(1, 2, 4, 17, 32, 341, 613, 80000–80008) and HTTP 429/5xx are retried with exponential
backoff + jitter. Token-expiry codes (190, 102, 463, 467) throw a non-retryable
`TokenExpiredError` — surface it and prompt re-auth; never loop on a dead token.

**This skill's own fetch errors** are caught per-source: a failed organic or ad pull logs
to stderr and returns `[]`, so a partial audit still proceeds.

## 4. Why no write endpoints

This skill is read-only by design — it scores existing creative. All account mutation
(create campaign/adset/ad, AI-disclosure, brand-compliance gates) belongs to `/launch`,
`/creative`, and the guard chokepoint, not here.

## Keeping current

The only version string lives in `scripts/lib/meta-graph.js` (`API_VERSION`). If Meta ships
a new Graph version, update it there and re-verify the changelog URL above. Confirm the
field lists still resolve (Meta occasionally renames creative fields). Then bump the
"Last verified" date in `SKILL.md`.

**Last verified:** 2026-06-22 (Graph API v25.0).
