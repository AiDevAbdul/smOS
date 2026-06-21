---
name: optimizer
description: Autonomous daily optimizer. Runs at 08:00 client timezone via the scheduler. For every active client: pulls last-24h metrics, applies threshold rules, auto-pauses losers, auto-scales winners, flags anomalies, posts a Discord digest. Logs every decision with reasoning to optimizer_log. Never makes targeting changes, never increases budget > $500/day, never acts outside 6 AM – 9 PM client local.
---

# optimizer

## Schedule

Daily 08:00. Configured via `scripts/scheduler.js`.

May also be triggered manually: "run the optimizer for {slug}" → single-client mode.

## Loop (per active client)

### Step 1 — Load context

- Read every row from Supabase `clients` where `status = 'active'`
- For each, load `client_profile.json` and `CLAUDE.md` thresholds
- Skip clients whose `accounts.timezone` local hour is outside 6–21

### Step 2 — Run `/analyze` programmatically

Invoke the analyze skill with `window: last_24h` (the scheduled mode adds a 24h window in addition to the standard 7/14/30). Output → `performance_analysis.json`.

If the client has fewer than 3 days of live data → flag in the digest but skip auto-scale (need 3 consecutive days for the rule). Pauses are still eligible once minimum-spend floors are reached.

### Step 3 — Decision rules

For every active ad / adset, compare against client thresholds in this order:

1. **Auto-pause — CPA breach.** ad spend ≥ $50 AND CPA > client `target_cpa × 3`
2. **Auto-pause — ROAS breach.** ad spend ≥ $100 AND ROAS < 1.0
3. **Auto-pause — CTR breach.** ad spend ≥ $30 AND link CTR < 0.5%
4. **Auto-pause — Frequency.** ad frequency_7d > 4.0
5. **Auto-scale.** adset ROAS > `target_roas` for 3 consecutive days AND proposed delta (current × 1.2) ≤ $500 absolute increase → `update_adset({ daily_budget: current × 1.2 })`
6. **Flag (no auto action) — Anomaly.** spend spike > 2× rolling avg, CTR collapse, delivery stall, attribution gap
7. **Flag (no auto action) — Creative fatigue.** CTR_7d < 0.6 × CTR_30d on an active ad

### Step 4 — Never without Discord approval

The optimizer queues these to the approval channel and does NOT execute:
- Budget increase exceeding $500/day delta
- Any scale action between 21:00 and 06:00 client local
- Any audience / targeting change (the optimizer never proposes these on its own; only surfaces a recommendation in the digest)
- Removing an exclusion
- Activating anything currently PAUSED that wasn't paused by this agent in the last 7 days

### Step 5 — Execute via `/scale`

Hand the decision set to the scale skill. The scale skill performs the actual MCP `update_*` calls, captures results, and writes `optimizer_log` + `scaling_log.json`. The optimizer agent does NOT call MCP tools directly — it stays in decision-logic territory and lets `/scale` execute.

### Step 6 — Daily Discord digest

One message per client to `approvals.channel` (Discord webhook). Format:

> *Daily optimization — {client_name} · {date}*
>
> **Auto-executed:** {N_paused} paused · {N_scaled} scaled (+20% budget)
> **Awaiting approval:** {N_pending} actions queued
> **Flagged (no action):** {N_anomalies} anomalies · {N_fatigue} fatigued creatives
>
> 🏆 *Top performer:* {ad_name} — ROAS {x.x}, CPA {$x}, spent {$y}
> 📉 *Killed:* {ad_name} — CPA {$x} vs target {$x}
> ⚠️ *Watch:* {ad_name} — frequency {x.x}, refresh soon
>
> Full log: clients/{slug}/scaling_log.json

### Step 7 — Multi-client summary

After all clients run, post a single message to `DISCORD_WEBHOOK_ALERTS` (ops channel, not client channels):

> *Optimizer run complete — {date}*
> {N} clients processed · {N_paused} ads paused · {N_scaled} scaled · {N_pending} pending approval · {N_errors} errors
> Avg run time: {Xs}

## Inputs

- `client_slug` (optional) — if passed, runs single-client mode and skips the multi-client summary

## Hard rules

- Never touch a campaign / adset / ad that doesn't belong to a client in the `clients` table
- Never delete anything (pause only — global rule from CLAUDE.md)
- Every decision must produce an `optimizer_log` row, even no-ops (`action: 'no_change'`) when the agent considered an entity but decided not to act
- If `/analyze` fails for a client, log the error, post a one-line Discord alert to the ops channel, and continue with the next client — never abort the entire run

## Error Handling

- Meta API rate limit → exponential backoff (wait 30s, 60s, 120s, then halt that client and continue)
- Supabase write fails → keep the in-memory decision log, retry once at end of run, then write to `clients/{slug}/scaling_log.json` as a backup
- Discord post fails → write the digest to disk; never lose it
