# /rules — Meta Marketing API Reference (adrules_library)

Exact endpoints, fields, enums, version, and limits used by `rules.js`. Cited from
`skills/references-shared.md`. Readable standalone.

**API version:** `v25.0` (pinned in `scripts/lib/meta-graph.js`; base
`https://graph.facebook.com/v25.0`). v25.0 is current — released 2026-02-18, no newer version.
**Required scope:** `ads_management`.

## Endpoints

| Operation | Method + Path | Notes |
|---|---|---|
| List rules | `GET /act_{ad_account_id}/adrules_library` | `fields=id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time`, `limit=200` |
| Create rule | `POST /act_{ad_account_id}/adrules_library` | Body fields below; nested objects sent JSON-stringified |
| Set status | `POST /{rule_id}` | `{ status: "ENABLED" | "DISABLED" }` |
| Preview matches | `POST /{rule_id}/preview` | Returns entities that currently match (dry-run) |
| Execution history | `GET /{rule_id}/history` | `fields=evaluation_type,results,timestamp,object_count,action,error_code,error_message`, `limit=200` |

`act_{id}` is normalized by `graph.act(id)` (strips any leading `act_`, re-adds one).

## Create-rule body fields

| Field | Type | Value used by smOS |
|---|---|---|
| `name` | string | Template name, e.g. `PAUSE_RUNAWAY_CPA` (uniqueness key) |
| `evaluation_spec` | object | `{ evaluation_type: "SCHEDULE", filters: [...], time_window: ... }` |
| `execution_spec` | object | `{ execution_type: "PAUSE"|"NOTIFICATION", execution_options: [] }` |
| `schedule_spec` | object | `{ schedule_type: "SEMI_HOURLY"|"DAILY" }` |
| `entities` | object | `{ entity_type: "AD"|"ADSET" }` (no entity ids → account-wide) |
| `status` | string | `ENABLED` (default) / `DISABLED` |

`serializeBody()` in `rules.js` JSON-stringifies every nested object before POST, as the
Graph form-encoded edge requires.

## Enum cheat-sheet

- `evaluation_type`: `SCHEDULE` (smOS uses this) or `TRIGGER`.
- `schedule_type`: `SEMI_HOURLY`, `HOURLY`, `DAILY` (verified across the schedule-based-rules
  and execution-spec guides; no single enum page exists).
- `execution_type`: `PAUSE`, `UNPAUSE`, `CHANGE_BUDGET`, `REBALANCE_BUDGET`, `NOTIFICATION`,
  `PING_ENDPOINT`. smOS uses only `PAUSE` and `NOTIFICATION`.
- Filter `operator`: `GREATER_THAN`, `LESS_THAN`, `EQUAL`, `IN`, `CONTAIN`, etc.
- `time_window`: `TODAY`, `YESTERDAY`, `LAST_3_DAYS`, `LAST_7_DAYS`, `LIFETIME`, …
- Filter `field` examples: `spent` (cents), `ctr` (percent), `frequency`, `impressions`,
  `effective_status`, `cost_per_action_type:offsite_conversion.fb_pixel_purchase`.

## Rate limits & error handling

- Ad-account rate limits are reported via the `X-Business-Use-Case-Usage` header; back off
  when usage nears 100%. meta-graph.js retries codes 4 / 17 / 32 / 613 / 80000-series and
  HTTP 429/500/502/503/504 with exponential backoff + jitter (honors `Retry-After`).
- Token errors (190 / 102 / 463 / 467) raise a non-retryable `TokenExpiredError` — re-auth,
  do not retry.
- Every Meta error is logged with `code`, `type`, and `fbtrace_id`; no automatic retry on
  non-transient codes.
- Account caps roughly **50 rules** — a create beyond the cap errors; prune first.

## Source URLs (verified 2026-06-22)

| Resource | URL |
|---|---|
| Ad Account adrules_library | https://developers.facebook.com/docs/marketing-api/reference/ad-account/adrules_library/ |
| Ad Rule node | https://developers.facebook.com/docs/marketing-api/reference/ad-rule/ |
| Execution Spec | https://developers.facebook.com/docs/marketing-api/ad-rules/overview/execution-spec/ |
| Schedule-based rules | https://developers.facebook.com/docs/marketing-api/ad-rules/guides/scheduled-based-rules/ |
| Advanced scheduling | https://developers.facebook.com/docs/marketing-api/ad-rules/guides/advanced-scheduling |
| Ad Rules engine overview | https://developers.facebook.com/docs/marketing-api/ad-rules |
| Graph API versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ |

To extend the library or verify a field, fetch the adrules_library reference above and
mirror its enum spelling exactly.

**Last verified:** 2026-06-22
