# smOS v2 — Gap Spec & Implementation Plan

**Date:** 2026-06-21
**Source:** Audit of repo vs. `smOS_Strategic_Roadmap.md` (Jun 19, 2026)
**Status:** Spec — work begins on Sprint 1 below.

---

## Part A — Status Snapshot

### Done since roadmap

- **API v25.0** in `mcp/meta-server/meta-client.js` and `scripts/lib/meta-graph.js`.
- **`scripts/render_pdf.py`** present (Playwright Chromium).
- **`scripts/meta-ad-library/`** populated: `client.py`, `analyzer.py`, `classifier.py`, `differ.py`, `persist.py`, `report.py`, `pre_audit_report.py`, `creatives.py`, `market.py`.
- **14 skill specs** present under `skills/`.
- **4 agents** present: `auditor`, `creative-agent`, `optimizer`, `reporter`.
- **7 guardrail hooks** present: `budget-guard`, `creative-compliance`, `naming-check`, `pixel-check`, `post-launch`, `utm-enforcer`.

### Partial / inconsistent

- **Ad Library scraper still on v21.0** — `scripts/meta-ad-library/client.py:6` (`API_BASE = ".../v21.0/ads_archive"`).
- **Skills executable status** — ✅ 20/20 done. All v1 specs ported (audit, report, analyze, scale, before-after, strategy-brief, launch, intake, audience-map, creative, research, audit-creative, monthly-review) + 6 new v2 skills (publish, capi-setup, creative-intel, rules, leads, catalog).
- **Supabase schema** — `scripts/schema.sql` exists; deployment status unverified.

### Not started (mapped to roadmap)

| # | Area | Roadmap § | Sprint |
|---|---|---|---|
| G1 | Organic publishing tools (`create_page_post`, `create_ig_media`, `create_threads_post`, `moderate_comments`) + `/publish` | 2.1 | 2 |
| G2 | Conversions API (`send_capi_event`, `get_event_match_quality`, offline conv) + `/capi-setup` | 2.2 | 2 |
| G3 | Product catalog + dynamic ads + `/catalog` | 2.3 | 3 |
| G4 | Lead management (`create_lead_form`, `get_leads`, webhooks) + `/leads` | 2.4 | 3 |
| G5 | WhatsApp / CTWA + `/whatsapp` | 2.5 | 4 |
| G6 | Meta Automated Rules API + `/rules` | 2.6 | 3 |
| G7 | MMM / attribution (Robyn / Meridian) + `/attribution` | 2.7 | 4 |
| G8 | Creative intelligence (fatigue, AdTestPro pre-flight) + `/creative-intel` | 2.8 | 2 |
| G9 | Advantage+ unified framework in `create_campaign` (3 automation levers) | §1, Quick Win 5 | 1 |
| G10 | Custom Audience CLCA cert (`is_sac_cfca_terms_certified`) for v22+ | §1.1 | 1 |
| G11 | Airbyte / Meltano ETL → Supabase | 7.1 | 3 |
| G12 | Grafana / Metabase dashboards + alerts | 7.2–7.3 | 2 / 4 |
| G13 | n8n approval workflows | 7.4 | 5 |
| G14 | Agents: content-scheduler, lead-router, creative-monitor, competitor-watcher, capi-health | Part 6 | 4–5 |
| G15 | DAM (UnoPim) for creative assets | 3.9 | 5 |

---

## Part B — Implementation Plan

### Sprint 1 — Foundation

Smallest set that unblocks every later sprint.

| Task | File(s) | Acceptance |
|---|---|---|
| **1.1** Bump Ad Library scraper to v25.0 | `scripts/meta-ad-library/client.py` | `API_BASE` is `.../v25.0/ads_archive`; a pre-audit run succeeds end-to-end |
| **1.2** Verify Supabase schema deployed | `scripts/schema.sql` + Supabase | All 6 tables exist; missing ones migrated |
| **1.3** Verify pilot pattern + extend | `skills/audit/audit.js`, `skills/report/report.js` exist. Confirm end-to-end on `blue-rose-auto`. | Run `node skills/audit/audit.js blue-rose-auto` to a clean exit with `audit_raw.json` + filled `audit_report.md`. Pattern then ports to the remaining 11 skills in Sprint 1.6 / Sprint 2. |
| **1.6** Build executables for high-traffic skills | new `skills/analyze/analyze.js`, `skills/scale/scale.js`, `skills/before-after/before-after.js` | Each accepts `{slug}`, fetches metrics via `scripts/lib/meta-graph.js`, persists, renders MD + PDF. Same shape as `audit.js`. |
| ~~**1.4** Advantage+ levers~~ ✅ | `tools/campaigns.js:48-51`, `tools/adsets.js:56-66,137-147` | Already shipped — `is_advantage_plus_shopping` on campaign + `advantage_plus`/`targeting_automation` levers on adset |
| ~~**1.5** CLCA cert flag~~ ✅ | `tools/adsets.js:52-55,160-166` | Already shipped — throws if `custom_audiences` set without `is_sac_cfca_terms_certified` |

**Exit criteria:** one client audited end-to-end with executable code, schema persists results, new campaigns create cleanly under v25 Advantage+.

### Sprint 2 — Organic + Tracking + Creative Intel

- ~~**G1** publishing MCP tools~~ ✅ `mcp/meta-server/tools/publishing.js` — `create_page_post`, `create_ig_media`, `create_ig_carousel`, `moderate_comments`. Wired into `index.js`.
- ~~**G1** `/publish` skill~~ ✅ `skills/publish/{SKILL.md,publish.js}` — reads `content_calendar.json`, dispatches FB/IG/carousel, atomic calendar rewrite, IG 100/day limit aware, FB native scheduling.
- ~~**G2** CAPI MCP tools~~ ✅ `mcp/meta-server/tools/capi.js` — `send_capi_event` (auto SHA-256 PII hashing), `get_event_match_quality`, `upload_offline_conversions`. Wired into `index.js`.
- ~~**G2** `/capi-setup` skill~~ ✅ `skills/capi-setup/{SKILL.md,capi-setup.js}` — inspects pixel events, server-side share per event, dataset advanced matching; optional `--test-event TEST<code>` fires a verification event.
- ~~**G8** `/creative-intel` skill~~ ✅ `skills/creative-intel/{SKILL.md,creative-intel.js}` — per-ad 30d daily insights, 4-tier fatigue classification, spend-weighted refresh queue.
- **G12 (partial)** Grafana → Supabase, two panels: spend pacing and CPA-by-campaign with Slack webhook alerts. Pending.

### Sprint 3 — Revenue Enablers

- ~~**G3** Catalog tools~~ ✅ `mcp/meta-server/tools/catalog.js` — 6 tools: `create_catalog`, `get_catalogs`, `upload_product_feed`, `get_product_items`, `create_product_set`, `get_product_sets`.
- ~~**G3** `/catalog` skill~~ ✅ `skills/catalog/{SKILL.md,catalog.js}` — local validation against Meta's required fields, batched `items_batch` upload, modes: list/create/sync/feed/items/sets.
- ~~**G4** Lead tools~~ ✅ `mcp/meta-server/tools/leads.js` — 6 tools: `create_lead_form`, `get_lead_forms`, `get_lead_form`, `get_leads`, `get_lead`, `subscribe_lead_webhook`.
- ~~**G4** `/leads` skill~~ ✅ `skills/leads/{SKILL.md,leads.js}` — per-form delta sync, quality scoring (disposable email / phone-repeat / lowercase-junk / etc), append-only JSONL + CSV export.
- ~~**G6** Automated Rules tools~~ ✅ `mcp/meta-server/tools/rules.js` — 6 tools: `create_automated_rule`, `get_rules`, `get_rule_history`, `preview_rule`, `update_rule`, `delete_rule`. Wired into `index.js`.
- ~~**G6** `/rules` skill~~ ✅ `skills/rules/{SKILL.md,rules.js}` — 5 standard guardrail templates (PAUSE_RUNAWAY_CPA, PAUSE_LOW_CTR_LIVE, PAUSE_HIGH_FREQ, NOTIFY_BUDGET_OVERRUN, NOTIFY_ZERO_DELIVERY) + modes: list/install/preview/disable/enable/history.
- **G11** Meltano `tap-facebook` → Supabase on 6h cadence. Pending.

### Sprint 4 — Advanced Intelligence

- **G7** Robyn MMM + `/attribution` (budget reallocation recommendation).
- **G5** WhatsApp + CTWA + `/whatsapp`.
- **G12 (full)** Metabase client portal — per-client read-only dashboards.
- **G14 (partial)** Agents: `content-scheduler` (daily 07:00), `creative-monitor` (daily 10:00), `capi-health` (daily 06:00).

### Sprint 5 — Polish & Scale

- **G13** n8n approval flows (timeout escalation, audit trail, multi-step approvals for > $1000 budget moves).
- **G15** UnoPim DAM for client creative libraries.
- **G14 (rest)** Agents: `lead-router` (webhook real-time), `competitor-watcher` (weekly Monday).
- Multi-client load testing, docs, training.

---

## Part C — Open Decisions

1. ~~Skill executable language~~ — **Decided: Node.js** (matches existing `skills/audit/audit.js`, `skills/report/report.js`, `scripts/lib/meta-graph.js`, hooks, MCP). Python remains only for Ad Library scraping + PDF render.
2. **Airbyte vs. Meltano** — Recommendation: **Meltano + `tap-facebook`** until a second source is added.
3. **MMM tool** — Robyn vs. Meridian. Defer to a Sprint 4 spike before committing.

---

## Part D — Remaining Tasks (as of 2026-06-21)

All 20 skills are executable. Outstanding work falls into three buckets:

### Blocked on external action

| # | Task | Blocker | Action |
|---|---|---|---|
| **B1** | 1.2 Verify Supabase schema deployed | User to run SQL check and paste result | Paste table list from Supabase → confirm 11 tables present |
| **B2** | 1.3a End-to-end audit run on blue-rose-auto | `accounts.*` IDs all `TBD_*` | User to populate `client_profile.json` with real Meta IDs |
| **B3** | Sprint 1 exit criterion: clean Advantage+ create | Same as B2 | Depends on B2 |
| **B4** | Hooks fire on executable skills | Direct Graph calls bypass MCP hooks | Decision: keep dry-run defaults OR Claude-driven launches via MCP |

### Sprint 3 carryover (not skill scope)

| # | Task | Spec | Est |
|---|---|---|---|
| **G11** | Meltano `tap-facebook` → Supabase ETL on 6h cadence | Roadmap 7.1 | 1 day setup + cron |
| **G12 (partial)** | Grafana → Supabase: spend pacing + CPA-by-campaign panels + Slack webhook alerts | Roadmap 7.2 | 0.5 day |
| **Persistence wiring** | audit / analyze / scale skills write to Supabase tables | Deferred from B1 | 0.5 day after B1 |

### Sprint 4 — Advanced Intelligence

| # | Task | Spec | Notes |
|---|---|---|---|
| **G7** | Robyn (or Meridian) MMM + `/attribution` skill | Roadmap 2.7 | Spike both before committing |
| **G5** | WhatsApp + CTWA + `/whatsapp` skill + MCP tools | Roadmap 2.5 | Requires WhatsApp Business API access |
| **G12 (full)** | Metabase client portal — per-client read-only dashboards | Roadmap 7.3 | Depends on G11 ETL |
| **G14a** | `content-scheduler` agent (daily 07:00) — picks tomorrow's posts from calendar, queues via `/publish` | Roadmap Part 6 | Cron-style |
| **G14b** | `creative-monitor` agent (daily 10:00) — runs `/creative-intel`, files refresh tickets | Roadmap Part 6 | Cron-style |
| **G14c** | `capi-health` agent (daily 06:00) — runs `/capi-setup`, alerts on EMQ drop | Roadmap Part 6 | Cron-style |

### Sprint 5 — Polish & Scale

| # | Task | Spec | Notes |
|---|---|---|---|
| **G13** | n8n approval workflows — timeout escalation, audit trail, multi-step for > $1000 moves | Roadmap 7.4 | Self-hosted n8n |
| **G15** | UnoPim DAM for client creative libraries | Roadmap 3.9 | Optional — folder + Supabase may suffice |
| **G14d** | `lead-router` agent (webhook real-time) | Roadmap Part 6 | Event-driven, not cron |
| **G14e** | `competitor-watcher` agent (weekly Monday) — runs `/research`, diffs against prior snapshot | Roadmap Part 6 | Cron-style |
| **Polish** | Multi-client load testing, docs, training videos | — | Pre-handoff |

### Cross-cutting tech debt

- **PDF rendering coverage** — `before-after.js`, `monthly-review.js`, `analyze.js` write `.md` but don't call `scripts/render_pdf.py` yet. CLAUDE.md says every report ships HTML + PDF.
- **Hook coverage gap** — naming-check / budget-guard / pixel-check / creative-compliance / utm-enforcer only fire on MCP tool calls. Skills running `--execute` re-implement what they can inline; the gap is unannounced.
- **Conversational skill UX** — `intake`, `creative`, `audit-creative` need a wrapper that walks Claude through draft → fill → lint cleanly. Today the user runs two commands manually.
- **Test coverage** — zero. Every skill is verified by hand-running on blue-rose-auto.

---

*Update this doc as sprints close. Pin sprint exit dates once Sprint 1 starts.*
