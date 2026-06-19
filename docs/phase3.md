# Phase 3 — Research & Strategy

**Status:** 🔲 Not started  
**Depends on:** Phase 2 complete  
**Estimated in blueprint:** 2 days

---

## Goal

Transform intake + audit data into a structured, actionable campaign strategy that a human can approve before any money is spent.

---

## What Gets Built

### Meta MCP Addition: Ad Library Tools

Phase 3 needs `search_ad_library` and `get_ad_library_detail` — both already built in Phase 1's `tools/page-insights.js`. No new MCP work needed.

---

### `/research` Skill (`skills/research.md`)

Pulls competitor ads from Meta Ad Library. Analyzes format, angles, offers, CTAs. Identifies gaps.

**Needs:** `client.competitors` (from intake), `client.product`, `client.audience`  
**Outputs:** `clients/{slug}/competitor_intel.json`

What it produces per competitor:
- Active ad count and spend range
- Most-used creative formats (image/video/carousel %)
- Top copy angles and hooks
- Common CTAs and offers
- Visual style patterns
- Gaps: what are they NOT saying that we could own?

---

### `/audience-map` Skill (`skills/audience-map.md`)

Builds a structured audience targeting architecture using Meta audience data.

**Needs:** `client.audience`, pixel ID, ad account ID  
**Outputs:** `clients/{slug}/audience_map.json`

Produces:
- Interest clusters (3–5 themed groups)
- Behavior segments relevant to the product
- Retargeting layers (website visitors, engagers, video viewers)
- Lookalike strategy (which seed audience, what size)
- Recommended exclusions

---

### `/strategy-brief` Skill (`skills/strategy-brief.md`)

Synthesizes intake + audit + competitor research + audience map into a campaign strategy.

**Needs:** `client.*`, `audit_summary`, `competitor_intel`, `audience_map`  
**Outputs:** `clients/{slug}/strategy_brief.json` + `clients/{slug}/strategy_brief.md`

**Requires human approval before proceeding.**

Approval workflow:
1. Strategy brief posted to Slack client channel
2. Human reads and replies: `approve` or `reject [reason]`
3. If approved: saved to `strategy_briefs` table, Phase 4 can begin
4. If rejected: Claude asks for feedback and revises

Brief covers:
- Campaign objective hierarchy (what to run first, what to scale into)
- Budget allocation recommendation
- Audience priority order
- Creative direction (3 angles to test)
- Success metrics and KPIs
- 30-day calendar outline

---

## Test Plan

Run full research → audience map → strategy brief for Uppal Pharma.  
Target: at least 2 competitors identified in Ad Library, 3 audience segments mapped, strategy brief ready for human approval.

---

## Previous Phase

← [Phase 2 — Intake & Audit](phase2.md)

## Next Phase

→ [Phase 4 — Creative & Launch](phase4.md)
