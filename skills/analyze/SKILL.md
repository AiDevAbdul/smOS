---
name: analyze
description: Use this skill when the user asks to analyze, check, or review the performance of a client's Meta ads (typically via `/analyze {slug}`). Performs an on-demand deep dive — pulls 7/14/30-day metrics segmented by campaign, adset, ad, placement, age/gender, and device; flags underperformers, identifies winners, surfaces creative fatigue.
---

# /analyze — Performance Deep Dive

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.ad_account_id`, `kpis`
- `clients/{slug}/CLAUDE.md` — for client-specific KPI overrides
- Meta MCP server — `get_campaigns`, `get_campaign_insights`, `get_adset_insights`, `get_ad_insights`, `get_ads_under_adset`
- Supabase connector — read recent `daily_metrics` rows (avoid re-fetching) + write the `reports` row

## Workflow

### Pass 1 — Pull the active tree

1. `get_campaigns({ ad_account_id, status: ["ACTIVE","PAUSED"] })` — keep only entities that ran in the last 30 days
2. For each campaign, fetch insights at three windows: `last_7d`, `last_14d`, `last_30d`
3. For each adset under each active campaign, fetch `get_adset_insights` at the same three windows
4. For each ad: `get_ad_insights` at `last_7d` and `last_30d`

Run windows in parallel within each entity; entities themselves in batches of 5 to respect rate limits.

### Pass 2 — Segmentation breakdowns

For active adsets only (skip paused), request additional breakdowns from Graph API via `get_adset_insights` with the `breakdowns` parameter:
- `placement` (Facebook Feed / Story / Reels / IG Feed / IG Reels)
- `age,gender`
- `device_platform` (mobile_app, mobile_web, desktop)

Window: `last_14d` for breakdowns (shorter windows are too noisy at segment level).

### Pass 3 — Derive per-entity metrics

For every campaign/adset/ad row at every window, compute:
- spend, impressions, clicks, link_clicks, conversions, conversion_value
- CPM, CTR (link), CPC (link), CPA, ROAS, frequency
- Day-over-day deltas vs the previous equivalent window

### Pass 4 — Flag classification

Read thresholds from client CLAUDE.md (fall back to global defaults). For each ad:

- **PAUSE_CANDIDATE — CPA:** spend ≥ $50 AND CPA > 3× target (or per-client override)
- **PAUSE_CANDIDATE — ROAS:** spend ≥ $100 AND ROAS < 1.0
- **PAUSE_CANDIDATE — CTR:** spend ≥ $30 AND link CTR < 0.5%
- **PAUSE_CANDIDATE — Frequency:** frequency_7d > 4.0
- **SCALE_CANDIDATE:** adset ROAS > 3.0 (or per-client) for 3 consecutive days
- **DUPLICATE_CANDIDATE:** adset is the top ROAS performer in its campaign AND has > 2× the next-best adset's ROAS
- **CREATIVE_FATIGUE:** ad CTR_7d < 0.6 × CTR_30d OR frequency_7d > 3.0 AND CTR declining 3 days running
- **ANOMALY — spend spike:** spend_yesterday > 2× rolling 7d avg
- **ANOMALY — delivery stall:** active ad with zero impressions in last 24h
- **ANOMALY — CTR collapse:** CTR_yesterday < 0.4 × CTR_30d

Every flag includes the metric value, the threshold it tripped, and a one-line reasoning string — these feed `/scale` directly.

### Pass 5 — Winners + losers ranking

- Top 5 ads by ROAS (with spend ≥ $50)
- Top 5 ads by CPA (lowest, with same floor)
- Bottom 5 ads by ROAS
- Top placement / age-gender / device segment by ROAS at adset level (highlight if one segment is >50% of conversions — concentrate spend there)

### Pass 6 — Persist

1. Write `clients/{slug}/performance_analysis.json`:
   ```json
   {
     "generated_at": "...",
     "window_summary": { "last_7d": {...}, "last_14d": {...}, "last_30d": {...} },
     "by_campaign": [...],
     "by_adset": [...],
     "by_ad": [...],
     "breakdowns": { "placement": {...}, "age_gender": {...}, "device": {...} },
     "flags": [
       { "entity_type": "ad", "entity_id": "...", "name": "...", "flag": "PAUSE_CANDIDATE_CPA", "metric": 0, "threshold": 0, "reasoning": "..." }
     ],
     "winners": { "top_roas": [...], "lowest_cpa": [...] },
     "losers": { "bottom_roas": [...] },
     "segment_highlights": [...]
   }
   ```
2. Insert row in Supabase `reports`: `client_id`, `type: 'performance_analysis'`, `summary_json` (flag counts + top/bottom), `created_at`
3. Upsert per-entity metrics into Supabase `daily_metrics` so the optimizer can read history without re-hitting Meta
4. Print a one-line summary: `{N} flags · {W} winners · {L} losers · run /scale to execute.`

## Output

- `clients/{slug}/performance_analysis.json`
- Rows in `daily_metrics` + a row in `reports`

## Error Handling

- Meta API throttle (code 17/613) → halt, surface fbtrace_id, do not retry automatically
- Empty insights for an active entity → flag as `ANOMALY_delivery_stall`, continue
- Pixel attribution gap (ROAS = 0 but click-throughs healthy) → flag `ANOMALY_attribution`, do not classify as PAUSE

## Token Efficiency

- Read prior 7 days of `daily_metrics` from Supabase first — only fetch from Meta for windows not already cached
- All flag classification is local computation, not LLM-driven
- Breakdowns run only on active adsets, not paused ones

## PDF Rendering

Every report ships in HTML **and** PDF. After the HTML/markdown is written, run the shared helper:

```bash
python scripts/render_pdf.py <report.html> --output <report.pdf>
```

For markdown-first reports (audit_report.md, weekly_report.md), first convert markdown → HTML using your existing renderer, then call `render_pdf.py`. The helper uses headless Chromium (Playwright) so Apple-style gradients, charts, and table borders render correctly. First-time setup: `pip install playwright && python -m playwright install chromium`.
