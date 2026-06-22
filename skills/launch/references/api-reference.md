# /launch — Meta Marketing API Reference (v25.0)

Every write here goes through the guarded chokepoint in `scripts/lib/meta-graph.js`
(`createGraph()`), which pins `API_VERSION = "v25.0"` and base
`https://graph.facebook.com/v25.0`. The naming / budget / pixel / compliance / UTM /
destructive guards fire on every `graph.post`, so the same protections apply here as on the
MCP path. All endpoints below are relative to that base. `graph.act(id)` normalizes an ad
account id to `act_<id>`.

Verified against live official sources on **2026-06-22**. v25.0 is current (released
2026-02-18, no newer version). Cite from `skills/references-shared.md`.

## Endpoints used by `launch.js`

| Operation | Method + edge | Key fields | URL |
|-----------|---------------|-----------|-----|
| Create campaign | `POST /act_<id>/campaigns` | `name`, `objective` (`OUTCOME_*`), `status:"PAUSED"`, `bid_strategy`, `daily_budget` (cents string), `special_ad_categories:[]` | https://developers.facebook.com/docs/marketing-api/reference/ad-account/campaigns/ |
| Create adset | `POST /act_<id>/adsets` | `campaign_id`, `name`, `status`, `daily_budget`, `billing_event:"IMPRESSIONS"`, `optimization_goal`, `bid_strategy`, `targeting` (JSON), `attribution_spec` (JSON), `promoted_object` (JSON, sales) | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ |
| Create creative | `POST /act_<id>/adcreatives` | `name`, `object_story_spec` (JSON: `page_id`, `instagram_actor_id`, `link_data`/`video_data`), `degrees_of_freedom_spec` | https://developers.facebook.com/docs/marketing-api/reference/ad-creative/ |
| Create ad | `POST /act_<id>/ads` | `name`, `adset_id`, `creative:{creative_id}` (JSON), `status:"PAUSED"` | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ |
| Upload image | `POST /act_<id>/adimages` | `bytes`/`url` → returns `{images:{...:{hash}}}` | https://developers.facebook.com/docs/marketing-api/reference/ad-image/ |
| Upload video | `POST /act_<id>/advideos` | `file_url` (hosted) → returns `{id}` (the `video_id`) | https://developers.facebook.com/docs/marketing-api/reference/ad-account/advideos/ |
| List/create custom audiences | `GET/POST /act_<id>/customaudiences` | `name`, `subtype` (WEBSITE/ENGAGEMENT/LOOKALIKE), `rule`/`lookalike_spec` (JSON), `retention_days` | https://developers.facebook.com/docs/marketing-api/reference/custom-audience/ |
| Activate (separate, human step) | `POST /<campaign_id>` / `POST /<ad_id>` | `status:"ACTIVE"` | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/ |

### Field serialization
Nested object/array fields (`targeting`, `attribution_spec`, `object_story_spec`,
`promoted_object`, `creative`, `rule`, `lookalike_spec`) must be sent as JSON **strings**.
`launch.js` stringifies any non-null object value before POSTing.

## Objective → optimization goal (v25.0 ODAX)

`OUTCOME_SALES`→`OFFSITE_CONVERSIONS`, `OUTCOME_LEADS`→`LEAD_GENERATION`,
`OUTCOME_TRAFFIC`→`LINK_CLICKS`, `OUTCOME_ENGAGEMENT`→`POST_ENGAGEMENT`,
`OUTCOME_AWARENESS`→`REACH`. The six enums:
https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/

## Rate limits

- Ads-management calls count against ad-account + BUC limits; watch `X-Business-Use-Case-Usage`.
  Reference: https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
- General Graph limits + `X-App-Usage`: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- Relevant codes: **4** (app-level), **17** (user-level too-many-calls), **613** (custom limit).
- `launch.js` creates entities **sequentially** so the guard chain runs per call and rate
  pressure stays low; it does **not** auto-retry.

## Error handling

- Errors page (codes, types, `fbtrace_id`): https://developers.facebook.com/docs/graph-api/guides/error-handling/
- On any 4xx, `launch.js` records `{stage, name, error}` in `created.errors`, keeps creating
  sibling entities, performs **no rollback**, and surfaces the full set in `campaign_log.json`.
  A failed campaign skips its child adsets/ads. Log code/type/`fbtrace_id` to `error_log`; never auto-retry.

## Keeping current

When Meta ships a new version, bump `API_VERSION` in `scripts/lib/meta-graph.js`, re-verify
each row against the changelog (https://developers.facebook.com/docs/graph-api/changelog),
update the "verified" date here and in `skills/references-shared.md`. Do not hardcode a version in this skill.

**Last verified:** 2026-06-22
