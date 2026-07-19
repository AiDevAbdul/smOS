# smOS — Expert Review & Gap Analysis

**Reviewer perspective:** Senior Social Media Manager + Performance-Media Lead + Marketing-Ops/Data engineer
**Date:** 2026-06-21
**Method:** 5 parallel expert audits (MCP/API, workflow chain, guardrails/agents, analytics/reporting, strategic coverage) + live 2026 best-practice research + direct code verification.
**Subject:** the full smOS workflow, end to end, evaluated as a *complete Social Media Operating System for Meta (Facebook + Instagram)*.

---

## 0. One-paragraph verdict

smOS is a genuinely impressive **Meta paid-ads automation engine** — arguably best-in-class on the buy side: 20 executable skills, 11 MCP tool modules, CAPI with proper PII hashing, Advantage+ levers, a polished pre-audit sales artifact, and a real guardrail philosophy. But it is **not yet a Social Media Operating System**, for two independent reasons. **(1) Safety is illusory:** every guardrail hook the constitution promises is silently dead — the hook matchers don't match the real tool names, *and* the executable skills bypass the MCP layer entirely by calling the Graph API directly. **(2) The pipeline doesn't actually chain:** it was validated by hand-authoring intermediate JSON for one client in a richer schema than the scripts read or write, so a fresh end-to-end run breaks at five handoffs and `/launch` produces ads with **null creative** (verified: all 15 ads in the committed `launch_plan.json` have `copy_used: null`). On top of that, the system is ~90% paid and ~0% organic/community — it has no social inbox, no content-strategy engine, no listening, no Threads, no client portal. Below is the full breakdown, prioritized.

---

## 1. CRITICAL — fix before this touches a live ad account

### C1. All guardrail hooks are silently disabled (double failure)
The constitution says *"The `naming-check` hook enforces this before any create_campaign"* and lists budget/pixel/UTM/compliance guards. **None of them ever fire.** Two compounding bugs:

1. **Matcher mismatch.** `hooks/hooks.json` matchers are `meta_create_campaign`, `meta_create_ad`, etc. The MCP server is registered as `meta`, so the real tool names are `mcp__meta__create_campaign`. The regex `meta_create_campaign` does not match `mcp__meta__create_campaign` (the literal substring never appears). *Verified.*
2. **Skills bypass MCP entirely.** Even if the matchers were fixed, the executable skills don't call MCP — `skills/launch/launch.js:330-358` and `skills/scale/scale.js:115` call `graph.post(...)` directly through `scripts/lib/meta-graph.js`. Hooks only watch MCP tool calls. *Verified.*

**Net effect:** the normal `/launch` path can create a live campaign with **no budget ceiling, no pixel-firing check, and ad copy containing restricted/policy-flagged words** — none of it stopped. The hooks are tested, wired, documented, and dead.

**Fix:** Extract the hook logic into a shared `scripts/lib/guards.js` and enforce it *inside* `meta-graph.js.post()` (the one chokepoint every skill already imports). Then also fix `hooks.json` matchers to `mcp__.*meta.*create_campaign` so the MCP path is covered too. One rule set, both paths.

### C2. The "Absolute blocks" have zero enforcement
CLAUDE.md lists never-do-without-written-instruction actions (delete any entity, increase lifetime budget on a live campaign, change objective on a running campaign, remove pixel). **None has any hook.** `scripts/lib/meta-graph.js:39` exposes a fully open `delete()` method guarded only by convention. The most safety-critical category in the whole system is unenforced.

**Fix:** In the shared `guards.js` chokepoint, hard-block `delete` and lifetime-budget/objective changes on live entities (fail-closed; allow only via explicit `SMOS_ALLOW_DELETE`-style override).

### C3. The skill chain does not actually chain — `/launch` ships null creative
The pipeline only *appears* to work on `blue-rose-auto` because a human hand-authored the intermediate JSON in a richer schema than the scripts emit/consume. On a fresh client, the handoffs break at five boundaries:

| # | Break | Producer writes | Consumer reads | Result |
|---|---|---|---|---|
| C3a | `/creative` → `/launch` | `angles[].hooks[].{hook:{text}…}` | `a.angle_id`, `a.cta[0]`, `a.descriptions[0]` | **All 15 ads `copy_used: null`** (verified) |
| C3b | `/audience-map` → `/launch` | `interest_clusters[].interests[]`, `geo.targets` | `clusters[].interest_stack`, `geo.primary` | Adsets launch with **no interest/behavior layer** (silent broad), geo → country-only |
| C3c | `research`+`audience-map` → `/strategy-brief` | `competitors`/`gaps`; `interest_clusters` | `competitorIntel.angles`; `audienceMap.clusters` | Brief gets **zero creative angles**, near-empty audience priority |
| C3d | `/intake` → everything | `accounts.page_id`, `accounts.ig_account_id` | `accounts.facebook_page_id`, `accounts.instagram_business_id` | Intake-created clients **cannot be audited or launched** (IDs resolve `undefined`) |
| C3e | `/audit` → `/before-after` | `audit_raw.json` (`organic.facebook.*`) + flat Supabase row | nested `baseline.facebook.*` + `immutable_locked_at` | The agency's signature deliverable **can never run** (always exits "no locked baseline") |

**Root cause:** no canonical schema per artifact. **Fix:** create a single `schemas/` module with one shape per handoff file (`ad_copy`, `audience_map`, `competitor_intel`, `client_profile`, `baseline_snapshot`), imported by both producer and consumer, joined on stable keys (e.g. `angle_id` present in both brief and copy). This one change eliminates C3a–C3e and H4 below at once.

### C4. Autonomous optimizer has no circuit breaker
`skills/scale/scale.js` loops over `autoActions` with no cap on how many ads it pauses or how much budget it moves per run, and `decisionFromFlag` trusts the analysis file blindly. A single garbage `performance_analysis.json` (e.g. API returns null/zero metrics → every ad reads as a CTR/ROAS breach) would **auto-pause every ad across every client**. `inBusinessHours` also fails *open* (returns true on unknown TZ or any exception).

**Fix:** run-level circuit breaker (refuse to execute if auto-actions exceed an absolute count or % of active entities without `--force`); validate metrics are non-null/plausible (spend > 0, sample size) before acting; make `inBusinessHours` fail-*closed* in autonomous mode; add a `--rollback <log>` mode.

---

## 2. HIGH — correctness, trust, and reliability

### H1. Client-facing deliverables ship with placeholders and fabricated numbers
- **Placeholder PDF shipped.** `clients/blue-rose-auto/reports/2026-06-19_weekly.{md,html,pdf}` contains `$0.00` everywhere, five literal `_(Claude to fill — …)_` markers, and the dev note `"Optimizer log will populate once Supabase is wired"` — baked into a 199 KB PDF. `report.js` has no all-null guard (unlike `before-after.js:225`, which correctly refuses to run).
- **Fabricated benchmarks.** The pre-audit headline "40:1 outspend" derives from `competitor_summary.json` "Pakistani DM Agencies (Category avg): 40 ads, 45/35/20 format mix" — invented round numbers presented as measured competitive intel. There is **no PKR benchmark table anywhere in executable code**; "Pakistani market (PKR)" appears only in docs/descriptions.
- **`market.py:538-642`** hard-codes Blue Rose Auto's entire strategy playbook (service cards, "$15-25/day", "Springfield/Eugene OR") into what is supposed to be a reusable niche template — any other client gets Blue Rose's deck.

**Fix:** Add an all-null / unfilled-`{{placeholder}}` guard to `report.js`. Build a real, cited per-niche/per-geo benchmark table (the `schema.sql` has room); degrade to "data unavailable" instead of fabricating when competitor URLs don't resolve. Never print a synthesized number as measured.

### H2. The HTML+PDF mandate is met by 1 of 5 client-facing reports
CLAUDE.md mandates every report ship HTML **and** PDF via `render_pdf.py`. Reality: only `/pre-audit` complies. `/report`, `/analyze`, `/before-after`, `/monthly-review` emit `.md` only — and `render_pdf.py` consumes **HTML**, while **no markdown→HTML renderer exists in the repo** (`report/SKILL.md:98` references one that was never built). The one weekly HTML that exists was made by an ad-hoc inline stylesheet, not the Apple design system, so reports don't even share a visual language.

**Fix:** one shared `scripts/lib/md_to_html` helper using the `report.py`/`pre_audit_report.py` design tokens, called by every report skill before `render_pdf.py`.

### H3. Metric definitions are forked across skills
- **ROAS computed 3 incompatible ways:** `analyze.js:92` (`purchase_roas` else `action_values/spend`), `report.js:84` (revenue/spend, ignores `purchase_roas`), `monthly-review.js:126` (purchase-only regex — **drops lead value** while CPA counts leads). Same account, same week → different ROAS.
- **CTR has 3 semantics** (all-click vs `inline_link_click_ctr` vs recomputed `clicks/impressions`).
- **KPI thresholds forked:** `analyze.js`/`strategy-brief.js` read flat `kpis.cpa_target`; `report.js` reads nested `kpis.leads.target_cpa`. Blue Rose uses the nested form, so `/analyze` and `/scale` silently run it against **global defaults ($50 CPA / 2.0 ROAS)** instead of the client's $35 / 1.5 — wrong pause/scale decisions.

**Fix:** one shared `deriveMetrics()` + `normalizeKpis()` used by analyze/report/monthly-review/scale.

### H4. Persistence is stubbed — 8 of 11 Supabase tables have no writer
`analyze.js` ("persistence … intentionally deferred"), `report.js` ("once Supabase is wired"), before-after/monthly-review write local JSON only. Only `persist.py` writes (3 tables), and it has a bug: `persist.py:97` sets `category_count` from a `"categories"` key that `market.py` never emits → always 0. `daily_metrics` is never populated, so the optimizer's history-based rules (3-consecutive-day ROAS scaling) **cannot function**, and the CLAUDE.md "never re-fetch" token rule is false — every run re-hits Meta.

**Fix:** wire the REST writes the SKILLs describe (clients, baseline_snapshots, daily_metrics, optimizer_log, reports, strategy_briefs, ad_copy), or drop the token-efficiency claims that depend on stored data. Fix the `persist.py` key mismatch.

### H5. `/launch` cannot build the warm/LAL funnel
`launch.js:147-149` hard-codes `custom_audiences: [{ id: "<TBD_...>" }]` for every retargeting/lookalike adset — a literal invalid ID Meta will reject on `--execute`. Nothing resolves audience-map RT/LAL specs into real custom-audience IDs (no creation, no lookup). The entire warm half of the funnel can't launch.

**Fix:** add an audience-resolution/creation pass (wire `/audience-map` to create custom audiences and store their IDs for the brief/launch to reference).

### H6. Page & Instagram Insights are broken on today's API
`mcp/meta-server/tools/page-insights.js` defaults include metrics deprecated **before today**: FB `page_fans`/impression metrics (deprecated for all versions as of June 15 2026) and IG `profile_views`/`website_clicks` (deprecated Jan 2025), plus IG account metrics now require `metric_type=total_value`. `/audit` and `/before-after` baselines will hard-error.

**Fix:** migrate to the post-2026 metric names; add `metric_type` handling. (Sources: Graph v25 changelog, Meta Page Insights API updates Aug 2025, IG insights deprecation Apr 2025.)

### H7. Missing `appsecret_proof`
`META_APP_SECRET` is loaded but never used. Meta requires `appsecret_proof = HMAC-SHA256(token, app_secret)` on every call when "Require App Secret for Server API calls" is on — standard for server/CAPI apps. If a client enables it, **100% of calls fail**.

**Fix:** compute once in the client and append to params.

### H8. Slack→Discord migration is half-done — approval gate may silently no-op
Runtime is Discord (`plugin.json`, `connectors.json`, `post-launch.js`), but `agents/optimizer.md`, `agents/reporter.md` (incl. their frontmatter descriptions), and most `skills/**/SKILL.md` still say "Slack." An autonomous agent told to "post to Slack" with no Slack connector will no-op — meaning the **manual approval request never arrives and the human never sees it**, while the gate believes it asked. Stray `slack_message_ts` also persists in the strategy_brief schema.

**Fix:** global Slack→Discord replace across `agents/*.md` + `skills/**/SKILL.md`; reconcile each agent's frontmatter with its body; scrub `slack_message_ts`.

### H9. Scheduler timezone / concurrency / logging gaps
- Optimizer cron is `0 8 * * *` **server (UTC)** time, not "08:00 client timezone" as documented; multi-TZ clients get optimized at the wrong local hour (some skipped entirely).
- No `flock` in `run-agent.sh` → concurrent runs (cron + manual) double-pause/double-scale the same accounts; reporter's "never send twice" check-then-write isn't atomic → duplicate client emails.
- `install-crons.sh` ignores declared `timeout_minutes` (a hung `claude` blocks forever).
- `run-agent.sh:41` redirect is `2>&1 >> log` (wrong order) → **stderr never reaches the log**; no exit-code check.

**Fix:** per-TZ cron buckets (or document the limitation), `flock`, `timeout ${MINUTES}m` wrapper, fix redirect to `>> log 2>&1`, check exit codes.

---

## 3. MEDIUM — robustness & API correctness

- **No retry/backoff/pagination in the MCP layer.** `meta-graph.js` has a `paginate()` helper but **no MCP tool uses it** — `get_campaigns`, `get_custom_audiences`, `get_rules`, etc. silently return only the first page. The MCP client (`meta-client.js`) has no timeout, no 429/rate-limit retry. Two divergent clients (`meta-client.js` vs `meta-graph.js`) should be unified on the better one.
- **`search_interests` is broken** (`audiences.js:124`): uses deprecated `GET /search?type=adinterest` and discards the required `ad_account_id`; should hit `/act_{id}/targetingsearch`.
- **`upload_image` advertises base64 but only supports URL** (`ads.js`); dead `FormData`/`axios` imports. No video-upload tool exists (`/advideos`), so **video ads can't be built end-to-end** despite `create_ad_creative` accepting a `video_id`.
- **PAUSED default is schema-only** (advisory JSON-Schema `default`, not injected). `create_adset` doesn't default status in code at all. Make PAUSED an explicit code-level default on campaign/adset/ad.
- **No token-expiry handling** (code 190): the "never sleeps" agents fail silently after ~60 days. **Single global page token** (`publishing.js`, `leads.js`) is wrong for a multi-client agency — needs per-client page tokens.
- **Conversational UX is clunky** for `intake`, `creative`, `audit-creative`: operator must hand-edit JSON (fill empty strings / null `vision_scores`) and re-run a second command. `audit-creative` emits vision prompts but nothing feeds images to Claude — a manual copy-paste loop. Needs a draft→fill→lint wrapper that runs the Q&A / vision pass in-conversation.
- **Routing table omits 6 shipped skills:** `publish`, `capi-setup`, `catalog`, `leads`, `rules`, `creative-intel` exist but aren't in CLAUDE.md — operators won't discover them.
- **No statistical significance** on `/scale`'s "duplicate winners" / `/analyze`'s ROAS ranking — scaling on small samples is noise. `analyze.js:208` frequency pause has no min-spend floor (a 5-impression ad can flag).
- **Documented-not-built:** `ANOMALY_spend_spike` is in `analyze/SKILL.md:53` but never implemented in `analyze.js`.

---

## 4. STRATEGIC GAPS — what's missing to be a *complete* Meta SMOS

Benchmarked against 2026 best practices and the leading platforms (Sprout, Hootsuite, Later, Metricool, Brandwatch, AgencyAnalytics). smOS is ~⅔ of an OS; the missing third is the half those platforms are built around.

| Theme | Severity | Gap |
|---|---|---|
| **Organic / Content** | 🔴 Critical | `/publish` *runs* a calendar but nothing *generates* one. No content-pillar planner, no Reels-first cadence, no social-SEO (keyword-first captions now drive ~30% more reach and are Google-indexed). No **Threads** (Meta's fastest-growing surface, ~450M MAU, API-ready). No Broadcast Channels / private-audience strategy. |
| **Community / Engagement** | 🔴 Critical | **No social inbox** — table-stakes everywhere. smOS can hide/delete comments but cannot read+reply to DMs/comments/mentions in one queue, assign, or use saved replies. No DM/conversation engagement loop, despite DM depth now being a direct ranking signal *and* the conversion path. A "social OS" that can't do community management isn't one. |
| **Listening / Intelligence** | 🟠 High | No mention/keyword/sentiment monitoring, share-of-voice, or crisis alerts. Competitor tracking is **ads-only** (Ad Library) — no organic competitor benchmarking (follower growth, cadence, engagement). |
| **Paid / Advertising** | 🟡 Medium | Strongest area; gaps are refinements. Measurement still last-click — no incrementality/Conversion Lift (Meta's new "Incremental Attribution" column); `/attribution` MMM unbuilt. No GenAI creative (Advantage+ Creative image/video) and **no AI-content disclosure flag (a live ad-rejection cause since March 2026)**. No Opportunity Score ingestion (free signal, ~5% lower cost-per-result). No WhatsApp/CTWA. A/B Test API, Dynamic Creative (DCO), and richer insight breakdowns absent. |
| **Analytics / Attribution** | 🟠 High | No client portal / white-label self-serve dashboards (the clearest agency differentiator — every "send me the numbers" is manual). No cross-channel (organic+paid) dashboard. No LTV/cohort, no pacing/forecasting, no versioned benchmark library. |
| **Creative / Production** | 🟠 High | No DAM/asset library (versioned, tagged, reusable). No video/Reel production pipeline or hook-rate/retention-curve analysis. No GenAI image/video generation (copy only). |
| **Client / Agency Ops** | 🟠 High | Approval = a single Discord ping; no multi-stage/client-facing approval, timeout escalation, or audit trail. No roles/permissions. No structured client-comms cadence (kickoff, QBR) beyond the weekly report. No landing-page/CRO review (ads drive to pages the system never evaluates). Zero tests. |

### Top 10 additions to become a complete Meta SMOS (prioritized)
1. **Unified Social Inbox** (FB/IG comments + DMs + mentions; read+reply, assign, saved/AI replies) — biggest table-stakes gap.
2. **Organic Content Strategy Engine** (`/content-plan`: pillars + Reels-first calendar → existing `/publish`).
3. **DM / conversation engagement loop** (comment→DM, first-hour reply SLA, conversation-depth tracking).
4. **Threads support** (`create_threads_post` + scheduling + insights).
5. **Client Portal + white-label reporting** (per-client read-only dashboards blending organic + paid).
6. **Social-SEO layer** (keyword-first captions + alt-text baked into `/creative` and `/publish`).
7. **Incrementality / Conversion Lift in reporting** (build `/attribution`; shift narrative off last-click).
8. **GenAI creative + AI-disclosure compliance** (Advantage+ Creative; mandatory disclosure flag in launch).
9. **Social listening (phase 1)** + organic competitor benchmarking.
10. **Real approval workflow + DAM** (multi-stage/client approval w/ escalation; tagged, versioned asset library).

**Quick wins (cheap, high value):** add the **AI-content disclosure flag** (one field; live rejection cause), ingest **Opportunity Score** into `/analyze`, and add the 6 missing skills to the routing table.

---

## 5. Recommended sequencing

**Phase 0 — Stop the bleeding (do before any live spend):** C1 (unify guards into `meta-graph.js`), C2 (block destructive ops), C4 (optimizer circuit breaker + bad-data validation). These are pure safety and small.

**Phase 1 — Make the engine honest:** C3 (canonical `schemas/` module — fixes the whole chain incl. null creative), H1 (no placeholder/fabricated deliverables), H3 (one `deriveMetrics`/`normalizeKpis`), H4 (persistence), H5 (audience resolution), H6 (insights API fix). After this, the paid pipeline actually works end-to-end on a *new* client.

**Phase 2 — Earn the "OS" label:** the organic + community + client-facing layer — social inbox, content engine, Threads, client portal (strategic gaps 1–5).

**Phase 3 — Differentiate:** listening, incrementality/attribution, GenAI creative, DAM, real approval workflows.

---

## 6. What's genuinely strong (keep)
- CAPI module with correct SHA-256 PII hashing — the best-written code in the repo.
- The pre-audit sales artifact (`pre_audit_report.py`) — conic gauge, weighted dimensions, print CSS; a real deliverable.
- Ad Library competitive engine (scrape/classify/diff/creatives/market).
- PAUSED-by-default + archive-not-delete *philosophy* (now make it enforced, per C1/C2).
- Secrets hygiene — no hardcoded tokens; `.env` 600-perm, relocated out of repo, correctly gitignored.
- API version discipline — everything is on v25.0 (the gap-spec's "client.py still on v21" claim is stale; it's v25.0).
- Claude-native architecture — a latent strength the system under-exploits for *strategic* (not just task) intelligence.

---

*Findings verified by direct inspection: `launch_plan.json` (15/15 `copy_used: null`), `hooks.json` matchers vs `graph.post` call sites in `launch.js`/`scale.js`. Best-practice claims cited from Meta Graph v25 changelog, Meta engineering (Andromeda), and platform docs (Sprout/Hootsuite/Later/Brandwatch/AgencyAnalytics) gathered during the audit.*
