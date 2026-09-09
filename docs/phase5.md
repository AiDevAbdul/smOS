# Phase 5 — Optimization Loop

**Status:** ✅ Complete  
**Completed:** 2026-06-19 (skills + optimizer agent + scheduler landed); hardened to the validator Production bar in the later skills pass  
**Depends on:** Phase 4 complete ✅ (at least one live campaign)  
**Estimated in blueprint:** 2–3 days

---

> **This is the original blueprint, kept for history — not the current spec.** Three
> things drifted: the skills shipped as directories (`skills/analyze/SKILL.md` +
> `analyze.js` + `references/`), not the flat `skills/analyze.md` named below; the
> digest goes to **Discord**, not Slack (see CLAUDE.md § Guardrail Rules); and the
> Test Plan's "Uppal Pharma" is not an active client — `/analyze` is exercised
> against **blue-rose-auto**, which has live spend. Read the `SKILL.md` files for
> current behavior.
>
> Note the name collision: this Phase 5 is the *Optimization Loop*.
> `docs/agency-os-roadmap.md`'s "Phase 5" is a different thing (Agency Ops — CRM,
> proposals, contracts, billing).

---

## Goal

Build the daily automation that runs without human input. Every morning: pull metrics, compare against KPI thresholds, pause losers, scale winners, flag anomalies, send Slack digest.

---

## What Gets Built

### `/analyze` Skill (`skills/analyze.md`)

On-demand performance deep dive.

**Needs:** `client.account`, `client.kpis`  
**Outputs:** `clients/{slug}/performance_analysis.json`

Pulls last 7/14/30 days from Meta API. Segments by:
- Campaign
- Adset
- Ad
- Placement (Feed vs Story vs Reels)
- Age + gender
- Device

Flags underperformers, identifies winners, surfaces creative fatigue signals.

---

### `/scale` Skill (`skills/scale.md`)

Executes scaling decisions from an analysis output.

**Needs:** `client.kpis`, `performance_analysis.json`  
**Outputs:** `clients/{slug}/scaling_log.json` + Slack notification

Scaling rules (defaults, overridden per client in their CLAUDE.md):
- Pause: any ad with CPA > max after minimum spend reached
- Pause: any ad with frequency > cap for the window
- Scale: any adset with ROAS > min for 3 consecutive days → +20% budget
- Duplicate: best-performing adset into a new budget test

All actions logged to `optimizer_log` table.

---

### Optimizer Agent (`agents/optimizer.md`)

**Schedule: Daily 8:00 AM**

Fully autonomous. Processes all active clients in a single session.

**Decision loop per client:**
1. Pull last 24h metrics for all active campaigns
2. For each ad: compare CPA, CTR, ROAS, frequency against client thresholds
3. Auto-pause: CPA > max after minimum spend
4. Auto-pause: frequency > cap
5. Auto-scale: ROAS > min for 3 consecutive days → +20% budget
6. Flag: anomalies (spend spike, CTR collapse, delivery issue, zero impressions)
7. Log all decisions with reasoning to `optimizer_log`
8. Send daily Slack digest: actions taken, flags raised, top performers

**What it never does without Slack approval:**
- Budget increase > $500/day
- Any action outside 6 AM – 9 PM client timezone
- Audience or targeting changes

---

### Scheduler (`scripts/scheduler.js`)

Cron configuration for Claude Code scheduled agents:
- Optimizer agent: daily 8:00 AM
- Reporter agent: Monday 9:00 AM (built in Phase 6)

---

## Test Plan

Run optimizer agent manually against Uppal Pharma with at least 3 days of live data. Verify:
- Correct thresholds applied from client CLAUDE.md
- Pause decision fires correctly on underperformer
- Scale decision fires correctly on winner
- Supabase `optimizer_log` row created
- Slack digest formatted and sent

---

## Previous Phase

← [Phase 4 — Creative & Launch](phase4.md)

## Next Phase

→ [Phase 6 — Reporting & Polish](phase6.md)
