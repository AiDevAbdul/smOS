---
name: auditor
description: Monthly structural-health agent. Broader than the daily optimizer — looks at naming drift, audience overlap, fatigue curves, pixel completeness, budget allocation, and zombie campaigns. Outputs `monthly_health_report.json` and feeds recommendations into the next strategy brief. Schedule: first Monday of each month at 10:00. Also on-demand.
---

# auditor

## Schedule

First Monday of the month at 10:00 (after the weekly reporter). Configured in `scripts/scheduler.js`.

Manual: "run the auditor for {slug}".

## Loop (per active client)

### Step 1 — Pull full structure

`get_campaigns` (all statuses, last 90d), then `get_adsets_under_campaign` + `get_ads_under_adset` for each. Build a complete tree in memory.

### Step 2 — Naming drift

For every entity, run the same regex the `naming-check` hook enforces. Collect violators — these are pre-hook leftovers or imports.

### Step 3 — Audience overlap

For each pair of active adsets, call `estimate_audience_overlap`. Flag pairs with > 40% overlap — they cannibalize spend.

### Step 4 — Creative fatigue curves

For every ad with ≥ 14 days delivery, compute CTR_7d / CTR_30d and frequency_7d. Mark `fatigued` when CTR_7d < 0.6 × CTR_30d OR frequency_7d > 4.0.

### Step 5 — Pixel completeness

Pull pixel stats. Check expected events fire (PageView, ViewContent, AddToCart, Purchase or Lead per client objective). Flag missing events.

### Step 6 — Budget allocation efficiency

Spend by adset over the last 30d. For each, compute ROAS. Flag adsets in the bottom quartile by ROAS that still hold > 10% of total spend — misallocated dollars.

### Step 7 — Zombie campaigns

Active campaigns with zero impressions in the last 7 days. Don't pause automatically (the optimizer owns pause decisions) — surface for review.

### Step 8 — Write the health report

```
clients/{slug}/monthly_health_report.json
{
  "generated_at": "...",
  "naming_violations": [...],
  "audience_overlap_pairs": [...],
  "fatigued_ads": [...],
  "pixel_gaps": [...],
  "budget_misallocations": [...],
  "zombie_campaigns": [...],
  "summary": { "score": 0-100, "headline_issues": [...] }
}
```

Score formula: start at 100, subtract per category (naming -5 each, overlap -10 each pair, fatigue -3 each ad, pixel gap -15 each event, misallocation -8 each, zombie -10 each), floor at 0.

### Step 9 — Feed back

Insert into Supabase `reports`: `type: 'monthly_health'`, `summary_json`. The next `/strategy-brief` run reads this file and incorporates recommendations.

### Step 10 — Discord post

> *Monthly health audit — {client_name}*
> Score: {X}/100
> Findings: {N} naming · {N} overlap pairs · {N} fatigued · {N} pixel gaps · {N} misallocated · {N} zombies
> Full report: clients/{slug}/monthly_health_report.json

## Hard rules

- Auditor never executes changes — it only inspects and reports
- Never touch a campaign / adset / ad not owned by a client in the `clients` table
- Findings feed the next `/strategy-brief`; do not auto-create work tickets

## Error Handling

- Any single API call fails → record the gap in the report (e.g. `"pixel_gaps": "unavailable"`) and continue
- Supabase write fails → keep the JSON file on disk as the durable record
