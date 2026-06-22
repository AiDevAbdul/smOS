# Intake — API Reference

The only external API intake touches is a single **read-only** Meta Graph API call to
detect an ad account's currency and timezone. It runs only when a real `ad_account_id`
(not `TBD*`) is supplied. Consult this when the detection step errors or returns unexpected
values. Endpoints/versions are drawn from `skills/references-shared.md`.

---

## 1. Endpoint — Ad Account read

`intake.js → detectAccountMeta(adAccountId)` calls, via `scripts/lib/meta-graph.js`:

```
GET https://graph.facebook.com/v25.0/act_<AD_ACCOUNT_ID>
      ?fields=currency,timezone_name,account_status,name
      &access_token=<resolved-token>
```

- The ID is normalized to `act_<id>` if the operator supplied a bare number.
- Pinned API version: **v25.0** (current; released 2026-02-18, no newer version).
- All requests pass through `createGraph()`, which adds retry-with-backoff for transient
  errors and surfaces token-expiry (code 190) as a non-retryable `TokenExpiredError`.

### Fields consumed

| Field | Type | Mapped to | Fallback |
|---|---|---|---|
| `currency` | ISO 4217 string (e.g. `USD`, `PKR`) | `accounts.currency` | provided value → `USD` |
| `timezone_name` | IANA tz (e.g. `America/New_York`) | `accounts.timezone` | provided value → `UTC` |
| `account_status` | int enum (1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, …) | `accounts.ad_account_status` | omitted if absent |
| `name` | string | `accounts.ad_account_name` | omitted if absent |

Detection failure is non-fatal: `intake.js` logs a `WARN` and continues with provided
values / `USD` / `UTC`. Verification of pixel/page IDs is intentionally deferred to `/audit`.

---

## 2. Rate limits

Reads are subject to standard Graph + Marketing API limits. Intake makes at most one call
per `build`, so it will not approach limits on its own, but the shared client honors them.

| Header | Meaning |
|---|---|
| `X-App-Usage` | App-level call/CPU/time usage (% of allowance) |
| `X-Business-Use-Case-Usage` | Per-business-use-case (BUC) usage for ads-management |
| `X-Ad-Account-Usage` | Ad-account-specific call counters |

Relevant rate-limit error codes (back off, retried automatically by `meta-graph.js`):
`4` (app-level), `17` (user-level, `API_EC_USER_TOO_MANY_CALLS`), `613` (custom/per-product),
plus `32`, `341`, `80000-80008`. Token problems (`190`, `102`, `463`, `467`) are NOT retried.

---

## 3. Error handling

On a Graph error, `meta-graph.js` logs the full error (code, type, `fbtrace_id`). For intake:

| Code | Meaning | Intake behavior |
|---|---|---|
| `100` | invalid param / no access to the act_ id | WARN + continue; surface that the System User token needs access granted to this account |
| `190` | token expired/invalid | non-retryable; surface a re-auth prompt |
| `4 / 17 / 613 / 32 / 341` | rate limit | auto-retried with backoff |
| `500/502/503/504`, network resets | transient | auto-retried with backoff |

---

## 4. Source URLs (verified 2026-06-22)

| Resource | URL |
|---|---|
| Ad Account node (fields incl. `currency`, `timezone_name`, `account_status`) | https://developers.facebook.com/docs/marketing-api/reference/ad-account/ |
| Graph API versioning (v25.0 pin + lifecycle) | https://developers.facebook.com/docs/graph-api/guides/versioning/ |
| Versions list (confirm current) | https://developers.facebook.com/docs/graph-api/changelog/versions/ |
| Handle Errors (codes, `fbtrace_id`) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ |
| Graph API Rate Limits (`X-App-Usage`, codes 4/17/613) | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ |
| Marketing API Rate Limiting (ad-account specifics) | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ |

To keep current: re-confirm the pinned version against the *Versions list* and re-check the
*Ad Account* field names. Mirror any change back into `skills/references-shared.md` so all
skills stay consistent.

**Last verified:** 2026-06-22
