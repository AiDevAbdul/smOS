---
name: strategy-brief
description: Use this skill when the user asks to build a campaign strategy brief or synthesize intake/audit/competitor intel into a launch plan (typically via `/strategy-brief {slug}`). Produces the brief that gates Phase 4 — requires explicit human approval in Slack before `/launch` can run.
---

# /strategy-brief — Campaign Strategy Synthesis

## Required Context

- `clients/{slug}/client_profile.json`
- `clients/{slug}/audit_report.md` (and its `summary_json` row in Supabase `reports`)
- `clients/{slug}/competitor_intel.json`
- `clients/{slug}/audience_map.json`
- `clients/{slug}/CLAUDE.md` — for client-specific KPI overrides
- Slack connector — for posting the brief and listening for the approval reply
- Supabase connector — for `strategy_briefs` row

Halt if any of the four input artifacts is missing — surface which one and which skill produces it.

## Workflow

### Pass 1 — Load & reconcile

Read all four inputs. Resolve conflicts:
- If audit shows actual `target_cpa` history that contradicts profile KPI → flag both, default to profile, note divergence in `assumptions`
- If competitor gaps point to an angle blocked by `voice.restricted_words` → drop the angle, note in `excluded_angles`

### Pass 2 — Objective hierarchy

Decide what runs first and what to scale into, based on:
- `business.conversion_event`
- Audit signals (existing pixel events firing, prior winning campaigns)
- Budget headroom from `kpis.monthly_budget_low/high`

Default progression for a healthy pixel + purchase event:
1. **Phase A (week 1–2):** Conversions — Purchases on broad + top 1 interest cluster
2. **Phase B (week 3):** Add retargeting (RT_PIX_30D, RT_ENG_365D) once Phase A has data
3. **Phase C (week 4+):** Scale into Lookalike 1% + second interest cluster

Variant rules:
- Cold pixel / no purchase history → start at Traffic or Leads, graduate to Conversions after the pixel learns
- Low-budget client (< $1k/mo) → broad-only, single audience, no parallel tests

### Pass 3 — Budget allocation

Allocate `monthly_budget_low` across the objective hierarchy:
- 60% prospecting cold (broad + interest)
- 25% retargeting warm
- 15% lookalike test

Translate to daily budgets per adset. Flag any single adset daily budget > $200 (triggers Slack approval per global guardrails).

### Pass 4 — Audience priority order

Rank the audiences in `audience_map.json` for launch sequence:
1. Broad (no interest layer)
2. Best interest cluster (largest healthy cluster, most aligned with USP)
3. RT_PIX_30D
4. RT_ENG_365D
5. LAL 1% from strongest seed

Trim to top 3–5 for the first launch; the rest queue for scale.

### Pass 5 — Creative direction (3 angles to test)

Pick three distinct angles, each tied to a gap in `competitor_intel.gaps` and aligned with `business.usp`:
- Angle 1: pain-led
- Angle 2: aspiration / outcome-led
- Angle 3: social proof / authority

For each angle, specify:
- Hook archetype (e.g. "POV question", "Stat shock", "Before/After")
- Recommended format (image / video / carousel) chosen to fill a competitor format gap
- 1-line creative prompt that `/creative` will expand later

### Pass 6 — Success metrics

Pull KPI thresholds from client CLAUDE.md, then declare per-objective targets:
- Cold prospecting: CTR, CPM, CPC, CPA, ROAS targets
- Retargeting: CPA target (typically 50–70% of cold CPA)
- Scaling gate: 3 consecutive days ROAS > target before budget increase

### Pass 7 — 30-day calendar outline

Week-by-week table:
- Week 1: Phase A launch, 3 creatives × 2 audiences, learning
- Week 2: Kill underperformers, refresh worst creative
- Week 3: Phase B retargeting on
- Week 4: Phase C lookalike + scale gate evaluation

### Pass 8 — Render & persist

1. Write `clients/{slug}/strategy_brief.json` with all of the above as structured data:
   ```json
   {
     "generated_at": "...",
     "objective_hierarchy": [{ "phase": "A", "objective": "...", "audiences": [], "start_day": 0 }],
     "budget_allocation": { "cold_pct": 0.6, "warm_pct": 0.25, "lal_pct": 0.15, "adsets": [{ "name": "...", "daily_budget": 0 }] },
     "audience_priority": ["..."],
     "creative_angles": [{ "name": "...", "hook": "...", "format": "...", "prompt": "..." }],
     "success_metrics": { "cold": {}, "warm": {}, "scale_gate": {} },
     "calendar": [{ "week": 1, "actions": ["..."] }],
     "assumptions": ["..."],
     "excluded_angles": ["..."]
   }
   ```
2. Render `clients/{slug}/strategy_brief.md` — a human-readable version of the same content, suitable to post to Slack and paste into Google Drive.

### Pass 9 — Slack approval workflow

**This is a hard gate. Phase 4 cannot proceed until approval is recorded.**

1. Post `strategy_brief.md` content to the client's Slack channel (from `approvals.channel` in the profile). Prefix with: `*Strategy brief for {name} — reply 'approve' to lock in, or 'reject [reason]' to revise.*`
2. Poll the channel (or use a Slack-event hook if wired) for a reply from an authorized approver containing `approve` or `reject`.
3. On **approve**:
   - Insert a row into Supabase `strategy_briefs`: `client_id`, `brief` (full JSON), `status: 'approved'`, `approved_by`, `approved_at`, `slack_message_ts`
   - Print: `Strategy brief approved by {user}. Run /creative next.`
4. On **reject [reason]**:
   - Capture the reason
   - Ask the user (in the current session) what to revise
   - Re-run the affected passes only (don't re-do everything)
   - Re-post the updated brief and loop back to step 2
5. If no reply within 24h → re-ping the channel once, then halt and surface to the user.

## Output

- `clients/{slug}/strategy_brief.json`
- `clients/{slug}/strategy_brief.md`
- Slack message in client channel
- Row in `strategy_briefs` table (only after approval)

## Error Handling

- Missing input artifact → halt and tell the user exactly which skill to run first (`/intake`, `/audit`, `/research`, `/audience-map`)
- Slack post fails → save the brief locally, surface the channel ID + error, do not record approval state
- Conflicting KPI signals between profile and audit → never silently override; surface both in `assumptions`

## Token Efficiency

- This skill is pure synthesis — no Meta API calls
- Read each artifact exactly once; do not re-load between passes
- The `.md` is generated from the `.json` — never write them out of sync
