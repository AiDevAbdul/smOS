---
name: monthly-review
description: Use this skill when the user asks for a monthly review, monthly recap, or end-of-month strategy reset (typically via `/monthly-review {slug}` or invoked by the auditor agent on schedule). Performs trend analysis on 30 days of metrics, audience fatigue + creative lifecycle, segment ranking, budget efficiency, competitive refresh, and strategy for the month ahead.
---

# /monthly-review — Monthly Strategic Review

## Required Context

- `clients/{slug}/client_profile.json` + `CLAUDE.md`
- `clients/{slug}/baseline_snapshot.json`
- Supabase `daily_metrics` (last 60 days for trend), `optimizer_log` (last 30d)
- `clients/{slug}/competitor_intel.json` (refresh from `/research` if older than 14 days)
- `clients/{slug}/audience_map.json`
- `templates/weekly-report.md` (extended sections reused)

## Workflow

### Pass 1 — Trend analysis

From `daily_metrics`, plot day-by-day for the last 30 days:
- Spend, conversions, ROAS, CPA, CTR, frequency, CPM
- 7-day moving averages overlaid

Identify trend direction per metric (improving / flat / declining) using linear regression slope sign over the 30 days.

### Pass 2 — Audience fatigue

For every active adset, examine the frequency curve over 30 days:
- Frequency rising AND CTR falling = fatigue confirmed
- Frequency > 4.0 sustained = saturation reached

Flag adsets needing audience refresh or expansion.

### Pass 3 — Creative lifecycle

For each ad with ≥ 14 days of delivery:
- Find peak CTR day
- Days since peak
- Current CTR as % of peak CTR
- Classify: `ramping` (< 7d), `peak` (within 80% of peak, < 14d since), `declining` (60–80% of peak), `expired` (< 60% of peak)

Recommend refresh on `declining` + `expired`.

### Pass 4 — Audience ranking

Aggregate `daily_metrics` by adset → rank by ROAS and by CPA. Pair with `audience_map.json` to label each adset with its targeting cluster. Output a ranked table — which clusters are paying off, which to cut.

### Pass 5 — Budget efficiency

CPM × CTR × CVR funnel by:
- Placement (Feed / Stories / Reels / IG Feed / IG Reels)
- Audience cluster
- Creative format (IMG / VID / CAR)

Identify the single placement-audience-creative combination with the best efficiency and recommend reallocating budget toward it.

### Pass 6 — Competitive refresh

If `competitor_intel.json` is older than 14 days, invoke `/research` first. Diff against the prior snapshot:
- New competitor ads launched
- Angles / hooks competitors have leaned into
- Whitespace still uncovered

### Pass 7 — Strategy recommendations

Synthesize Passes 1–6 into 5 concrete actions for the month ahead. Each action gets: rationale, expected impact, budget implication, owner (human or agent).

Write `clients/{slug}/strategy_recommendations.json`:
```json
{
  "month": "2026-06",
  "recommendations": [
    { "id": 1, "action": "...", "rationale": "...", "impact": "...", "budget_delta": 0, "owner": "human|optimizer|creative" }
  ]
}
```

### Pass 8 — Render + distribute

- Render `clients/{slug}/reports/{YYYY-MM}_monthly_review.md` with all sections + updated before/after table (call `/before-after` internally for the comparison block)
- Generate PDF
- Upload to Drive, post Slack, send Gmail (same distribution as `/report`)
- Insert into Supabase `reports`: `type: 'monthly_review'`

## Output

- `clients/{slug}/reports/{YYYY-MM}_monthly_review.md` + `.pdf`
- `clients/{slug}/strategy_recommendations.json`
- Row in Supabase `reports`

## Error Handling

- Missing competitor intel + research fails → render review without competitive section, note in Slack
- < 30 days of data → render with all available days and flag at top "Partial month — only N days of data"

## Token Efficiency

- Trend math is local computation, not LLM
- Reuse the `/before-after` skill for that section rather than re-deriving
- Recommendations are the only LLM-generative section
