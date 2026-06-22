# Attribution — Meta API Reference

Self-contained API reference for `/attribution`. The skill reads a Meta Conversion
Lift study node; it performs **no account mutations** (read-only on the ad account).
All calls go through the shared client `scripts/lib/meta-graph.js`, which pins the
version, applies guards on writes (none here), retries transient errors, and
surfaces token expiry as non-retryable.

## Version

- **Graph API version:** `v25.0` (pinned in `scripts/lib/meta-graph.js` → `API_VERSION`; base `https://graph.facebook.com/v25.0`).
- v25.0 is current (released 2026-02-18). Confirm lifecycle: https://developers.facebook.com/docs/graph-api/guides/versioning/

## Endpoint used

Read a Conversion Lift study by id (the skill's `pullLiftStudy`):

```
GET /v25.0/{studyId}
  ?fields=id,name,type,start_time,end_time,cells{id,name,results,result_set,spend}
  &access_token={user/system token}
```

Field notes (mapped in `scripts/lib/lift_study.js`):

| Field | Meaning |
|-------|---------|
| `id`, `name`, `type` | Study identity + study type |
| `start_time`, `end_time` | Inherited as report `period_start`/`period_end` if not overridden |
| `cells{...}` | Test/control cells. Each carries `results` (array/object) OR `result_set` (blob) depending on study type + API version |
| `results.incremental_conversions` / `results.incremental` / `cell.incremental_conversions` | Incremental conversions (aliased) |
| `results.lift` / `results.relative_lift` / `cell.lift` | Lift factor (aliased) |
| `results.control_conversions` / `results.last_click_conversions` | Last-click baseline |
| `results.spend` / `cell.spend` | Cell spend |
| `results.confidence` / `results.p_value` | Significance |

A cell with **neither** an incremental figure nor a lift factor is skipped (not
measurable yet → caller HALTs). The mapper never synthesizes a number.

## Authentication

- Token resolved via `scripts/lib/tokens.js` `resolveToken("user", slug, {require:false})`.
- Resolution order: per-client env `META_ACCESS_TOKEN_<SLUG>` → `profile.accounts.access_token` → global `META_ACCESS_TOKEN` (discouraged).
- `appsecret_proof` (HMAC-SHA256 of the token, keyed by `META_APP_SECRET`) is attached automatically by the shared client when a secret is set.

## Rate limits

- App / user / business-use-case limits apply. Watch `X-App-Usage` and `X-Business-Use-Case-Usage` headers.
- Codes: `4` app-level, `17` user-level, `613` custom/calls-per-hour. These are retried with backoff by the shared client (`RETRYABLE_META_CODES`).
- Source: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ and (ad-account specifics) https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/

## Error handling

- The shared client normalizes errors to `Meta API {code}: {message} (type=…, trace={fbtrace_id})`.
- Token expiry (codes `190/102/463/467`) → `TokenExpiredError`, **never retried** — re-auth required.
- Transient (HTTP 429/5xx, net `ECONNRESET`/`ETIMEDOUT`/…, retryable Meta codes) → exponential backoff + jitter, honoring `Retry-After`.
- Do NOT add a retry loop in the skill; the client owns retry. Log full error context (code/type/`fbtrace_id`).
- Source: https://developers.facebook.com/docs/graph-api/guides/error-handling/

## Cited documentation

| Resource | URL | Use |
|----------|-----|-----|
| Graph API root | https://developers.facebook.com/docs/graph-api/ | Node/edge/field read model |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | v25.0 lifecycle |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Measurement entry point |
| Conversions API overview | https://developers.facebook.com/docs/marketing-api/conversions-api/ | What conversions are measured against |
| Handle Errors | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes + `fbtrace_id` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Headers + codes 4/17/613 |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account limits |

**Last verified:** 2026-06-22 (against `skills/references-shared.md`). When Meta releases a version past v25.0 or renames Conversion Lift fields, re-verify the endpoint + field list here and the mapper in `scripts/lib/lift_study.js`.
