---
name: creative-intel
description: Use this skill when the user asks to check creative fatigue, find ads that are losing steam, or track creative performance trends (typically via `/creative-intel {slug}`). Pulls 30-day ad-level metrics, computes per-ad CTR/frequency trends, flags creative fatigue, and outputs a ranked refresh queue. Complements `/audit-creative` (one-shot scoring) with longitudinal tracking.
---

# /creative-intel — Creative Performance Trends & Fatigue Detection

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.ad_account_id`
- Meta Graph API (read-only) — ad insights with `time_increment: 1` for daily breakdown
- Optional: `clients/{slug}/creative_intel.json` from prior runs — used to detect 3-day CTR decline streaks

## Workflow

### Pass 1 — Pull daily ad insights (last 30d)

For every ad that ran in the last 30 days:
- `GET /{ad_id}/insights?fields=impressions,clicks,inline_link_clicks,inline_link_click_ctr,frequency,spend,actions&time_increment=1&date_preset=last_30d`

Batch in groups of 10 to respect rate limits.

### Pass 2 — Compute per-ad metrics

For each ad with ≥ 7 days of data:
- `ctr_30d_avg` — mean link CTR over the full window
- `ctr_7d_avg` — mean link CTR over the last 7 days
- `ctr_delta` — `(ctr_7d_avg / ctr_30d_avg) - 1` (negative = decay)
- `frequency_7d` — last 7d frequency
- `consecutive_ctr_decline_days` — count from today backward where CTR_day < CTR_day-1
- `days_active` — days with impressions > 0

### Pass 3 — Fatigue classification

| Flag | Rule |
|---|---|
| `FATIGUE_HIGH` | `frequency_7d > 4` AND `ctr_delta < -0.3` (CTR fell ≥ 30% off own baseline) |
| `FATIGUE_MEDIUM` | `frequency_7d > 3` AND `ctr_delta < -0.2` |
| `STREAK_DECLINE` | `consecutive_ctr_decline_days >= 3` regardless of frequency |
| `BURNOUT_SOON` | `frequency_7d > 3.5` AND `days_active > 14` (proactive — refresh before fatigue hits) |
| `HEALTHY` | none of the above |

### Pass 4 — Refresh queue

Rank flagged ads by `spend_7d × (1 + |ctr_delta|)` — bigger wasted spend × deeper decline = higher refresh priority.

Top 10 form the refresh queue. Each entry includes:
- ad_id, ad_name, campaign_id, adset_id
- spend_7d, frequency_7d, ctr_7d, ctr_30d, ctr_delta
- flag, refresh_priority_score
- creative_id (so /creative can find the variant to refresh)

### Pass 5 — Persist

Write `clients/{slug}/creative_intel.json`:
```json
{
  "slug": "...",
  "generated_at": "...",
  "window_days": 30,
  "ads_analyzed": 0,
  "ads_flagged": 0,
  "by_ad": [{...}],
  "refresh_queue": [{...}],
  "flag_counts": { "FATIGUE_HIGH": 0, ... }
}
```

Print a one-line summary: `{N} ads analyzed · {F} flagged · top refresh: {ad_name}`.

## Output

- `clients/{slug}/creative_intel.json`

## Error Handling

- Ad with no impressions in 30d → skip silently
- Ad with < 7 days of data → mark `status: "insufficient_data"`, do not classify
- Throttle (code 17/613) → halt, surface fbtrace_id

## Token Efficiency

- All flag classification is local computation
- One Graph call per ad — batched in 10s
- No LLM calls in the body; Claude only sees the summary + refresh queue
