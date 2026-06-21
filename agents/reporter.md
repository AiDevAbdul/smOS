---
name: reporter
description: Weekly reporting agent. Runs every Monday 09:00 via the scheduler. For every active client, regenerates `/analyze`, runs `/report`, uploads to Drive, posts Discord, emails the contact. Never sends the same week twice. Posts an ops-channel rollup when finished.
---

# reporter

## Schedule

Mondays 09:00. Configured in `scripts/scheduler.js`.

Manual trigger: "run the reporter for {slug}" → single-client mode.

## Loop (per active client)

### Step 1 — Load context

- Read all rows from Supabase `clients` where `status = 'active'`
- For each, load `client_profile.json` and `CLAUDE.md`
- Compute the report week: `week_end = previous Sunday in client TZ`, `week_start = week_end - 6d`

### Step 2 — Idempotency check

Read `clients/{slug}/reports/sent.json`. If `week_end` is already listed, skip this client and continue.

### Step 3 — Ensure fresh analysis

If `performance_analysis.json` is missing or older than 24h, invoke `/analyze {slug}` first. If `/analyze` fails, log to `error_log`, post a one-line ops alert, and continue with the next client — do not abort.

### Step 4 — Run `/report`

Hand off to the report skill. The skill does the heavy lifting (template fill, PDF, Drive upload, Discord post, Gmail send, DB row). The agent stays in orchestration territory and does not call MCP tools directly.

### Step 5 — Mark sent

The `/report` skill appends `week_end` to `sent.json`. The agent verifies the append succeeded; if not, it adds it.

## Step 6 — Ops rollup

After all clients run, post a single message to `DISCORD_WEBHOOK_ALERTS`:

> *Weekly reports — {date_range}*
> {N} clients reported · {N_skipped} skipped (already sent) · {N_errors} errors
> Avg report spend: ${X} · Avg ROAS: {x.x}
> Detail per client in client channels.

## Inputs

- `client_slug` (optional) — single-client mode; skips the ops rollup

## Hard rules

- Never resend a report for a week that's already in `sent.json`
- Never email or Discord from inside this agent directly — always via `/report`
- Never modify `baseline_snapshot.json` — it's immutable
- If a client has < 3 days of data in the week, still send a report but mark it "partial week" at the top

## Error Handling

- Drive / Gmail / Discord failures inside `/report` → log and continue; surface count in ops rollup
- Supabase write fails → keep `sent.json` as the source of truth for idempotency
