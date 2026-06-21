---
name: scale
description: Use this skill when the user asks to scale winners, kill losers, or execute scaling decisions on a performance analysis (typically via `/scale {slug}` or invoked by the optimizer agent). Pauses underperformers, scales winners by +20%, duplicates top performers for budget tests; all actions logged to `optimizer_log`.
---

# /scale — Execute Scaling Decisions

## Required Context

- `clients/{slug}/client_profile.json` — for `kpis`, `accounts.ad_account_id`, `approvals.channel`
- `clients/{slug}/CLAUDE.md` — for per-client threshold overrides
- `clients/{slug}/performance_analysis.json` — generated within the last 4 hours (halt if older — run `/analyze` first)
- Meta MCP server — `update_ad_status`, `update_adset`, `update_campaign`, `create_adset`, `create_ad`
- Supabase connector — `optimizer_log` insert
- Discord connector — digest post

## Rules (defaults — client CLAUDE.md overrides)

| Flag | Action | Approval |
|---|---|---|
| PAUSE_CANDIDATE_CPA | `update_ad_status({status:"PAUSED"})` | auto |
| PAUSE_CANDIDATE_ROAS | `update_ad_status({status:"PAUSED"})` | auto |
| PAUSE_CANDIDATE_CTR | `update_ad_status({status:"PAUSED"})` | auto |
| PAUSE_CANDIDATE_FREQUENCY | `update_ad_status({status:"PAUSED"})` | auto |
| SCALE_CANDIDATE | `update_adset({daily_budget: current × 1.2})` | auto if delta ≤ $500/day, else Discord |
| SCALE_WATCH | flag only — ROAS qualifies but conversions < `scale_min_conversions` (sample too thin) | Discord digest |
| DUPLICATE_CANDIDATE | clone adset → new adset with 0.5× budget | Discord |
| CREATIVE_FATIGUE | flag only; do not pause silently | Discord digest |
| ANOMALY_* | flag only; surface in digest (incl. `ANOMALY_spend_spike`) | Discord |

**Significance gating (Track C):** `/analyze` only emits an auto-eligible `SCALE_CANDIDATE` when the ROAS win clears the conversion-count floor (`scale_min_conversions`, default 15); thinner winners downgrade to `SCALE_WATCH`. `CREATIVE_FATIGUE` requires the 7d-vs-30d CTR drop to pass a two-proportion z-test. `/scale` re-checks the carried `significance` and refuses to auto-scale an insignificant flag (defense-in-depth).

Global hard blocks (never auto):
- Budget increase > $500/day in a single action
- Any action outside 6 AM – 9 PM client timezone (read `accounts.timezone`)
- Audience or targeting changes
- Removing exclusions

## Workflow

### Step 1 — Validate

- Refuse to run if `performance_analysis.json` is missing or > 4h old
- Refuse to run outside client business hours unless `--force` is passed; if forced, surface the violation in the digest

### Step 2 — Group flags

Read the `flags` array. Group by `entity_id` so the same ad/adset isn't touched twice. Resolve conflicts:
- If an adset has both SCALE and one of its ads has PAUSE → pause the ad first, then evaluate scale on remaining ads' aggregated metrics
- If an entity has both PAUSE and ANOMALY → pause wins, anomaly stays in digest

### Step 3 — Execute auto actions

For each auto-eligible decision, run the corresponding update_* MCP call. Capture the result.

For SCALE actions where new daily budget exceeds the $500 single-increase ceiling → defer to Step 4 (approval queue) instead of executing. The `budget-guard` hook will block it anyway; better to surface ahead of time.

### Step 4 — Approval queue

For every decision flagged "Discord" above, post one consolidated approval message to `approvals.channel`:

> *Scaling actions pending approval for {name}:*
> 1. Scale adset `FEED_2545_FITNESS` budget $200 → $260 (+30%) — ROAS 4.2, 4 days in a row
> 2. Duplicate adset `REELS_1834_RUNNING` at $50/day budget test — best ROAS in campaign
>
> Reply with action numbers to approve (e.g. `approve 1,2`) or `skip` to defer.

Wait for reply. Apply approved actions; log skipped ones with `status: 'deferred'`.

### Step 5 — Log every decision

Insert one row per decision into Supabase `optimizer_log`:
```json
{
  "client_id": "...",
  "entity_type": "ad|adset|campaign",
  "entity_id": "...",
  "entity_name": "...",
  "flag": "PAUSE_CANDIDATE_CPA",
  "action": "paused|scaled|duplicated|flagged|deferred",
  "metric_value": 0,
  "threshold": 0,
  "reasoning": "...",
  "auto": true,
  "actor": "scale_skill|optimizer_agent|human:<name>",
  "created_at": "..."
}
```

Also write `clients/{slug}/scaling_log.json` — the same set, plus a roll-up summary at the top.

### Step 6 — Digest

Post a single Discord summary to the client channel:

> *Daily optimization — {name}*
> ✅ Auto: paused N · scaled M · flagged K · anomalies F
> ⏳ Awaiting approval: P
> 🏆 Top performer: {ad_name} — ROAS {x.x}, CPA {$x}
> 📉 Killed: {ad_name} — CPA {$x} vs target {$x}

## Output

- `clients/{slug}/scaling_log.json`
- Rows in `optimizer_log`
- Discord digest in client channel

## Error Handling

- Any `update_*` call fails → log to `error_log`, keep going with the remaining actions; do not abort the whole run
- `budget-guard` hook blocks a scale action → record `action: 'blocked_by_guard'` with the hook's stderr message
- Discord post fails → write digest to `clients/{slug}/digests/{date}.md` so it's not lost

## Token Efficiency

- Reads from `performance_analysis.json` only — no Meta fetches in this skill
- All decisions are deterministic rule-checks, not LLM calls
- One batch Discord message per run, not one per action
