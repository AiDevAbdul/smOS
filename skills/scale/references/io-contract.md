# /scale — I/O Contract

Full input/output schemas, CLI surface, exit codes, example payloads, and edge-case
handling. Read independently of SKILL.md.

---

## 1. CLI

```
node skills/scale/scale.js <slug> [--execute] [--force] [--rollback [log]]
```

| Arg | Meaning |
|---|---|
| `<slug>` | Required client slug. Missing → usage + exit 1. |
| `--execute` | Send writes to Meta. Without it, DRY-RUN (compute + log only). |
| `--force` | Override the freshness, business-hours, and circuit-breaker gates. Surfaces the override. |
| `--rollback [log]` | Reverse a prior run. Optional path to a `scaling_log.json` (default `clients/<slug>/scaling_log.json`). Dry-run unless paired with `--execute`. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (dry-run or execute) |
| 1 | Missing slug / fatal error |
| 2 | `client_profile.json` not found |
| 3 | `performance_analysis.json` not found |
| 4 | Analysis > 4h old (no `--force`) |
| 5 | Outside business hours / unknown tz (no `--force`) |
| 6 | Circuit breaker tripped (no `--force`) |
| 7 | `--rollback` log not found |

stdout = single JSON summary object. stderr = progress logs (`[scale] ...`) and the path written.

---

## 2. Input — `performance_analysis.json` (from `/analyze`)

Consumed fields (other fields ignored):

```jsonc
{
  "generated_at": "2026-06-22T14:00:00Z",   // ISO; freshness checked (≤ 4h)
  "by_campaign": [ { "id": "23851...", "name": "CONV_LAL1PCT_202506", "spend": 812.4, "impressions": 130200 } ],
  "by_adset":    [ { "id": "23861...", "name": "FEED_2545_FITNESS", "spend": 240.0, "impressions": 41000, "daily_budget": 200.0 } ],
  "by_ad":       [ { "id": "23871...", "name": "IMG_PAIN_v1", "spend": 60.0, "impressions": 8200 } ],
  "flags": [
    {
      "flag": "SCALE_CANDIDATE",
      "entity_id": "23861...",
      "entity_type": "adset",
      "name": "FEED_2545_FITNESS",
      "metric": 4.2,
      "threshold": 3.0,
      "reasoning": "ROAS 4.2 for 4 consecutive days",
      "significance": { "significant": true, "note": "n=28 conversions" }
    }
  ]
}
```

Field notes:
- `by_adset[].daily_budget` is **dollars** in the analysis; converted to cents internally (`× 100`). Null → cannot scale/clone (likely CBO) → flag-only.
- `flags[].significance` is optional; `{ significant: false, note }` forces a `SCALE_CANDIDATE` to flag-only.
- Entity lookups for the metric-sanity gate use `by_ad`/`by_adset` maps keyed by `id`. An entity absent from the rollup is trusted (cannot second-guess the analyzer) and is **not** downgraded.

---

## 3. Input — `client_profile.json`

Consumed fields:

```jsonc
{
  "accounts": {
    "ad_account_id": "act_1234567890",   // required for duplicate; missing/TBD → clone fails gracefully
    "timezone": "America/Chicago"         // business-hours check; falls back to location.timezone
  },
  "kpis": { "scale_min_conversions": 15 } // overrideable in client CLAUDE.md
}
```

---

## 4. Output — `clients/<slug>/scaling_log.json`

```jsonc
{
  "slug": "acme",
  "generated_at": "2026-06-22T14:05:00Z",
  "analysis_generated_at": "2026-06-22T14:00:00Z",
  "summary": {
    "auto_paused": 2,
    "auto_scaled": 1,
    "auto_duplicated": 1,
    "awaiting_approval": 1,
    "flagged": 3,
    "errors": 0,
    "dry_run": false,
    "business_hours_ok": true,
    "analysis_age_hours": 0.08
  },
  "decisions": [
    {
      "action": "scale", "entity_type": "adset",
      "endpoint": "/23861...", "body": { "daily_budget": "24000" },
      "budget_before_cents": 20000, "budget_after_cents": 24000, "delta_cents": 4000,
      "auto": true, "flag": "SCALE_CANDIDATE",
      "entity_id": "23861...", "entity_name": "FEED_2545_FITNESS",
      "reasoning": "ROAS 4.2 for 4 consecutive days", "metric": 4.2, "threshold": 3.0,
      "executed_at": "2026-06-22T14:05:00Z",
      "status": "applied",          // dry_run | applied | error | awaiting_approval | flagged
      "error": null, "meta_response": { "success": true },
      "created_id": null, "created_name": null
    },
    {
      "action": "duplicate", "entity_type": "adset", "source_id": "23861...",
      "budget_before_cents": 20000, "budget_after_cents": 10000, "auto": true,
      "status": "applied", "created_id": "23899...", "created_name": "FEED_2545_FITNESS_v2"
    },
    {
      "action": "pause", "entity_type": "ad", "auto": false,
      "reason": "metrics missing/zero — refusing auto-pause (bad-data guard)",
      "status": "flagged", "entity_id": "23871...", "entity_name": "IMG_PAIN_v1"
    }
  ]
}
```

`status` values: `dry_run` (computed, not sent), `applied` (sent at `--execute`),
`error` (call failed; carries `error` + `meta`), `awaiting_approval` (over-ceiling /
non-auto actionable), `flagged` (flag-only / downgraded).

---

## 5. Output — Supabase `optimizer_log` (best-effort, one row per run)

```jsonc
{
  "client_id": "<uuid from clientIdBySlug(slug)>",
  "run_date": "2026-06-22",
  "actions_taken": [ { "type": "scale", "entity_id": "23861...", "reason": null, "before": 20000, "after": 24000, "status": "applied" } ],
  "flags_raised":  [ { "type": "pause", "entity_id": "23871...", "reason": "metrics missing/zero ...", "status": "flagged" } ],
  "digest_sent": false
}
```

Skipped silently (logged to stderr) when `supabaseConfigured()` is false or the insert errors. `scaling_log.json` is always written regardless.

---

## 6. Output — stdout summary

```jsonc
{ "slug": "acme", "mode": "DRY_RUN", "auto_paused": 2, "auto_scaled": 1,
  "auto_duplicated": 1, "awaiting_approval": 1, "flagged": 3, "errors": 0,
  "dry_run": true, "business_hours_ok": true, "analysis_age_hours": 0.08,
  "path": "clients/acme/scaling_log.json",
  "next": "rerun with --execute to apply auto actions" }
```

---

## 7. Edge cases

| Case | Handling |
|---|---|
| Analysis has no `flags` | `flags: []` → all-zero summary, empty `decisions`, exit 0 |
| Adset has no `daily_budget` (CBO) | scale/duplicate → flag-only with `no daily_budget` reason |
| `ad_account_id` missing/TBD at `--execute` | duplicate decision records error `accounts.ad_account_id missing/TBD — cannot clone adset`; other actions proceed |
| Same entity multiple flags | grouped by `entity_id`; highest-priority action kept (pause > scale = duplicate > flag) |
| Implausible metrics (`spend ≤ 0` or `impressions < 100`) | pause/scale/duplicate downgraded to flag-only (bad-data guard) |
| Insignificant `SCALE_CANDIDATE` | downgraded to flag-only (significance defense-in-depth) |
| Over-ceiling scale (delta > $500/day) | `auto: false`, `awaiting_approval`, with `approval_reason` |
| Mass auto-actions (> 25 abs or > 50% active) at `--execute` | circuit breaker, exit 6 (no `--force`) |
| Single write fails mid-run | that decision = `error`, run continues |
| Rollback with no `applied` actions | prints `reversed: 0`, exit 0 |

**Last verified:** 2026-06-22
