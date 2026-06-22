# Audience-Map API Reference

All calls go through the shared client `scripts/lib/meta-graph.js` (`createGraph`), which
pins the version, adds `appsecret_proof`, enforces fail-closed write guards, and retries
transient errors. `/audience-map` makes **read-only** calls only — no account mutations.

- **API version:** `v25.0` (constant `API_VERSION` in `meta-graph.js`). Base URL
  `https://graph.facebook.com/v25.0`. Confirmed current — released 2026-02-18, no newer
  version (see `skills/references-shared.md`).
- **Auth:** `META_ACCESS_TOKEN` (resolved via `load-env.js`). When `META_APP_SECRET` is set,
  every call also sends `appsecret_proof = HMAC-SHA256(token)` keyed by the app secret.

---

## 1. Interest search — `GET /search?type=adinterest`

Resolve a seed term to candidate Meta ad interests.

**Request params**

| Param | Value | Notes |
|-------|-------|-------|
| `type` | `adinterest` | Fixed — targeting-interest search type |
| `q` | seed term | One call per seed; all seeds fired in parallel via `Promise.all` |
| `limit` | `5` | Top 5 candidates per seed |

**Returned fields used** (per `data[]` row):

| Field | Use |
|-------|-----|
| `id` | Interest ID — join key into adset targeting at `/launch` |
| `name` | Display name |
| `audience_size_lower_bound` | Lower size — filtered against the 100k floor |
| `audience_size_upper_bound` | Upper size — filtered against the 50M ceiling |
| `path` | Taxonomy path array — `path[1]` is the cluster theme bucket |
| `topic` | Fallback cluster key when `path` is absent |

A failed search for one seed returns `[]` (the seed is dropped); it never aborts the run.

Docs: Graph API root — https://developers.facebook.com/docs/graph-api/ ·
Marketing API targeting — https://developers.facebook.com/docs/marketing-api/

---

## 2. Custom audiences — `GET /act_<id>/customaudiences`

List existing custom audiences to pick a lookalike seed. Skipped when
`accounts.ad_account_id` is TBD/empty (`isTbd`) or in `--offline` mode.

**Request params**

| Param | Value |
|-------|-------|
| `fields` | `id,name,approximate_count_lower_bound,approximate_count_upper_bound,subtype,operation_status` |
| `limit` | `100` |

The `act_` prefix is added if missing. `operation_status.code === 200` means the audience is
usable (ready); any other code → treated as `degraded`/unhealthy for seed selection.

Returns `null` on error or when offline/TBD — the caller treats `null`/empty as "no seed,
health: missing".

Docs: Marketing API — https://developers.facebook.com/docs/marketing-api/

---

## 3. Rate limits & error handling

Handled by `meta-graph.js`; relevant to `/audience-map` because parallel interest searches
plus a custom-audience pull can trip account limits.

| Code | Meaning | Client behavior |
|------|---------|-----------------|
| 4 | App-level rate limit | Retry w/ exponential backoff + jitter (≤4 attempts) |
| 17 | User-level rate limit (`API_EC_USER_TOO_MANY_CALLS`) | Retry |
| 32 | Page-level rate limit | Retry |
| 613 | Calls-per-hour limit (custom audiences) | Retry |
| 429 / 5xx | HTTP transient | Retry; honors `Retry-After` header |
| 190 (+102/463/467) | Token expired/invalid | `TokenExpiredError`, never retried — caller must re-auth |

Non-retryable Meta errors surface as `Meta API <code>: <message> (type=…, trace=<fbtrace_id>)`.
Log the full `code/type/fbtrace_id`; do not auto-retry beyond the built-in transient policy.

Rate-limit docs: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ ·
Error handling: https://developers.facebook.com/docs/graph-api/guides/error-handling/

---

## 4. Offline mode

`--offline`, or an auto-detected TBD `ad_account_id`, runs **no Graph calls at all**:
no interest resolution, no custom-audience pull. The map still emits geo, age/gender, seed
terms, behavior segments, retargeting layers, and exclusions (all profile-derived), with
empty `clusters`, `lookalike_strategy.health = skipped_offline`, and a diagnostics note to
rerun once the real account ID is set.

**Last verified:** 2026-06-22
