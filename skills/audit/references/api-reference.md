# /audit — API Reference

Every external call `/audit` makes, by pass. All calls are **GET** (read-only) against **Meta Graph + Marketing API v25.0** (`https://graph.facebook.com/v25.0`), pinned in `scripts/lib/meta-graph.js` (`API_VERSION`). Auth is `access_token` + (when `META_APP_SECRET` set) `appsecret_proof`. Reads go through `createGraph().get/paginate`, which applies retry/backoff and token-expiry handling. `isTbd(id)` short-circuits any pass whose ID is missing/`TBD`.

> Version is correct and current: v25.0 is the latest Graph API version (released 2026-02-18). See https://developers.facebook.com/docs/graph-api/changelog/versions/.

## Pass 1 — Facebook Page

| Call | Endpoint | Key fields |
|------|----------|-----------|
| Profile | `GET /{page_id}` | `id,name,fan_count,about,category,website,phone,emails,location,picture,cover` |
| Posts (paginate, 60d, ≤60) | `GET /{page_id}/posts` | `id,message,created_time,status_type,attachments{media_type,type},reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_engaged_users)` |
| Page insights (90d) | `GET /{page_id}/insights` | `metric=page_fans,page_fan_adds,page_fan_removes,page_impressions_unique,page_post_engagements,page_views_total; period=day` |

Docs: Page node https://developers.facebook.com/docs/graph-api/reference/page/ · `/feed` https://developers.facebook.com/docs/graph-api/reference/page/feed/ · Pages API https://developers.facebook.com/docs/pages-api/posts/

## Pass 2 — Instagram (skipped if `--no-ig` or `instagram_business_id` is TBD)

| Call | Endpoint | Key fields |
|------|----------|-----------|
| Profile | `GET /{ig_id}` | `id,username,followers_count,media_count,profile_picture_url,biography,website` |
| Media (paginate, 60d, ≤50) | `GET /{ig_id}/media` | `id,caption,media_type,media_product_type,timestamp,like_count,comments_count,insights.metric(reach,impressions)` |
| IG insights (28d) | `GET /{ig_id}/insights` | `metric=reach,profile_views,website_clicks; period=day` |

**`impressions` deprecation:** for media created on/after 2024-07-02, requesting `impressions` after 2025-04-21 errors. The audit derives ER from `reach`; the media call still lists `impressions` for legacy media but never relies on it. Prefer `views`/`reach`. Docs: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/

## Pass 3 — Ad Account (skipped if `--no-paid` or `ad_account_id` is TBD)

`act_<id>` normalized via `graph.act()`.

| Call | Endpoint | Key fields |
|------|----------|-----------|
| Account | `GET /act_{id}` | `id,name,account_status,age,currency,timezone_name,balance,amount_spent,funding_source_details` |
| Campaigns (paginate, ≤500) | `GET /act_{id}/campaigns` | `id,name,status,effective_status,objective,created_time,insights.date_preset(lifetime){spend,impressions,clicks,actions,action_values,cost_per_action_type,purchase_roas,frequency}` |
| Custom audiences (≤200) | `GET /act_{id}/customaudiences` | `id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status,time_updated` |
| Pixel stats (7d) | `GET /{pixel_id}/stats` | `start_time` = 7 days ago (skipped if pixel TBD) |

Docs: Marketing API root https://developers.facebook.com/docs/marketing-api/ · Campaign node https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/

## Rate limits

`meta-graph.js` retries (exp backoff + full jitter, honoring `Retry-After`) on app/user/page rate-limit codes **4 / 17 / 32 / 613** and HTTP 429/5xx — up to `maxRetries=4`. Audit reads are bounded (≤60 posts, ≤500 campaigns, ≤200 audiences) to stay well inside `X-App-Usage` / `X-Business-Use-Case-Usage` budgets. Do not add your own retry loop. Docs: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

## Errors & token expiry

`get/paginate` throw a normalized error carrying `code`, `type`, `fbtrace_id`. Pass-level errors are caught and surfaced as `{error}` / `insights_error` so one failed pass never aborts the whole audit. Token codes **190/102/463/467** throw a non-retryable `TokenExpiredError` — stop and re-auth. Docs: https://developers.facebook.com/docs/graph-api/guides/error-handling/

## Fetch guidance

When a field or edge here is missing/renamed in a future version: fetch the cited official doc (or `skills/references-shared.md`), confirm against the v25.0 changelog, update the field list AND `audit.js`, and bump the **Last verified** date in `SKILL.md`. Never silently guess a replacement field.
