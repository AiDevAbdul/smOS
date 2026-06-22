# strategy-brief — I/O Contract

Full input/output schemas, example payloads, exit codes, and edge-case handling. This skill
makes NO external API calls — all contracts are local JSON artifacts validated through
`schemas/*.js`. Readable independently of the SKILL.md.

---

## Invocation

```
node skills/strategy-brief/strategy-brief.js <client_slug>
```

| Exit | Meaning |
|------|---------|
| 0 | Brief written; one-line JSON summary on stdout |
| 1 | No slug arg (usage printed) OR fatal error (message on stderr) |
| 2 | `client_profile.json` not found |
| 3 | `competitor_intel.json` and/or `audience_map.json` missing (names which) |

Progress + file-write lines go to **stderr** (`[strategy-brief] …`); only the final summary
goes to **stdout** so callers can parse it cleanly.

---

## Inputs

### `client_profile.json` (REQUIRED) — fields read

```jsonc
{
  "name": "Acme Auto Detailing",
  "business": { "conversion_events": ["Purchase", "Lead"] },
  "kpis": {
    "monthly_budget_low": 6000,        // → daily_total; falls back to monthly_budget, then 3000
    "cpa_target": 60,                  // warm CPA derives as 0.6×; reconciled vs audit
    "cold_ctr_target": 0.012, "cold_cpm_ceiling": 28,
    "cold_roas_target": 1.6, "warm_roas_target": 3.2,
    "pause_cpa_multiplier": 3, "pause_ctr_floor": 0.005, "pause_frequency_ceiling": 4
  },
  "voice": { "restricted_words": ["cheap", "guaranteed"] }  // or voice.avoid
}
```

### `competitor_intel.json` (REQUIRED) — produced by `/research`

Normalized by `schemas/competitor_intel.js`. The brief reads `.angles` (each: `angle`,
`frequency`, `fit_for_client`, `use_for[]`, `notes`) and `format_mix.winning_format_signal`.
`angles` MAY be empty (degraded-but-valid) — angle selection then yields fewer buckets.

```jsonc
{
  "angles": [
    { "angle": "Warranty-backed repairs", "frequency": "rare",
      "fit_for_client": "high", "use_for": ["repair"], "notes": "no competitor leads with this" }
  ],
  "format_mix": { "winning_format_signal": "short video" }
}
```

### `audience_map.json` (REQUIRED) — produced by `/audience-map`

Normalized by `schemas/audience_map.js`. The brief reads `clusters[]` (with `id`, `label`,
`size_estimate`), `retargeting_layers[]`, and `lookalike`/`lookalikes`.

```jsonc
{
  "clusters": [
    { "id": "INT_DETAIL", "label": "Car detailing enthusiasts", "size_estimate": "500k-2M",
      "interest_stack": ["Car detailing", "Auto care"] }
  ],
  "retargeting_layers": [ { "id": "RT_PIX_30D", "label": "Site visitors 30d" } ],
  "lookalike": { "id": "LAL_1PCT", "label": "LAL 1% from purchasers" }
}
```

### `audit_raw.json` (OPTIONAL)

When absent, the brief runs with profile-only assumptions (recorded in `assumptions`) and the
objective tree takes the conservative cold-start branch. Fields read:

```jsonc
{ "paid": { "pixel_health": "full", "best_roas": 2.4, "best_cpa": 48 } }
```

---

## Output — `strategy_brief.json`

```jsonc
{
  "slug": "acme-auto",
  "generated_at": "2026-06-22T14:00:00.000Z",
  "inputs_used": { "profile": true, "audit": false, "competitor_intel": true, "audience_map": true },
  "objective_hierarchy": [
    { "phase": "A", "start_day": 0,  "objective": "OUTCOME_LEADS", "reason": "pixel learning — start lighter-funnel" },
    { "phase": "B", "start_day": 14, "objective": "OUTCOME_SALES", "reason": "promote once pixel has signal" },
    { "phase": "C", "start_day": 21, "objective": "OUTCOME_SALES", "reason": "scale into lookalike + second cluster" }
  ],
  "budget_allocation": {
    "monthly_budget": 6000,
    "daily_total": 200,
    "split": { "cold_pct": 0.6, "warm_pct": 0.25, "lal_pct": 0.15 },
    "adsets": [
      { "audience_id": "BROAD", "audience_label": "BROAD", "role": "cold", "daily_budget": 60, "needs_approval": false },
      { "audience_id": "INT_DETAIL", "audience_label": "Car detailing enthusiasts", "role": "cold", "daily_budget": 60, "needs_approval": false },
      { "audience_id": "RT_PIX_30D", "audience_label": "Site visitors 30d", "role": "warm", "daily_budget": 50, "needs_approval": false },
      { "audience_id": "LAL_1PCT", "audience_label": "LAL 1%", "role": "lal", "daily_budget": 30, "needs_approval": false }
    ]
  },
  "audience_priority": [
    { "priority": 1, "id": "BROAD", "source": "broad", "reason": "no-interest baseline" },
    { "priority": 2, "id": "INT_DETAIL", "source": "interest_cluster", "label": "Car detailing enthusiasts", "size_estimate": "500k-2M" }
  ],
  "creative_angles": [
    { "angle_id": "PAIN", "name": "PAIN", "angle": "Swirl marks ruin resale value",
      "hook_archetype": "Problem-led question", "format": "single_image", "prompt": "Lead with the pain in '…'." }
  ],
  "success_metrics": {
    "cold": { "ctr_target": 0.012, "cpm_ceiling": 28, "cpa_target": 60, "roas_target": 1.6 },
    "warm": { "cpa_target": 36, "roas_target": 3.2 },
    "scale_gate": { "rule": "3 consecutive days ROAS > target before any budget increase", "consecutive_days": 3, "target_metric": "roas" },
    "pause_floors": { "cpa_multiplier": 3, "ctr_floor": 0.005, "frequency_ceiling": 4 }
  },
  "calendar": [ { "week": 1, "actions": ["Launch Phase A — OUTCOME_LEADS", "3 creatives × 2 audiences", "Daily monitoring; no scaling decisions"] } ],
  "assumptions": ["No audit_raw.json found — running with profile-only assumptions; audit signals not factored in."],
  "excluded_angles": ["'Cheapest detailing in town' — contains restricted word 'cheap'"],
  "approval": { "status": "pending", "approved_by": null, "approved_at": null, "discord_message_id": null }
}
```

### Validation (fail-closed)

Before writing, the script calls `assertValid("strategy_brief", briefSchema.normalize(brief), briefSchema.validate)`.
The validator (`schemas/strategy_brief.js`) requires:
- `creative_angles` is a **non-empty** array.
- every angle has a non-empty, **unique** `angle_id` (the join key for `/creative` + `/launch`).
- every angle has a non-empty `name`.

A failure throws `SchemaError` naming the offending field; the brief is NOT written.

---

## Output — `strategy_brief.md`

Rendered from the JSON by `renderMarkdown()`. Sections: title + budget header, objective
hierarchy, budget table (with the ⚠️ approval column), audience priority, the three creative
angles, success metrics, the 30-day calendar, assumptions, excluded angles. It opens with the
approval prompt line. **Never edit the `.md` independently of the `.json`** — regenerate.

---

## Output — stdout summary

```json
{ "slug": "acme-auto", "daily_total": 200, "phases": 3, "audiences": 2,
  "creative_angles": 1, "adsets_needing_approval": 0, "assumptions": 1,
  "json": ".../strategy_brief.json", "md": ".../strategy_brief.md",
  "next": "post strategy_brief.md to Discord for approval, then run /creative" }
```

---

## Edge cases

| Case | Behavior |
|------|----------|
| `competitor_intel.angles` empty | Fewer (or zero) buckets fill; if the result has no angles the brief fails validation — re-run `/research` |
| No retargeting layers / no lookalike in map | Those adset roles are simply absent; split still computes over present roles |
| `monthly_budget_low` absent | Falls back to `monthly_budget`, then `3000` |
| Size estimate unparseable | Cluster sorts as size 0 (ends up last) |
| Restricted word also a strong angle | Score −5 drops it from `creative_angles`; it appears in `excluded_angles` |
| Re-run after edits | Deterministic — same inputs produce the same brief (only `generated_at` changes); `approval` resets to `pending` until re-approved |
| Upstream artifact present but unparseable | `loadJsonIfExists` does `JSON.parse` with no try/catch — a malformed `competitor_intel.json` / `audience_map.json` / `audit_raw.json` throws `SyntaxError`, caught by `main().catch`, printed as `[strategy-brief] FATAL: …`, exit 1. Fix the upstream file via its producing skill; do NOT hand-patch it to parse. |
| Upstream artifact parses but is structurally invalid | `normalize()` is lenient and never throws on a wrong shape — it coerces aliases and defaults missing fields. A `competitor_intel.json` with `angles` of the wrong type, or an `audience_map.json` with no usable clusters, yields empty/degraded downstream sections (no buckets, no cold interest adsets). If that leaves `creative_angles` empty, the final `assertValid` fails and the brief is not written — re-run `/research` / `/audience-map` to repair the source rather than editing the brief. Note this skill does NOT call the inputs' own `validate()` (only the brief's), so an upstream shape can pass `normalize` yet still under-fill the brief; inspect the stdout counts (`creative_angles`, `audiences`) as a sanity check. |
