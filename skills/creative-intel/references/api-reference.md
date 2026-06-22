# creative-intel — API Reference

Exact Meta Graph API surface this skill touches. Read-only; the skill never POSTs.
All calls go through `scripts/lib/meta-graph.js` (`createGraph`), which pins the version,
signs with `appsecret_proof`, retries transient errors with backoff, and surfaces
non-retryable errors. Self-contained: endpoints, fields, params, version, rate limits.

## Version

- **Graph API v25.0** (`API_VERSION` in `meta-graph.js`; base `https://graph.facebook.com/v25.0`).
- v25.0 is the current/latest version (released 2026-02-18), per the versions list. No newer
  version and no deprecation scheduled.

## Endpoints used

### 1. List ads under the account

```
GET /act_<ad_account_id>/ads
  ?fields=id,name,status,effective_status,creative{id},adset_id,campaign_id
  &filtering=[{"field":"ad.impressions","operator":"GREATER_THAN","value":0}]
  &limit=100
  &date_preset=last_<window>d
```

- Paginated via the shared client's `paginate(path, params, max=1000)` (follows `paging.next`).
- **Fallback:** if Meta rejects the `filtering` clause, the skill re-runs the same query without
  `filtering` (all non-archived ads) and lets per-ad insights determine activity.
- Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-account/

### 2. Per-ad daily insights

```
GET /<ad_id>/insights
  ?fields=impressions,clicks,inline_link_clicks,inline_link_click_ctr,frequency,spend,reach
  &time_increment=1
  &date_preset=last_<window>d
```

- `time_increment=1` returns one row per day, each with `date_start`/`date_stop`.
- Issued in batches of 10 ads (`Promise.all` per batch) to spread load.
- Reference (Ad node / insights edge): https://developers.facebook.com/docs/marketing-api/reference/adgroup/

### Returned fields consumed

| Field | Used for |
|-------|----------|
| `inline_link_click_ctr` | `ctr_30d_avg`, `ctr_7d_avg`, `ctr_delta`, decline streak |
| `frequency` | `frequency_7d` (max over trailing 7) |
| `spend` | `spend_7d`, refresh-priority score |
| `impressions` | `days_active` |
| `date_start` / `date_stop` | ascending sort of the daily series |
| `id,name,effective_status,creative{id},adset_id,campaign_id` (from ads edge) | identity carried into output |

## Rate limits & throttle-halt contract

Meta enforces app-, user-, and business-use-case rate limits, surfaced via `X-App-Usage` and
`X-Business-Use-Case-Usage` headers and these error codes:

| Code | Meaning |
|------|---------|
| 4 | Application-level rate limit |
| 17 | User-level rate limit (`API_EC_USER_TOO_MANY_CALLS`) |
| 613 | Custom / calls-per-hour limit |

> There is **no** "code 17 subcode 613" pairing — 613 is its own top-level code.

**Handling (two layers):**
1. The shared `createGraph` client treats codes 4/17/613 (and HTTP 429/5xx, network blips) as
   retryable and applies exponential backoff with full jitter, honoring `Retry-After` when present
   (`maxRetries=4`, `baseDelayMs=500`).
2. If a throttle code **still surfaces** to this skill after backoff is exhausted, `fetchAdDaily`
   detects it (`isThrottle`) and throws a `ThrottleError`. The skill then **HALTS** — it does NOT
   auto-retry — logs `code`, `type`, and `fbtrace_id` to stderr, and exits 4. This prevents a
   truncated pull from being misreported as "no fatigue detected."

Non-throttle per-ad errors are isolated: that ad is marked `flag: "ERROR"` and the run continues.

Token errors (codes 190/102/463/467) are raised by the shared client as a non-retryable
`TokenExpiredError` — the run halts and the caller must re-auth.

- Rate limits: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- Error handling / `fbtrace_id`: https://developers.facebook.com/docs/graph-api/guides/error-handling/

## Auth

- Bearer via `access_token` query param, sourced from `META_ACCESS_TOKEN` (env, loaded by `load-env.js`).
- `appsecret_proof` (HMAC-SHA256 of the token keyed by `META_APP_SECRET`) added automatically when
  `META_APP_SECRET` is set; required by apps with "Require App Secret" enabled.

**Last verified:** 2026-06-22 (against `skills/references-shared.md` canonical map).
