# /scale — Meta API Reference

The exact Meta Graph/Marketing API surface `/scale` touches at `--execute`, the
version pin, rate-limit codes, and the guarded retry behavior. All writes go through
`scripts/lib/meta-graph.js` (`createGraph`), which runs `guardGraphWrite` before the
request leaves the process. Read independently of SKILL.md.

API version pin: **v25.0** (`API_VERSION` in `meta-graph.js`; base
`https://graph.facebook.com/v25.0`). Confirmed current — released 2026-02-18, no newer
version exists.

---

## 1. Endpoints used

| Action | Method + path | Body fields | Doc |
|---|---|---|---|
| Pause an ad | `POST /{ad_id}` | `{ "status": "PAUSED" }` | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ |
| Scale an adset | `POST /{adset_id}` | `{ "daily_budget": "<cents-as-string>" }` | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ |
| Read source adset spec (for clone) | `GET /{adset_id}` | `fields=name,campaign_id,optimization_goal,billing_event,bid_strategy,bid_amount,targeting,promoted_object,attribution_spec,destination_type` | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ |
| Create the clone adset | `POST /act_{ad_account_id}/adsets` | `name, campaign_id, daily_budget, optimization_goal, billing_event, targeting, status:"PAUSED"` (+ optional `bid_strategy, bid_amount, promoted_object, attribution_spec, destination_type` when present on source) | https://developers.facebook.com/docs/marketing-api/reference/ad-account/ |
| Rollback un-pause | `POST /{entity_id}` | `{ "status": "ACTIVE" }` | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ |
| Rollback restore budget | `POST /{adset_id}` | `{ "daily_budget": "<before-cents>" }` | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ |

Notes:
- `daily_budget` is **cents as a string** (e.g. `"24000"` = $240.00).
- The clone is always created `status: PAUSED` — it never goes live without a human.
- URL-slug gotcha: `reference/ad-campaign/` is the **AdSet**; `reference/adgroup/` is the **Ad**.

---

## 2. Auth & request shape

- `META_ACCESS_TOKEN` required (system-user token for the ad account). `createGraph` throws if absent.
- When `META_APP_SECRET` is set, every call includes `appsecret_proof = HMAC-SHA256(token)` keyed by the app secret (required once an app enables "Require App Secret").
- Default request timeout: 30s.

---

## 3. Rate limits & retry

`createGraph` retries transient failures with exponential backoff + full jitter
(`maxRetries = 4`, `baseDelayMs = 500`), honoring a `Retry-After` header when present.

| Class | Codes / statuses | Behavior |
|---|---|---|
| Meta rate / transient | 1, 2, 4 (app), 17 (user), 32 (page), 341, 613, 80000–80008 | retry with backoff |
| HTTP | 429, 500, 502, 503, 504 | retry with backoff |
| Network | ECONNRESET, ETIMEDOUT, ECONNABORTED, EAI_AGAIN, ENOTFOUND | retry with backoff |
| Token expired/invalid | 190 (+ OAuthException 102, 463, 467) | **never retried** — thrown as `TokenExpiredError`; prompt re-auth |
| Other 4xx (validation, permissions) | — | thrown immediately, not retried |

Rate-limit details: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ (watch `X-Business-Use-Case-Usage`). Error handling: https://developers.facebook.com/docs/graph-api/guides/error-handling/.

---

## 4. Guard chokepoint (runs before every POST)

`guardGraphWrite({ method, path, data, token })` runs the shared rule-set before any
mutation. Relevant to `/scale`:

- **budget-guard** — blocks a `daily_budget` write above the client cap (`monthly_budget_high / 30`), above 2× the cap, or above the $500/day single-increase global threshold. On block it throws `GuardError`; `/scale` records the decision as failed/blocked and routes to the approval queue. This is why over-ceiling scales must be queued, not auto-applied.

The guard runs **once per request** (not per retry) — a blocked request never goes out.

---

## 5. Error envelope

A Meta error surfaces as `Meta API <code>: <message> (type=..., trace=<fbtrace_id>)`
with `err.metaError = { code, type, message, fbtrace_id, error_subcode }`. `/scale`
stores `error` + `meta` (the `metaError`) on the failed decision and continues with
the remaining actions — one failed write never aborts the run.

**Last verified:** 2026-06-22 against `skills/references-shared.md`.
