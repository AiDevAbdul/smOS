# /analyze — I/O Contract

Complete input/output contract for `skills/analyze/analyze.js`: CLI, files read,
files written, the full `performance_analysis.json` schema, the stdout summary, the
Supabase `daily_metrics` rows, and edge-case behavior. Reflects the code exactly.

---

## CLI

```bash
node skills/analyze/analyze.js <client_slug> [--no-breakdowns]
```

| Arg | Required | Effect |
|-----|----------|--------|
| `<client_slug>` | yes | positional; selects `clients/<slug>/` |
| `--no-breakdowns` | no | skip placement/age-gender/device segmentation (faster, less quota) |

### Exit codes
| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | missing slug, or uncaught fatal error |
| 2 | `clients/<slug>/client_profile.json` not found |
| 3 | `accounts.ad_account_id` is TBD (run `/setup-accounts`) |

---

## Inputs

- **File:** `clients/<slug>/client_profile.json` — reads `accounts.ad_account_id`,
  `accounts.currency`, `kpis`, `name`.
- **Env:** Meta credentials (`META_*`) loaded via `load-env.js`; optional
  `SUPABASE_*` enabling best-effort `daily_metrics` persistence.

---

## Outputs

| Output | Path / target |
|--------|---------------|
| Primary JSON | `clients/<slug>/performance_analysis.json` |
| Summary markdown | `clients/<slug>/performance_analysis.md` |
| Summary HTML + PDF | written alongside the markdown by `md_to_html.js` (PDF skipped if Playwright missing) |
| Supabase rows | `daily_metrics` (per-day, per-campaign), best-effort, no-op without env |
| stdout | one-line pretty JSON summary (below) |
| stderr | progress logs (`[analyze] …`) |

---

## `performance_analysis.json` schema

```jsonc
{
  "slug": "string",
  "generated_at": "ISO-8601",
  "ad_account_id": "act_…",
  "currency": "string|null",
  "kpis_used": { /* normalized KPIs (see domain-standards.md §2) */ },
  "window_summary": {
    "last_7d_totals": {
      "spend": 0, "impressions": 0, "clicks": 0,
      "conversions": 0, "conversion_value": 0,
      "cpa": 0.0, "roas": 0.0
    }
  },
  "by_campaign": [
    { "id": "", "name": "", "status": "", "objective": "",
      "daily_budget": 0.0,
      "metrics": { "last_7d": { /* deriveMetrics */ }, "last_14d": {…}, "last_30d": {…} } }
  ],
  "by_adset": [
    { "id": "", "name": "", "status": "", "campaign_id": "",
      "daily_budget": 0.0,
      "metrics": { "last_7d": {…}, "last_14d": {…}, "last_30d": {…} },
      "breakdowns": {
        "placement":  [ { "publisher_platform": "", "platform_position": "", /* metrics */ } ],
        "age_gender": [ { "age": "", "gender": "", /* metrics */ } ],
        "device":     [ { "device_platform": "", /* metrics */ } ]
      } /* or null when paused or --no-breakdowns; a dimension may be {error} */ }
  ],
  "by_ad": [
    { "id": "", "name": "", "status": "", "adset_id": "", "campaign_id": "",
      "metrics": { "last_7d": {…}, "last_30d": {…}, "last_14d": {…} } }
  ],
  "flags": [
    { "entity_type": "ad|adset", "entity_id": "", "name": "",
      "campaign_id": "", "adset_id": "",
      "flag": "PAUSE_CANDIDATE_CPA|…|SCALE_CANDIDATE|SCALE_WATCH|CREATIVE_FATIGUE|ANOMALY_*",
      "metric": 0, "threshold": 0,
      "significance": { /* present on gated flags */ },
      "reasoning": "human-readable one-liner" }
  ],
  "opportunity": {
    "score": 0,
    "components": {
      "scale":   { "weight": 0.45, "ratio": 0.0, "points": 0.0 },
      "reclaim": { "weight": 0.35, "ratio": 0.0, "points": 0.0 },
      "refresh": { "weight": 0.20, "ratio": 0.0, "points": 0.0 }
    },
    "total_spend_7d": 0.0,
    "reclaimable_spend_7d": 0.0,
    "scalable_spend_7d": 0.0,
    "fatigued_spend_7d": 0.0,
    "recommendations": ["string"]
  },
  "winners": {
    "top_roas":   [ { "id": "", "name": "", "spend": 0, "roas": 0, "cpa": 0, "ctr": 0 } ],
    "lowest_cpa": [ /* same shape */ ]
  },
  "losers": { "bottom_roas": [ /* same shape */ ] },
  "segment_highlights": [
    { "adset_id": "", "adset_name": "", "dimension": "placement|age_gender|device",
      "top_segment": { /* the winning segment row */ },
      "conversion_share": 0.0,
      "recommendation": "Concentrate spend — …" }
  ]
}
```

A per-window `metrics` object is the `deriveMetrics` shape (see
`domain-standards.md §1`). A failed window is `{ "error": "message" }`.

---

## stdout one-line summary

```json
{
  "slug": "acme",
  "ads": 0, "adsets": 0, "campaigns": 0,
  "flags": 0,
  "flag_counts": { "PAUSE_CANDIDATE_CPA": 0 },
  "opportunity_score": 0,
  "winners": 0, "losers": 0,
  "path": "clients/acme/performance_analysis.json",
  "next": "run /scale to execute pause/scale recommendations"
}
```

---

## Supabase `daily_metrics` rows (best-effort)

Written only when `supabaseConfigured()`; failures are caught and logged, never
fatal. Per campaign, per day (re-pulled with `time_increment=1`):

```jsonc
{
  "client_id": "uuid (clientIdBySlug)",
  "campaign_id": "", "date": "YYYY-MM-DD",
  "spend": 0, "impressions": 0, "clicks": 0, "ctr": 0,
  "cpc": 0, "cpm": 0, "conversions": 0, "cpa": 0, "roas": 0,
  "frequency": 0, "reach": 0, "raw_actions": []
}
```

Purpose: give `/scale`'s 3-consecutive-day ROAS rule real daily history without
re-hitting Meta.

---

## Edge cases

| Case | Behavior |
|------|----------|
| Zero campaigns returned | Empty arrays; opportunity score 0; "no opportunity" recommendation |
| One entity's insight call errors | That window stored as `{error}`; run continues |
| Paused adset | No breakdowns pulled (`breakdowns: null`) |
| `--no-breakdowns` set | All adset breakdowns `null`; no segment highlights |
| No conversions on an entity | `cpa` and `roas` are `null`; excluded from ROAS/CPA ranks |
| ROAS=0 + healthy link clicks | `ANOMALY_attribution`, not a PAUSE flag |
| Total spend = 0 | Opportunity ratios 0 → score 0 (no NaN) |
| Supabase env absent | Persistence skipped silently; JSON is authoritative |
| Playwright absent | HTML written, PDF skipped with note |
