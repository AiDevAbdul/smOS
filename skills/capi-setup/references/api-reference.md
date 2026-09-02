# capi-setup — Meta Graph API Reference

Exact endpoints, fields, version, and rate limits this skill touches. All calls route through
`scripts/lib/meta-graph.js` (`createGraph`), which pins the version, signs with
`appsecret_proof` when `META_APP_SECRET` is set, retries transient errors with backoff, and
surfaces token errors (code 190) as a non-retryable `TokenExpiredError`.

## Version

- **API version:** `v25.0` (constant `API_VERSION` in `meta-graph.js`; base `https://graph.facebook.com/v25.0`).
- v25.0 is current (released 2026-02-18); no newer version exists.
- Source: https://developers.facebook.com/docs/graph-api/changelog/versions/

## Endpoints used

### 1. Pixel stats (read) — overall counts, per event name

```
GET /{pixel_id}/stats?start_time=<unix -7d>&aggregation=event
```
Returns **hourly buckets**, each with its own nested `data` array — not a flat list of rows:

```json
{ "data": [
  { "start_time": "2026-08-25T00:00:00-0700", "aggregation": "event",
    "data": [ { "value": "Lead", "count": 3 }, { "value": "Purchase", "count": 0 } ] }
] }
```
`scripts/lib/meta-stats.js::flattenStatsBuckets()` unwraps this into flat
`{ time, name, count }` rows — every caller that touches `/stats` MUST go through it rather
than re-parsing the nested shape inline (a second, ad-hoc reimplementation of this parsing in
`scripts/lib/guards.js::checkPixel` once assumed a flat response and always reported
`firing: false`; fixed 2026-09-02 by switching it to the same shared helper).

There is no combined "aggregation=event_name_and_method" (or `event_name_and_source`) param —
Meta rejects it as an invalid aggregation value. Getting counts-per-event and the
browser/server split in the same call is not supported; see endpoint 2.

### 2. Pixel stats (read) — source breakdown, one event at a time

```
GET /{pixel_id}/stats?start_time=<unix -7d>&aggregation=event_source&event=<event_name>
```
`aggregation=event_source` only splits `BROWSER`/`SERVER` for **all** events combined — it must
be filtered to one event via the `event` param, so the skill issues **one call per required
conversion event** (`getSourceBreakdown`) in addition to the single call in endpoint 1 and the
dataset-metadata call in endpoint 3. For the default 6-event `requiredEvents` list that's up to
8 Graph API calls per `/capi-setup` run, not 2 — factor that into rate-limit/latency expectations
for clients with a long custom `conversion_events` list. Same nested-bucket shape as endpoint 1;
row `value` is `BROWSER` or `SERVER`.

### 3. Dataset node (read) — CAPI-side metadata

```
GET /{dataset_id}?fields=id,name,last_fired_time,first_party_cookie_status,
    enable_automatic_matching,automatic_matching_fields,creation_time
```
`dataset_id` == `pixel_id`. `enable_automatic_matching:false` drives the AAM gap.
Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api/

### 4. Send test event (write) — optional, `--test-event`

```
POST /{dataset_id}/events
body: { "data": [ <server_event> ], "test_event_code": "TEST<code>" }
```
With `test_event_code`, the event appears only in Events Manager → Test Events and does NOT
enter production reporting. The synthetic event sent:

```json
{
  "event_name": "Lead",
  "event_time": 1718900000,
  "event_id": "capi-test-<ts>-<rand>",
  "action_source": "system_generated",
  "user_data": { "em": "<sha256>", "client_user_agent": "smOS/capi-setup-test" },
  "custom_data": { "content_name": "smOS CAPI verification test" }
}
```
- Using the API: https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/
- Server Event Parameters: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/
- Main Body (`test_event_code`): https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/main-body/

> Every `POST` runs the fail-closed guard chokepoint in `meta-graph.js` BEFORE the request
> leaves the process. The test event is sent test-coded only — never a production conversion.

## Required scopes

`META_ACCESS_TOKEN` must carry `ads_management` + `business_management`. A 403/OAuth gap means
a missing scope — surface which one. Token expiry (code 190 / OAuthException) is non-retryable.

## Rate limits & error handling

- Retryable Meta codes (handled by `meta-graph.js` with exponential backoff + jitter, honoring
  `Retry-After`): 1, 2, 4 (app rate limit), 17 (user rate limit), 32 (page), 341, 613, 80000–80008.
- Retryable HTTP: 429, 500, 502, 503, 504. Retryable network: ECONNRESET, ETIMEDOUT, etc.
- Non-retryable token codes: 190, 102, 463, 467 → `TokenExpiredError`.
- Watch `X-App-Usage` / `X-Business-Use-Case-Usage` headers for approaching limits.
- Every Meta error carries `code`, `type`, `message`, `fbtrace_id` — log all four.
- Error handling: https://developers.facebook.com/docs/graph-api/guides/error-handling/
- Rate limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

## Failure-tolerance behavior

Each read (`getPixelStats`, `getSourceBreakdown`, `getDatasetInfo`) `.catch`es to a soft payload
(`{ error, data: [] }` or `{ error }`) so a partial outage still yields a complete report rather
than a hard crash. Only the missing-`pixel_id` precondition hard-halts (exit 3).

**Last verified:** 2026-09-02 (against `skills/references-shared.md` §5, §11; endpoints 1-2
updated to match the `aggregation=event` / `aggregation=event_source&event=` fix in
commit `f7c6f47`, which the doc previously did not reflect)
