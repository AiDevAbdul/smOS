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

### 1. Pixel stats (read) — overall counts

```
GET /{pixel_id}/stats?start_time=<unix -7d>
```
Returns recent event counts + last-fire times. Response shape varies by version; the skill
handles both `value`/`count` and `event`/`event_name` and `last_fire_time`/`last_fired_time`:

```json
{ "data": [ { "event": "Purchase", "value": 412, "last_fire_time": 1718900000 } ] }
```

### 2. Pixel stats (read) — source breakdown

```
GET /{pixel_id}/stats?start_time=<unix -7d>&aggregation=event_name_and_method
```
Same row shape plus a `method` (or `source`) field ∈ `{ browser, server, s2s, app }`.
`server`/`s2s` → server bucket; `app` → app bucket; everything else → browser bucket.

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

**Last verified:** 2026-06-22 (against `skills/references-shared.md` §5, §11)
