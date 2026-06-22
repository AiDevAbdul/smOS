# setup-accounts — Meta Graph API Reference

Exact endpoints, request bodies, asset-task enums, version pin, rate limits, and token handling for the `--bootstrap` API half. All requests go through `scripts/lib/meta-graph.js → createGraph()`, which prepends the base URL, injects `access_token` + `appsecret_proof`, runs the fail-closed guard chokepoint, and retries transient failures with backoff. Self-contained: read this to make `--bootstrap` accurate without inspecting the client code.

URLs are cited from `skills/references-shared.md` (the canonical, version-verified map).

---

## Version + base

| Item | Value |
|------|-------|
| API version (pinned) | `v25.0` (`API_VERSION` in `meta-graph.js`; current — released 2026-02-18) |
| Base URL | `https://graph.facebook.com/v25.0` |
| Auth | `access_token` (query) = `META_ACCESS_TOKEN`; `appsecret_proof` = HMAC-SHA256(token) keyed by `META_APP_SECRET` (added automatically when the secret is set) |

| Resource | URL |
|----------|-----|
| Graph API versioning | https://developers.facebook.com/docs/graph-api/guides/versioning/ |
| Versions list (v25.0 latest) | https://developers.facebook.com/docs/graph-api/changelog/versions/ |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ |
| Handle Errors | https://developers.facebook.com/docs/graph-api/guides/error-handling/ |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ |
| Domain Verification | https://developers.facebook.com/docs/sharing/domain-verification/ |

---

## Endpoints called by `--bootstrap` (in order)

### 1. Create ad account
```
POST /{business_id}/adaccount
{
  "name": "<client name> Ad Account",
  "currency": "USD",          // accounts.currency override or default
  "timezone_id": 1,           // 1 = America/Los_Angeles; adjust per client tz
  "end_advertiser": "<business_id>",
  "media_agency": "<business_id>",
  "partner": "NONE"
}
→ { "id": "act_<id>" }   // stored as accounts.ad_account_id
```
**Cap:** 5 ad accounts per business via API. **Failure 100/200** → missing Advanced Access or business verification.

### 2. Create pixel / dataset
```
POST /{business_id}/adspixels
{ "name": "<client name> Pixel" }
→ { "id": "<pixel_id>" }   // stored as accounts.pixel_id
```
Pixel ID and Dataset ID are the same identifier (CAPI events later POST to `/{DATASET_ID}/events` — owned by `/capi-setup`).

### 3. Create system user
```
POST /{business_id}/system_users
{ "name": "<slug>-smos-sysuser", "role": "ADMIN" }
→ { "id": "<system_user_id>" }   // stored as accounts.system_user_id
```
**Token note:** generating the non-expiring access token (`/{system_user_id}/access_tokens`) is intentionally NOT done here — it would print a long-lived secret to stdout/logs. The operator generates and stores it out-of-band (env `META_PAGE_TOKEN_<SLUG>` etc., per `scripts/lib/tokens.js`). The skill records only `system_user_id` + `system_user_token_at`.

### 4. Assign owned assets to the system user
```
POST /{facebook_page_id}/assigned_users
{ "user": "<system_user_id>",
  "tasks": ["MANAGE","CREATE_CONTENT","MODERATE","ADVERTISE","ANALYZE"] }

POST /act_{ad_account_id}/assigned_users
{ "user": "<system_user_id>",
  "tasks": ["MANAGE","ADVERTISE","ANALYZE"] }
```
Each assignment is skipped if its target id is unset (`isTbd`). Per-step failures are collected into `errors[]`; they do not abort the run.

---

## Idempotency

Every create step is guarded by `isTbd(accounts.<id>)` — if the id is already present, the step is skipped. Re-running `--bootstrap` only fills the still-missing assets, so it is safe to re-run after fixing a verification/permission error.

---

## Error codes

| Code/type | Meaning | Handling |
|-----------|---------|----------|
| 100 / 200 (permissions) | Missing Advanced Access or business not verified | Collected in `errors[]`; point to `docs/agency-foundation.md` |
| 190 / 102 / 463 / 467 (OAuthException) | Token expired/invalid | `TokenExpiredError` — non-retryable; prompt re-auth |
| 4 / 17 / 32 / 613 / 341 / 80000–80008 | Rate limits | Auto-retried with exponential backoff + jitter (honors `Retry-After`) |
| 429 / 5xx, `ECONNRESET`/`ETIMEDOUT`/… | Transient HTTP/network | Auto-retried (up to `maxRetries`, default 4) |

Every non-retryable Meta error surfaces with `code`, `type`, and `fbtrace_id` (`Meta API <code>: <message> (type=..., trace=...)`). The skill never auto-retries beyond the transient set.

---

## Rate limits

Ad-account and business-management calls are subject to app-level (code 4), user-level (code 17, `API_EC_USER_TOO_MANY_CALLS`), and custom (code 613) limits. Watch the `X-App-Usage` / `X-Business-Use-Case-Usage` response headers. `meta-graph.js` treats all of these as retryable and backs off; bootstrap volume is tiny (a handful of writes), so limits are rarely hit in practice.

---

**Last verified:** 2026-06-22 (Graph API v25.0; endpoints confirmed against the URLs above and `skills/references-shared.md`).
