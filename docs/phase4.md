# Phase 4 — Creative & Launch

**Status:** 🔲 Not started  
**Depends on:** Phase 3 complete (approved strategy brief)  
**Estimated in blueprint:** 2–3 days

---

## Goal

Write all the ad copy, build the campaign structure, fire the guardrail hooks, and push the first campaign live to Meta — all from the approved strategy brief.

---

## What Gets Built

### `/creative` Skill + Creative Agent

**Skill (`skills/creative.md`):** Full creative package from strategy brief.  
**Agent (`agents/creative-agent.md`):** On-demand or pre-launch copy generation.

**Needs:** `client.voice`, `client.audience`, `brief.offer`, `brief.angles`  
**Outputs:** `clients/{slug}/ad_copy.json`

Per campaign angle:
1. 5 hook options
2. For each hook: 3 primary text variants + 3 headline variants + 3 CTA variants
3. Each variant scored: clarity, specificity, emotional trigger, CTA strength
4. Top pick per angle flagged
5. All copy checked against restricted words from client profile
6. Design brief generated: sizes, copy placement, visual direction

Copy saved to `ad_copy` table in Supabase.

---

### `/launch` Skill (`skills/launch.md`)

Reads strategy brief + ad copy + audience map → builds and fires campaign structure via Meta API.

**Needs:** `client.account`, `client.kpis`, `strategy_brief`, `ad_copy`, `audience_map`  
**Outputs:** `clients/{slug}/campaign_log.json` + Slack notification

**Launch sequence:**
1. Validate strategy brief is approved
2. Fill `templates/campaign.json` with brief data
3. Fire `pre-launch` hooks (see below) — BLOCK if any fail
4. `create_campaign` via Meta MCP (status: PAUSED)
5. `create_adset` per audience segment (status: PAUSED)
6. `create_ad_creative` + `create_ad` per copy variant (status: PAUSED)
7. Human confirmation requested before setting anything to ACTIVE
8. Post-launch hooks fire → log to Supabase, notify Slack

---

### All PreToolUse Hooks (`hooks/`)

#### `budget-guard.js`
Fires before: `create_campaign`, `update_campaign`  
Checks proposed budget against daily cap in client CLAUDE.md.  
If > 2× current budget OR > absolute cap → block + send Slack approval request.

#### `utm-enforcer.js`
Fires before: `create_ad`  
Validates all destination URLs have required UTM params.  
If missing → injects correct UTM template from client profile, logs correction.

#### `naming-check.js`
Fires before: `create_campaign`, `create_adset`, `create_ad`  
Validates name matches naming convention regex.  
If non-compliant → block and suggest corrected name.

#### `creative-compliance.js`
Fires before: `create_ad`  
Checks: restricted words, primary text character count, Meta policy flags.  
If violations → block with specific reason.

#### `pixel-check.js`
Fires before: `create_campaign` with conversion objective  
Verifies pixel is installed and target conversion event fired in last 7 days.  
If pixel not firing → block with instructions to fix pixel first.

---

### All PostToolUse Hooks

#### `post-launch.js`
Fires after: `create_campaign`  
Logs to Supabase `campaigns` table: ID, structure, budget, targeting, creative IDs, timestamp.  
Sends Slack notification: campaign name, budget, objective, audience summary.

---

### Templates

- `templates/campaign.json` — campaign creation template with fill slots
- `templates/adset.json` — adset template
- `templates/ad-copy.md` — copy template with fill slots

---

## Test Plan

Full end-to-end: approved strategy brief → copy generation → all hooks firing → campaign structure pushed to Meta (PAUSED) → Slack notification received → human approves → campaign set ACTIVE.

---

## Previous Phase

← [Phase 3 — Research & Strategy](phase3.md)

## Next Phase

→ [Phase 5 — Optimization Loop](phase5.md)
