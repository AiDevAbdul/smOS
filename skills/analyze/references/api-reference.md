# /analyze — API Reference

Exact Meta Graph/Marketing API surface used by `analyze.js`. The skill is
**read-only** — it calls only GET edges (no campaign/adset/ad mutations). All calls
go through `scripts/lib/meta-graph.js`, which pins the version, signs with
`appsecret_proof`, retries transient errors, and surfaces token errors. Cited URLs
come from `skills/references-shared.md` (verified 2026-06-22).

---

## Version

- **API version:** `v25.0` (constant `API_VERSION` in `meta-graph.js`).
- Base URL: `https://graph.facebook.com/v25.0`.
- v25.0 is current (released 2026-02-18; no newer version, no deprecation).
- Confirm pin: https://developers.facebook.com/docs/graph-api/guides/versioning/

---

## Edges used (all GET)

| Purpose | Edge | Key params |
|---------|------|-----------|
| List campaigns | `GET /act_<id>/campaigns` | `fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time`; `filtering=[{field:effective_status,operator:IN,value:[ACTIVE,PAUSED]}]`; `limit=100` |
| List adsets | `GET /<campaign_id>/adsets` | `fields=id,name,status,effective_status,daily_budget,targeting`; `limit=100` |
| List ads | `GET /<adset_id>/ads` | `fields=id,name,status,effective_status,creative`; `limit=100` |
| Entity insights | `GET /<entity_id>/insights` | `fields=<INSIGHT_FIELDS>`; `date_preset` ∈ {`last_7d`,`last_14d`,`last_30d`} |
| Breakdown insights | `GET /<adset_id>/insights` | adds `breakdowns=<dim>` |
| Per-day persistence | `GET /<campaign_id>/insights` | adds `time_increment=1` (daily rows for `daily_metrics`) |

Pagination via `graph.paginate(path, params, cap)` (caps: campaigns 500, adsets/ads 200).
Account id is normalized with `graph.act(ad_account_id)` (ensures `act_` prefix).

Docs: Marketing API root https://developers.facebook.com/docs/marketing-api/ ·
Graph API root https://developers.facebook.com/docs/graph-api/

---

## INSIGHT_FIELDS (requested on every insights call)

```
spend, impressions, reach, frequency, clicks, ctr, cpc, cpm,
inline_link_clicks, inline_link_click_ctr,
actions, action_values, cost_per_action_type, purchase_roas
```

- `ctr` and `inline_link_click_ctr` are returned as **percentages**.
- `actions` / `action_values` are arrays of `{action_type, value}`; `deriveMetrics`
  selects the first matching primary event.
- `purchase_roas` is an array; `[0].value` preferred for ROAS when present.

---

## Breakdown enums (active adsets, `last_14d`)

| Dimension | `breakdowns` value | Returned keys |
|-----------|--------------------|---------------|
| Placement | `publisher_platform,platform_position` | `publisher_platform`, `platform_position` |
| Age + gender | `age,gender` | `age`, `gender` |
| Device | `device_platform` | `device_platform` |

`last_14d` is used for breakdowns deliberately — shorter windows are too noisy at
segment granularity. Skip all breakdowns with the `--no-breakdowns` CLI flag.

---

## Rate limiting & errors (handled in `meta-graph.js`)

- **Retryable** (exponential backoff + jitter): Meta codes 1, 2, 4, 17, 32, 341,
  613, 80000–80008; HTTP 429/500/502/503/504; network ECONNRESET/ETIMEDOUT/etc.
- **Never retried — token errors:** codes 190/102/463/467 throw `TokenExpiredError`
  so callers prompt re-auth instead of hammering a dead token.
- Per-entity insight failures are caught inside `analyze.js` and stored as
  `{error}` for that window — the run continues (fail-soft).
- `analyze.js` itself does NOT add retry logic; it relies on the client and surfaces
  `fbtrace_id`/messages.

Docs:
- Handle Errors: https://developers.facebook.com/docs/graph-api/guides/error-handling/
- Graph rate limits (codes 4/17/613, `X-App-Usage`): https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- Marketing API rate limits (ad-account insights): https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/

---

## Concurrency

- Entities processed in `inBatches(items, 5, fn)` — 5 at a time to respect ad-account
  insight limits; the three windows for one entity run in parallel within its batch.

**Last verified:** 2026-06-22
