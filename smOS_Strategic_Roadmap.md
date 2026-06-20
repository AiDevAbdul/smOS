# smOS Strategic Roadmap: A-to-Z Meta Ads Management

**Date:** June 19, 2026  
**Status:** Deep Research Complete — Ready for Implementation Planning

---

## Executive Summary

smOS has a strong foundation: 29 MCP tools, 14 skill specs, 7 guardrail hooks, 4 agent definitions, and one end-to-end test client (Blue Rose Auto). But it's currently ~30% built — Phase 1 infrastructure is solid, Phases 2–6 are documented specs with test artifacts but no executable logic.

This document identifies **critical gaps**, **open-source tools** that can fill them, **new capability layers** to add, and a prioritized roadmap to make smOS a true A-to-Z Meta platform management system.

---

## Part 1: Critical Issues (Fix First)

### 1.1 — API Version is Outdated

**Current:** v21.0 (October 2024)  
**Latest:** v25.0 (February 2026)  
**Deprecation risk:** v21.0 will be deprecated ~October 2026

Breaking changes you're missing:

- **v24.0+:** Legacy Advantage+ Shopping Campaign (`smart_promotion_type=AUTOMATED_SHOPPING_ADS`) and AAC creation APIs are **deprecated**. The new unified Advantage+ framework requires setting three automation levers simultaneously (budget, audience, placement).
- **v22.0+:** Custom Audience CLCA certification required — `is_sac_cfca_terms_certified` must be set on ad sets using customer list audiences, or creation fails.
- **v25.0:** Reach metric no longer returned for breakdown queries with start dates >13 months old. Async report failures now return structured error fields.
- **End of June 2026:** Page Viewer Metric replacing legacy reach metric for cross-platform consistency.

**Action:** Update CLAUDE.md, meta-client.js, and all tool endpoints to v25.0. Audit campaign creation flows for Advantage+ compatibility.

### 1.2 — Skills Are Specs, Not Executable

All 14 skills exist as SKILL.md documentation only. None have executable logic — they rely on Claude reading the spec and improvising. This means:

- No deterministic behavior
- No error recovery patterns
- No structured data validation
- Inconsistent output quality

**Action:** Each skill needs a companion script (Python or Node) that handles data fetching, transformation, and template rendering. Claude invokes the script, reviews output, and adds analysis.

### 1.3 — No PDF Rendering Pipeline

CLAUDE.md requires HTML + PDF for every client report, and references `scripts/render_pdf.py` — but this file doesn't exist.

**Action:** Build `render_pdf.py` using Playwright (headless Chromium). Install: `pip install playwright && python -m playwright install chromium`.

### 1.4 — No Ad Library Scraper Fallback

The `/research` skill references `scripts/meta-ad-library/` for when the official Ad Library API returns limited data — but this directory is empty.

**Action:** Implement using one of the open-source scrapers identified in Part 3.

### 1.5 — Supabase Schema Not Deployed

Schema is designed (6 tables) but SQL hasn't been run. The entire data persistence layer is non-functional.

**Action:** Write and deploy migration SQL for: `clients`, `baseline_snapshots`, `campaigns`, `daily_metrics`, `optimizer_log`, `reports`.

---

## Part 2: Missing Capability Layers

These are entire categories of functionality that smOS doesn't address yet, but an A-to-Z Meta management system needs.

### 2.1 — Organic Content Management

**Current state:** smOS has `get_page_insights`, `get_post_insights`, and `get_instagram_insights` tools — read-only.

**Missing:**

| Capability | API Available? | Priority |
|---|---|---|
| Schedule & publish Facebook posts | Yes (Pages API) | High |
| Schedule & publish Instagram posts/reels | Yes (Instagram Graph API, 100/day limit) | High |
| Comment moderation (read, reply, hide, delete) | Yes (Pages + IG API) | Medium |
| Instagram Stories publishing | Limited API support | Low |
| Threads publishing + insights | Yes (Threads API, since June 2024) | Medium |
| Unified content calendar | Build layer | High |

**New tools needed in meta-server:**
- `create_page_post` — publish/schedule Facebook posts
- `create_ig_media` — publish Instagram images, reels, carousels
- `moderate_comments` — bulk comment management
- `create_threads_post` — publish to Threads
- `get_threads_insights` — Threads analytics

**New skill:** `/publish` — content calendar management, scheduling, cross-platform publishing.

### 2.2 — Conversions API (CAPI) / Server-Side Tracking

**Current state:** smOS has pixel tools (`get_pixel_events`, `check_pixel_health`) but no server-side event capability.

**Missing:**

| Capability | Why It Matters |
|---|---|
| Send server-side events | iOS 14+ killed ~40% of pixel tracking. CAPI is now essential for accurate attribution. |
| Event match quality monitoring | Low match rates = wasted ad spend on bad optimization signals |
| Redundant pixel + CAPI setup | Meta's recommended best practice |
| Offline conversion uploads | Connect CRM sales back to ad clicks |

**New tools needed:**
- `send_capi_event` — POST to `/{dataset_id}/events`
- `get_event_match_quality` — Dataset Quality API
- `upload_offline_conversions` — batch offline event uploads

**New skill:** `/capi-setup` — guide clients through CAPI implementation, monitor event quality.

### 2.3 — Product Catalog & Dynamic Ads

**Current state:** Zero catalog support.

**Missing:**

| Capability | Use Case |
|---|---|
| Create/manage product catalogs | E-commerce clients |
| Product feed management | Sync inventory to Meta |
| Dynamic product ad creation | Auto-retarget viewers with viewed products |
| Advantage+ Catalog Ads | Meta's latest dynamic ad format |
| Product set management | Target specific product groups |

**New tools needed:**
- `create_catalog`, `get_catalog`, `update_catalog`
- `upload_product_feed`, `get_product_items`
- `create_product_set`
- `create_dynamic_ad` (extends existing ad creation)

**New skill:** `/catalog` — product feed setup, catalog ad configuration.

### 2.4 — Lead Management

**Current state:** No lead form support.

**Missing:**

| Capability | Use Case |
|---|---|
| Create lead forms | Build lead gen forms via API |
| Retrieve leads | Pull lead data from forms |
| Real-time lead webhooks | Instant CRM delivery |
| Lead quality scoring | Filter junk submissions |
| CRM sync | Push to HubSpot/Salesforce/etc. |

**New tools needed:**
- `create_lead_form`, `get_lead_form`
- `get_leads` — from form or ad
- `subscribe_lead_webhook`

**New skill:** `/leads` — lead form creation, retrieval, quality analysis, CRM handoff.

### 2.5 — WhatsApp Business Integration

**Current state:** Not addressed at all.

**Missing:**

| Capability | Use Case |
|---|---|
| Send template messages | Click-to-WhatsApp ad follow-up |
| Manage message templates | Pre-approved outbound messaging |
| Read incoming messages | Customer service automation |
| Click-to-WhatsApp ad creation | Fastest-growing Meta ad format |

**New tools needed:**
- `send_whatsapp_message`, `create_message_template`
- `get_whatsapp_conversations`
- Campaign creation support for CTWA objective

**New skill:** `/whatsapp` — message template management, conversation tracking, CTWA campaign setup.

### 2.6 — Automated Rules Engine

**Current state:** smOS has a manual optimizer agent that runs daily. Meta's own Automated Rules API is not used.

**Missing:**

| Capability | Advantage |
|---|---|
| Create Meta-native automated rules | Rules execute on Meta's servers — no smOS uptime required |
| Trigger-based rules (real-time) | React to metric changes instantly, not on daily schedule |
| ROI target rules | Auto-adjust bids/budgets toward target ROAS/CPA |
| Rule execution history | Audit trail of all automated actions |

**New tools needed:**
- `create_automated_rule`, `get_rules`, `get_rule_history`
- `preview_rule` — test before activation

**Enhancement to `/scale`:** Complement the optimizer agent with Meta-native rules for time-critical actions (e.g., pause immediately when CPA exceeds 5× target, don't wait for daily run).

### 2.7 — Marketing Mix Modeling & Attribution

**Current state:** Basic ROAS/CPA tracking. No cross-channel attribution or budget allocation optimization.

**Tools to integrate:**

| Tool | What It Does | License |
|---|---|---|
| **Meta Robyn** | Marketing mix modeling — measure true channel effectiveness, optimize budget allocation | MIT |
| **Google Meridian** | Alternative MMM with geo-level granularity, Bayesian approach | Apache 2.0 |
| **eeghor/mta** | Multi-touch attribution (Markov, Shapley, last-touch, linear) | MIT |

**New skill:** `/attribution` — run MMM analysis, generate budget reallocation recommendations.

### 2.8 — Creative Intelligence

**Current state:** `/audit-creative` scores existing creatives with Claude vision. `/creative` generates copy. No creative performance tracking over time.

**Missing:**

| Capability | Tool/Approach |
|---|---|
| Pre-flight creative testing | **AdTestPro** — test against synthetic audiences before spending |
| Creative fatigue detection | Track frequency + CTR decay per creative over time |
| Competitor creative tracking | Periodic Ad Library pulls, diff analysis |
| Video performance analytics | Retention curves (p25/p50/p75/p100), hook rate analysis |
| UGC-style content scoring | Claude vision + engagement correlation |

**New skill:** `/creative-intel` — creative performance trends, fatigue alerts, competitor creative monitoring.

---

## Part 3: Open-Source Tools to Integrate

### 3.1 — Ad Library & Competitive Intelligence

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **minimaxir/facebook-ad-library-scraper** | [Link](https://github.com/minimaxir/facebook-ad-library-scraper) | Python scraper using official Ad Library API | Primary scraper for `/research` skill |
| **domini-67/facebook-ads-library-scraper** | [Link](https://github.com/domini-67/facebook-ads-library-scraper) | No-login scraper, exports JSON/CSV/Excel | Fallback when API access unavailable |
| **Wesleyan-Media-Project/fb_ad_scraper** | [Link](https://github.com/Wesleyan-Media-Project/fb_ad_scraper) | Downloads actual creative assets (images, videos) | Creative asset collection for competitor analysis |

### 3.2 — Instagram Research

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **drawrowfly/instagram-scraper** | [Link](https://github.com/drawrowfly/instagram-scraper) | Scrapes posts, comments, likes — no login needed | Organic competitor research for `/pre-audit` |

### 3.3 — Data Pipeline & ETL

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **Airbyte** | [Link](https://github.com/airbytehq/airbyte) | 350+ connectors including Facebook Marketing | Sync Meta ad data to Supabase/warehouse on schedule |
| **MeltanoLabs/tap-facebook** | [Link](https://github.com/MeltanoLabs/tap-facebook) | Singer tap for Facebook Marketing API | Lightweight alternative to Airbyte |

### 3.4 — Dashboards & Visualization

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **Metabase** | [Link](https://github.com/metabase/metabase) | No-code BI dashboards, embeddable | Client-facing performance dashboards |
| **Apache Superset** | [Link](https://github.com/apache/superset) | Advanced SQL-driven analytics | Internal power-user analytics |
| **Grafana** | [Link](https://github.com/grafana/grafana) | Real-time monitoring + alerting | KPI breach alerts to Slack |

### 3.5 — Workflow Automation

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **n8n** | [Link](https://github.com/n8n-io/n8n) | Visual workflow automation, native Meta integrations | Approval flows, lead routing, report distribution |
| **Activepieces** | [Link](https://github.com/activepieces/activepieces) | No-code workflow builder, 500+ integrations | Alternative to n8n with simpler UX |

### 3.6 — Budget Optimization & Attribution

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **Meta Robyn** | [Link](https://github.com/facebookexperimental/Robyn) | Marketing mix modeling from Meta | Budget allocation optimization |
| **Google Meridian** | [Link](https://github.com/google/meridian) | Bayesian MMM with geo-level data | Alternative MMM framework |
| **eeghor/mta** | [Link](https://github.com/eeghor/mta) | Multi-touch attribution models | Cross-channel attribution |
| **ChannelAttribution** | [Link](https://github.com/DavideAltomare/ChannelAttribution) | Markov chain attribution | Data-driven channel measurement |

### 3.7 — Creative & Content

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **Postiz** | [Link](https://github.com/gitroomhq/postiz-app) | AI social scheduler, 20+ networks, has MCP server | Organic content scheduling |
| **Brightbean Studio** | [Link](https://github.com/brightbeanxyz/brightbean-studio) | 10+ platforms, approval workflows, client portal | Full agency content management |
| **AdTestPro** | [Link](https://github.com/AnanyaP-WDW/AdTestPro) | Test creatives against synthetic audiences | Pre-flight creative validation |

### 3.8 — Audience Research

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **pySocialWatcher** | [Link](https://github.com/maraujo/pySocialWatcher) | Programmatic audience sizing via Marketing API | Automated audience research for `/audience-map` |

### 3.9 — Digital Asset Management

| Tool | GitHub | What It Does | Integration Approach |
|---|---|---|---|
| **UnoPim DAM** | [Link](https://github.com/unopim/unopim-digital-asset-management) | File management, metadata, collaboration | Client creative asset library |

---

## Part 4: New Skills to Add

Expanding from 14 to 22 skills for full A-to-Z coverage:

| # | Skill | Purpose | Priority |
|---|---|---|---|
| 15 | `/publish` | Content calendar, cross-platform scheduling (FB, IG, Threads) | High |
| 16 | `/capi-setup` | Conversions API implementation, event quality monitoring | High |
| 17 | `/catalog` | Product feed management, dynamic/catalog ad setup | Medium |
| 18 | `/leads` | Lead form creation, retrieval, quality scoring, CRM sync | Medium |
| 19 | `/whatsapp` | Message templates, CTWA campaigns, conversation tracking | Medium |
| 20 | `/creative-intel` | Creative performance trends, fatigue detection, competitor tracking | High |
| 21 | `/attribution` | MMM analysis, cross-channel attribution, budget reallocation | Low |
| 22 | `/rules` | Meta Automated Rules creation, management, monitoring | Medium |

---

## Part 5: New MCP Tools to Build

Expanding from 29 to ~50 tools:

### Organic Publishing Module (6 tools)
- `create_page_post` — publish/schedule Facebook page posts
- `create_ig_media` — publish Instagram images, reels, carousels
- `create_ig_story` — publish Instagram stories (limited support)
- `create_threads_post` — publish to Threads
- `get_threads_insights` — Threads analytics
- `moderate_comments` — bulk comment management across FB + IG

### Conversions API Module (3 tools)
- `send_capi_event` — server-side event tracking
- `get_event_match_quality` — dataset quality monitoring
- `upload_offline_conversions` — batch offline events

### Catalog Module (5 tools)
- `create_catalog` — create product catalog
- `upload_product_feed` — feed management
- `get_product_items` — browse catalog items
- `create_product_set` — product grouping
- `create_dynamic_ad` — catalog/dynamic ad creation

### Lead Management Module (3 tools)
- `create_lead_form` — build lead gen forms
- `get_leads` — retrieve submitted leads
- `subscribe_lead_webhook` — real-time lead notifications

### Automated Rules Module (4 tools)
- `create_automated_rule` — create Meta-native rules
- `get_rules` — list active rules
- `get_rule_history` — execution audit trail
- `preview_rule` — test before activation

### WhatsApp Module (3 tools)
- `send_whatsapp_message` — send template messages
- `create_message_template` — manage templates
- `get_whatsapp_conversations` — conversation history

---

## Part 6: New Agents to Build

| Agent | Schedule | Purpose |
|---|---|---|
| **content-scheduler** | Daily 07:00 | Auto-publish queued organic content, surface engagement spikes |
| **lead-router** | Real-time (webhook) | Score incoming leads, route to CRM, alert sales team |
| **creative-monitor** | Daily 10:00 | Detect creative fatigue (frequency > 4 + CTR decline), flag for refresh |
| **competitor-watcher** | Weekly Monday | Pull competitor Ad Library data, diff against last week, surface new angles |
| **capi-health** | Daily 06:00 | Check event match quality, alert on degradation |

---

## Part 7: Infrastructure Improvements

### 7.1 — Data Pipeline

**Current:** Direct Meta API calls → Supabase inserts (if they work)  
**Recommended:** Add Airbyte or Meltano for scheduled ETL

```
Meta Marketing API → Airbyte (scheduled sync) → Supabase/Postgres
                                                      ↓
                                              Metabase dashboards
                                              Grafana alerts
```

This gives you historical data without burning API quota on repeated insight pulls.

### 7.2 — Real-Time Alerting

**Current:** Optimizer agent runs once daily at 08:00. If a campaign burns through budget at 2 AM, you don't know until 8 AM.

**Recommended stack:**
- Meta Automated Rules API for time-critical pauses (CPA > 5× target → pause immediately)
- Grafana + Supabase for KPI dashboards with Slack alerts
- Webhook-based lead routing for instant CRM delivery

### 7.3 — Client Portal

**Current:** Reports delivered as markdown/PDF via email/Slack.

**Recommended:** Self-hosted Metabase with embedded dashboards per client. Each client gets a read-only view of their own data. No more "can you send me the numbers?" messages.

### 7.4 — Approval Workflow

**Current:** Slack-based approval (message → wait for response).

**Recommended:** Add n8n or Activepieces for structured approval flows with:
- Timeout escalation (if no response in 4 hours → escalate)
- Approval audit trail
- Multi-step approvals (budget > $1000 → requires account manager + client)

---

## Part 8: Prioritized Implementation Roadmap

### Sprint 1 (Week 1–2): Fix Critical Issues
1. Update API version to v25.0 across all tools
2. Deploy Supabase schema (6 tables)
3. Build `render_pdf.py` (Playwright)
4. Implement Ad Library scraper fallback (`scripts/meta-ad-library/`)
5. Make skills executable (start with `/audit` and `/report`)

### Sprint 2 (Week 3–4): Core Gaps
6. Build organic publishing tools (FB + IG + Threads)
7. Build `/publish` skill
8. Implement CAPI tools + `/capi-setup` skill
9. Build `/creative-intel` skill (creative fatigue detection)
10. Integrate Grafana for real-time KPI alerting

### Sprint 3 (Week 5–6): Revenue Enablers
11. Build lead management tools + `/leads` skill
12. Build catalog tools + `/catalog` skill
13. Implement Meta Automated Rules tools + `/rules` skill
14. Set up Airbyte ETL pipeline (Meta → Supabase)

### Sprint 4 (Week 7–8): Advanced Intelligence
15. Integrate Robyn for marketing mix modeling
16. Build `/attribution` skill
17. Build WhatsApp tools + `/whatsapp` skill
18. Deploy Metabase client portal
19. Implement competitor-watcher agent

### Sprint 5 (Week 9–10): Polish & Scale
20. Build n8n approval workflows
21. Creative asset DAM integration
22. All remaining agents (content-scheduler, lead-router, capi-health)
23. Multi-client load testing
24. Documentation + training materials

---

## Part 9: The Full A-to-Z Workflow (Target State)

```
PROSPECT PHASE
  /pre-audit → Public data analysis → Pitch deck

ONBOARDING
  /intake → Client profile → Per-client CLAUDE.md
  /capi-setup → Server-side tracking verified
  /catalog → Product feed connected (if e-commerce)

STRATEGY
  /audit → 3-pass baseline (organic, IG, paid)
  /audit-creative → Creative quality scoring
  /research → Competitor ad intelligence
  /audience-map → Audience architecture
  /strategy-brief → Campaign strategy (Slack approval)

EXECUTION
  /creative → Ad copy generation (5 hooks × 3 variants)
  /creative-intel → Pre-flight testing
  /launch → Campaign build (PAUSED → Slack activation)
  /publish → Organic content calendar
  /leads → Lead form setup + CRM sync
  /whatsapp → CTWA campaigns + templates

OPTIMIZATION
  /analyze → Performance deep dives
  /scale → Pause losers, scale winners
  /rules → Meta-native automated rules
  /attribution → Cross-channel budget optimization
  optimizer agent → Daily auto-actions
  creative-monitor agent → Fatigue detection
  capi-health agent → Event quality monitoring

REPORTING
  /report → Weekly client report (HTML + PDF)
  /before-after → Baseline vs. current comparison
  /monthly-review → Strategic monthly review
  reporter agent → Automated Monday delivery
  Metabase portal → Client self-serve dashboards

COMPETITIVE INTELLIGENCE
  competitor-watcher agent → Weekly Ad Library diffs
  /research → On-demand deep dives
```

---

## Part 10: Quick Wins (Do This Week)

1. **Update API version** — Change `v21.0` to `v25.0` in `meta-client.js` and `CLAUDE.md`. Takes 10 minutes, prevents future breakage.
2. **Deploy Supabase schema** — Run the migration SQL. Everything else depends on persistence working.
3. **Install Playwright** — `pip install playwright && python -m playwright install chromium`. Unblocks PDF rendering.
4. **Clone minimaxir/facebook-ad-library-scraper** into `scripts/meta-ad-library/`. Unblocks `/research` fallback.
5. **Add Advantage+ campaign support** — Update `create_campaign` tool to handle the new unified framework (three automation levers).

---

*This document should be treated as a living roadmap. Update it as sprints complete and priorities shift.*
