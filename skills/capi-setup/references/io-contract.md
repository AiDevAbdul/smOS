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

---

## `measurement_spine.json` (E4 — the shared spine)

Path: `clients/{slug}/data/measurement_spine.json` (via `paths.clientFile`, bucket `data/`).
Written by `/capi-setup`, read by `/attribution`. Append-only; the last 365 entries of each
list are kept.

```jsonc
{
  "version": 1,
  "slug": "acme",
  "updated_at": "2026-09-09T10:00:00.000Z",
  "emq_series": [
    {
      "captured_at": "2026-09-09T10:00:00.000Z",
      "pixel_id": "1234567890",
      "source": "dataset_quality_api",     // | "offline" | "unavailable" | "manual"
      "unavailable_reason": null,           // set when source != dataset_quality_api
      "events": [
        {
          "event_name": "Purchase",
          "composite_score": 7.4,           // null = Meta did not return it (UNKNOWN, not 0)
          "band": "good",                   // great ≥8 · good ≥6 · ok ≥4 · poor · null if unknown
          "match_keys": [
            { "identifier": "email", "coverage_pct": 92, "potential_increase": 1.2 },
            { "identifier": "phone_number", "coverage_pct": 18, "potential_increase": null }
          ],
          "match_keys_available": true
        }
      ],
      "dataset_avg_score": 7.4,             // average over SCORED events only; null if none
      "scored_events": 1,
      "unknown_events": 0
    }
  ],
  "reconciliations": [
    {
      "recorded_at": "2026-09-09T10:00:00.000Z",
      "recorded_by": "capi-setup",          // | "attribution"
      "event": "Lead",                      // null = account total
      "window": "last_7d",
      "platform_reported": { "value": 100, "source": "performance_analysis.json (…)", "basis": "platform_reported", "audited": false },
      "observed":          { "value": 80,  "source": "crm", "basis": "audited", "audited": true },
      "gap": -20,                           // observed − platform; null if either side unknown
      "gap_pct": -20,                       // null when the denominator is 0/unknown
      "coverage_ratio": 0.8,                // observed ÷ platform; null when no denominator
      "verdict": "platform_over_reported",  // aligned | platform_over_reported | platform_under_reported | unknown
      "notes": ["…why any field above is null / unaudited…"]
    }
  ]
}
```

### New `capi_report.json` fields

| Field | Meaning |
|---|---|
| `data_source` | `"meta_graph_v25"` or `"offline"` (nothing was verified) |
| `emq.captured` | Whether Meta actually returned EMQ this run |
| `emq.snapshot` | The snapshot appended to the series (shape above) |
| `emq.trends[]` | Per event: `current`, `current_band`, `previous`, `delta`, `direction` (`improving`/`declining`/`flat`/`null`), `best`, `worst`, `mean`, `samples`, `note` |
| `emq.appended_to_series` / `not_appended_reason` | `false` + `"duplicate_snapshot"` on an identical same-day re-run |
| `reconciliation` | The reconciliation record + `recorded` (false when no `--observed` was given) |
| `spine_path` | Absolute path to the spine |
| `supabase` | `{ persisted, reason }` — never claims a persist that did not happen |

### Spine edge cases

| Case | Behavior |
|------|----------|
| `SMOS_OFFLINE=1` / no token | Every event `status:"unknown"`; snapshot `source:"offline"`; EMQ gap = one "unknown" line, no per-event claims |
| `/dataset_quality` error / empty | Snapshot `source:"unavailable"` + `unavailable_reason`; scores stay `null` |
| Event returned without `composite_score` | `composite_score: null`, `band: null` — it is not a trend sample |
| Only one sample | `delta`/`direction` `null` with a "single sample" note |
| Platform-reported = 0 | `coverage_ratio`/`gap_pct` `null` + note "no denominator"; `verdict:"unknown"` |
| `--observed` omitted | No reconciliation appended (avoids a history of half-empty rows); report shows `recorded:false` |
| Corrupt spine file | `loadSpine` returns `corrupt: true` and an empty history; the run proceeds |
