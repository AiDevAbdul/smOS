# creative-intel — I/O Contract

Full input/output contract: CLI surface, env, the `creative_intel.json` schema, the stdout
summary schema, exit codes, example payloads, and edge-case handling. Self-contained.

## CLI

```
node skills/creative-intel/creative-intel.js <slug> [--window <int>]
```

| Token | Required | Default | Notes |
|-------|----------|---------|-------|
| `<slug>` | yes | — | First positional arg; maps to `clients/<slug>/client_profile.json` |
| `--window <int>` | no | `30` | Window length in days; flows into `date_preset=last_<int>d` |

## Environment

| Var | Required | Purpose |
|-----|----------|---------|
| `META_ACCESS_TOKEN` | yes | Graph API auth (loaded by `load-env.js`) |
| `META_APP_SECRET` | no | Enables `appsecret_proof` signing |

## Input file: `clients/<slug>/client_profile.json`

Only `accounts.ad_account_id` is read:

```json
{ "accounts": { "ad_account_id": "act_1234567890" } }
```

`isTbd` treats `null`, `""`, or any value starting with `TBD` (case-insensitive) as unset → exit 3.
The `act_` prefix is added/normalized by `graph.act()`.

## Output file: `clients/<slug>/creative_intel.json`

```json
{
  "slug": "acme",
  "generated_at": "2026-06-22T14:05:00.000Z",
  "window_days": 30,
  "ad_account_id": "act_1234567890",
  "ads_analyzed": 42,
  "ads_flagged": 7,
  "by_ad": [
    {
      "id": "120000000001",
      "name": "IMG_PAIN_v1",
      "status": "ACTIVE",
      "campaign_id": "120000000900",
      "adset_id": "120000000500",
      "creative_id": "230000000777",
      "days_active": 21,
      "ctr_30d_avg": 0.012,
      "ctr_7d_avg": 0.0078,
      "ctr_delta": -0.35,
      "frequency_7d": 4.6,
      "spend_7d": 420.0,
      "consecutive_ctr_decline_days": 4,
      "flag": "FATIGUE_HIGH",
      "refresh_priority_score": 567.0
    }
  ],
  "refresh_queue": [
    {
      "id": "120000000001",
      "name": "IMG_PAIN_v1",
      "campaign_id": "120000000900",
      "adset_id": "120000000500",
      "creative_id": "230000000777",
      "spend_7d": 420.0,
      "frequency_7d": 4.6,
      "ctr_7d_avg": 0.0078,
      "ctr_30d_avg": 0.012,
      "ctr_delta": -0.35,
      "flag": "FATIGUE_HIGH",
      "refresh_priority_score": 567.0
    }
  ],
  "flag_counts": { "FATIGUE_HIGH": 1, "FATIGUE_MEDIUM": 2, "HEALTHY": 30, "INSUFFICIENT_DATA": 9 }
}
```

### Field notes
- `by_ad` holds **every** analyzed ad (including `HEALTHY`, `INSUFFICIENT_DATA`, and `ERROR`).
- `refresh_queue` is the top ≤10 flagged ads, sorted descending by `refresh_priority_score`.
- Rounding: CTRs to 5 dp, `ctr_delta` to 4 dp, `frequency_7d` to 3 dp, `spend_7d`/score to 2 dp.
- Non-finite or null-baseline values round to `null` (e.g. `ctr_delta` when `ctr_30d_avg == 0`).
- `flag_counts` keys are whatever flags occurred this run (sparse, not a fixed enum set).

## Stdout summary (one line, machine-readable)

```json
{
  "slug": "acme",
  "ads_analyzed": 42,
  "ads_flagged": 7,
  "flag_counts": { "FATIGUE_HIGH": 1, "FATIGUE_MEDIUM": 2 },
  "top_refresh": { "id": "120000000001", "name": "IMG_PAIN_v1", "score": 567.0 },
  "path": "/abs/clients/acme/creative_intel.json",
  "next": "feed refresh_queue into /creative"
}
```

- `top_refresh` is `null` when nothing is flagged.
- `next` is `"feed refresh_queue into /creative"` when the queue is non-empty, else `"no fatigue detected"`.
- All progress logs and halt messages go to **stderr**; stdout carries only this JSON object.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success — file written, summary printed |
| 1 | Missing `<slug>` arg (usage), or uncaught FATAL |
| 2 | `client_profile.json` not found |
| 3 | `ad_account_id` is TBD/empty |
| 4 | Meta throttle (codes 4/17/613) surfaced after backoff — halted, not retried |

## Edge cases

| Case | Behavior |
|------|----------|
| Ad with no impressions in window | `status: "no_data"`, `flag: "ERROR"` bucket, excluded from `ads_flagged` |
| Ad with <7 daily rows | `status: "insufficient_data"`, `flag: "INSUFFICIENT_DATA"`, `score: 0` |
| Per-ad non-throttle insights error | `status: "error"`, `flag: "ERROR"`, run continues for other ads |
| `ctr_30d_avg == 0` (no baseline) | `ctr_delta: null`; ad cannot match a CTR-decay rule (may still match `BURNOUT_SOON`) |
| `filtering` clause rejected by Meta | Fall back to all non-archived ads, then filter via per-ad data |
| Throttle mid-run | Halt entire run (exit 4) — never emit a partial "no fatigue" result |
| No ads in account | `ads_analyzed: 0`, empty `refresh_queue`, `next: "no fatigue detected"` |

**Last verified:** 2026-06-22 (against `creative-intel.js`).
