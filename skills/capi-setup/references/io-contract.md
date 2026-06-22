# capi-setup — I/O Contract

Full input/output contract for `skills/capi-setup/capi-setup.js`. Self-contained: CLI shape,
JSON schemas, example payloads, and edge-case handling.

## CLI contract

```
node skills/capi-setup/capi-setup.js <slug> [--test-event TEST<code>]
```

| Arg / flag | Required | Meaning |
|------------|----------|---------|
| `<slug>` (positional) | yes | client directory under `clients/` |
| `--test-event TEST<code>` | no | fire one test-coded synthetic `Lead` event; `TEST<code>` from Events Manager → Test Events |

**Exit codes:** `0` success · `1` missing slug or fatal error · `2` profile not found · `3` `pixel_id` missing/TBD.

## Inputs

**Env** (via `scripts/lib/load-env.js`): `META_ACCESS_TOKEN` (required, scopes `ads_management` +
`business_management`); `META_APP_SECRET` (optional, enables `appsecret_proof`).

**Profile** `clients/{slug}/client_profile.json` (only these fields are read):
```json
{
  "accounts": { "pixel_id": "123456789012345", "ad_account_id": "act_..." },
  "business": { "conversion_events": ["ViewContent", "AddToCart", "Purchase", "Lead"] }
}
```
`business.conversion_events` is optional — omitted/empty falls back to the default list
(see `domain-standards.md`).

## Outputs

### stdout — one-line summary (JSON)
```json
{
  "slug": "acme",
  "pixel": { "firing": 2, "partial": 1, "missing": 1, "stale": 0, "never_fired": 0 },
  "gaps_count": 2,
  "test_event_fired": false,
  "path": "/abs/clients/acme/capi_report.json",
  "next": "share capi_report.json with the dev to close the gaps"
}
```
(`pixel.firing` reflects count of `healthy` events. `next` is the healthy message only when `gaps_count` is 0.)

### File — `clients/{slug}/capi_report.json`

```jsonc
{
  "slug": "acme",
  "generated_at": "2026-06-22T10:00:00.000Z",   // ISO 8601 UTC
  "pixel_id": "123456789012345",
  "events": [
    {
      "name": "Purchase",
      "firing": true,            // bool — any count in window
      "count_7d": 412,           // total events (all sources)
      "last_fired": 1718900000,  // unix seconds | null
      "client_count_7d": 412,    // browser bucket
      "server_count_7d": 398,    // server + s2s bucket
      "server_share": 0.491,     // server / (browser+server), 3dp
      "status": "healthy"        // healthy|partial|missing|stale|never_fired
    }
  ],
  "dataset": {                   // dataset node fields, OR { "error": "..." }
    "id": "123456789012345",
    "name": "Acme Pixel",
    "last_fired_time": 1718900000,
    "enable_automatic_matching": true,
    "automatic_matching_fields": ["em", "ph"],
    "first_party_cookie_status": "FIRST_PARTY_COOKIE_ENABLED",
    "creation_time": "2024-01-01T00:00:00+0000"
  },
  "test_event": {                // see variants below
    "fired": false,
    "event_id": null
  },
  "gaps": [
    "'AddToCart' server_share is 11% — CAPI fires for some traffic only; cover all paths"
  ],
  "next_steps": [
    "Send the same event_id from pixel + CAPI for each event to enable deduplication (Meta will dedupe automatically)",
    "Re-run /capi-setup in 48h to verify the changes"
  ]
}
```

### `test_event` variants

```jsonc
{ "fired": false, "event_id": null }                              // not requested
{ "fired": true, "event_id": "capi-test-1718900000-a1b2c3",
  "response": { "events_received": 1, "fbtrace_id": "..." } }     // success
{ "fired": false, "error": "Meta API 100: ..." }                  // fire attempted, failed
```

## Edge cases

| Case | Behavior |
|------|----------|
| `business.conversion_events` empty/absent | Use default 6-event list |
| `/stats` empty or errored | Every event → `never_fired`; report still written |
| Source breakdown errored | `server_count_7d=0` → events with counts but no source resolve to `missing` |
| Dataset fetch errored | `dataset: { error }`; no automatic-matching gap added |
| All events `healthy` | `gaps: []`; `next_steps` still includes the 48h re-run line; summary `next` = healthy message |
| `--test-event` without a code value | `testEventCode` is undefined → no fire (treated as not requested) |
| Profile present but `pixel_id` is `"TBD..."` | Halt, exit 3 — `isTbd()` matches `null`/empty/`/^TBD/i` |

## Downstream consumers

- The dev/client closes the listed `gaps`, then a re-run confirms `healthy`.
- `/launch` should not start a conversion-objective campaign while the primary conversion event
  is `never_fired` or `missing` — the report is the gate.
