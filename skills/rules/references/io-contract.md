# /rules — I/O Contract

Full input/output contract for `node skills/rules/rules.js <slug> <mode> [args]`.
Readable standalone.

## CLI

```
node skills/rules/rules.js <slug> list
node skills/rules/rules.js <slug> install [--dry-run]
node skills/rules/rules.js <slug> preview <template>
node skills/rules/rules.js <slug> disable <name>
node skills/rules/rules.js <slug> enable  <name>
node skills/rules/rules.js <slug> history <name>
```

| Mode | Required arg | Side effect |
|---|---|---|
| `list` | — | none (read-only) |
| `install` | — (`--dry-run` optional) | writes `clients/{slug}/rules_log.json`; POSTs rules unless `--dry-run` |
| `preview` | `<template>` | none; rule must already be installed |
| `disable` | `<name>` | sets rule `status=DISABLED` |
| `enable` | `<name>` | sets rule `status=ENABLED` |
| `history` | `<name>` | writes `clients/{slug}/rule_history_<name>.json` |

## Inputs

- **Args:** `<slug> <mode> [template|name] [--dry-run]`.
- **File:** `clients/{slug}/client_profile.json` — reads `accounts.ad_account_id` and `kpis`.
- **Env:** `META_ACCESS_TOKEN` (required), `META_APP_SECRET` (optional, adds `appsecret_proof`).
  Loaded from `~/.config/smos/.env`, `$SMOS_ENV_FILE`, or repo `.env`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success (stdout JSON printed) |
| 1 | usage error, unknown mode/template, or mode threw (e.g. rule not found) |
| 2 | `client_profile.json` not found |
| 3 | `accounts.ad_account_id` is TBD |

## Outputs

### stdout (all modes)
```json
{ "slug": "blue-rose-auto", "mode": "list", "result": { /* mode-specific */ } }
```

### rules_log.json (install)
```json
{
  "slug": "blue-rose-auto",
  "installed": [
    { "name": "PAUSE_RUNAWAY_CPA", "rule_id": "120330000000123456" },
    { "name": "PAUSE_LOW_CTR_LIVE", "dry_run": true, "body": { "name": "...", "evaluation_spec": {} } }
  ],
  "skipped": [ { "name": "PAUSE_HIGH_FREQ", "reason": "already exists" } ],
  "errors":  [ { "name": "NOTIFY_ZERO_DELIVERY", "error": "Meta API 17: ..." } ],
  "dry_run": false
}
```
- `installed[]` carries `rule_id` on a real POST, or `{dry_run:true, body}` under `--dry-run`.
- `skipped[]` entries always have `reason: "already exists"` (idempotency).
- `errors[]` capture per-template failures without aborting the rest of the batch.

### Example create body (one template, pre-serialization)
```json
{
  "name": "PAUSE_RUNAWAY_CPA",
  "evaluation_spec": {
    "evaluation_type": "SCHEDULE",
    "filters": [
      { "field": "spent", "operator": "GREATER_THAN", "value": 5000 },
      { "field": "cost_per_action_type:offsite_conversion.fb_pixel_purchase", "operator": "GREATER_THAN", "value": 250 }
    ],
    "time_window": "LAST_3_DAYS"
  },
  "execution_spec": { "execution_type": "PAUSE", "execution_options": [] },
  "schedule_spec": { "schedule_type": "SEMI_HOURLY" },
  "entities": { "entity_type": "AD" }
}
```
Each nested object is JSON-stringified before the POST (form-encoded edge requirement).

### rule_history_<name>.json (history)
```json
{
  "data": [
    {
      "evaluation_type": "SCHEDULE",
      "results": [ { "object_id": "238...", "object_type": "AD" } ],
      "timestamp": "2026-06-21T02:30:00+0000",
      "object_count": 1,
      "action": "PAUSE",
      "error_code": null,
      "error_message": null
    }
  ],
  "paging": { "cursors": { "before": "...", "after": "..." } }
}
```

## Edge cases

| Case | Behavior |
|---|---|
| Rule already exists on `install` | Added to `skipped[]`; not re-created |
| `preview <template>` before install | Throws "not installed yet — run 'install' first" (exit 1) |
| `disable`/`enable`/`history` on missing name | Throws "Rule '<name>' not found" (exit 1) |
| Unknown template on `preview` | Throws with the list of valid template names (exit 1) |
| `kpis.cpa_target` absent | Defaults to 50 → runaway ceiling 250 |
| Transient Meta error | meta-graph retries with backoff; persistent error lands in `errors[]` (install) or throws (other modes) |
| Token expired | `TokenExpiredError` (non-retryable) propagates; re-auth required |

## Idempotency & re-runs

`install` is safe to re-run: the existing-name set guards against duplicates, so repeated
runs converge to exactly the 5-rule library. Use `--dry-run` first to inspect generated
bodies without touching the account.
