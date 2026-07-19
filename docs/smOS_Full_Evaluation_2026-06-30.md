# smOS — Full System Evaluation & Improvement Plan
**Date:** 2026-06-30 · **Evaluator perspective:** Senior performance-media + organic strategist and staff engineer reviewing smOS as the engine for a full-time social media marketing agency (paid + organic, sales, leads, delivery).
**Method:** Five parallel domain audits (paid media, organic/content, agency business, zero-start brand, engineering/infra). Every claim below was checked against actual files — SKILL.md bodies, companion scripts, schemas, hooks, and the test suite (run live). This is an evidence-based review, not a read of the marketing prose.

---

## 1. Overall verdict

**Overall score: 6.5 / 10.**

smOS is a genuinely impressive, *real* system — not aspirational documentation. The engineering spine is production-grade: a single guarded Meta Graph chokepoint (v25.0, correct retry/backoff, `appsecret_proof`), statistically-gated auto-optimization (Wilson lower bound, two-proportion z-tests), a fail-closed approval state machine, schema validation that prevents real handoff-drift bugs, and a 256-test suite that passes 256/256 in a writable environment. The commercial spine (CRM → proposal → contract → won → Stripe invoice → report) is coherent, validated, and honest about its edges. The brand-layer human gates (positioning, name, logo) are verifiably fail-closed in code, not prose.

What holds it back from being a complete full-time-agency OS is three recurring patterns:

1. **The paid engine runs Meta the way a top agency ran it in ~2022, not 2026.** It is fundamentally an ABO / interest-stacking / manual-placement machine and largely misses the Advantage+ era (ASC, Advantage+ Audience, automatic placements) and structured creative-volume testing — the two highest-leverage levers today.
2. **The organic side is a high-quality scheduler + inbox aggregator marketed as a full organic OS.** The content *production* layer and the *strategic intelligence* layer it routes to (14 skills) do not exist in the plugin. Sentiment, listening depth, and an analytics feedback loop are schema-only or absent.
3. **Doc-vs-reality drift erodes trust.** CLAUDE.md routes to skills that aren't there, claims an `error_log` table nothing writes to, claims "FB Reels automated" with no FB-video code, and claims "Social-SEO captions" from a library that's never imported. The brand layer's visual/social skills record asset *paths* but generate no actual image bytes.

None of this is rot. It's a well-architected ~75%-built system whose *substance* lags its *scaffolding* in the two areas that matter most for selling and delivering modern social media services.

### Scorecard by domain

| Domain | Score | One-line summary |
|---|---|---|
| Paid Media engine | **6.5 / 10** | Excellent engineering & safety; strategy is ~2-3 yrs behind (no Advantage+, no creative-testing loop, a live launch budget bug). |
| Organic & Content engine | **5.5 / 10** | Strong FB/IG publisher + great knowledge base, but content production & intelligence layers are missing/aspirational. |
| Agency Business layer | **7.5 / 10** | Real, validated win-and-bill spine; thin on retention economics (subscriptions, churn/health, margin, capacity). |
| Zero-Start Brand layer | **7.0 / 10** | Senior-grade gating & API honesty; but visual/social produce metadata, not actual assets. |
| Engineering & Infra | **7.5 / 10** | Guarded chokepoint, real stats, passing tests; gaps in multi-client token isolation, input validation, CI, observability. |

*Weighting used: Paid 25% · Organic 20% · Business 20% · Engineering 20% · Brand 15%, with a small cross-cutting deduction for system-wide doc/reality drift.*

---

## 2. What is genuinely strong (keep and build on)

- **The guarded write chokepoint.** Both the MCP runtime and skill scripts route every Meta mutation through one `guardGraphWrite()` in `scripts/lib/meta-graph.js`. Verified by execution: a bad campaign name throws through the MCP client. This is the right foundation and rare in agent tooling.
- **Statistical discipline before spending money.** `scripts/lib/stats.js` + `opportunity.js` mean `/scale` won't crown a winner on 2 conversions or call fatigue on 80 impressions. `/scale` safety (circuit breaker, impression floor, business-hours fail-closed, $500 ceiling, rollback) is exemplary.
- **API-deprecation currency.** Skills correctly avoid `page_fans`/legacy `CONVERSIONS`, use IG `views`/`reach`, page tokens for `/posts`, and reflect real 2025-26 API knowledge.
- **The commercial spine is real and honest.** Stripe, Dropbox Sign, and Supabase calls are genuine HTTP, each fail-closed to a manual fallback that never claims a send it didn't make. Schema gates block illegal states (`won` without a proposal; invoice totals that drift from line items).
- **The brand human-gates are verifiably fail-closed.** Empirically confirmed: `brand-visual`/`brand-book`/`brand-social` halt with exit 3 when the prior gate timestamp is unset, enforced both at skill entry and in `schemas/brand_profile.js`.
- **`platform-specs.md` and the content cheatsheet** reflect 2026 algorithm reality better than most working agencies' internal docs.

---

## 3. The gaps that matter most (prioritized)

### Tier A — Correctness & trust (fix first; these undermine everything above them)

1. **Launch double-budget bug.** `skills/launch/launch.js` sets `daily_budget` on *both* the campaign and the ad set. With campaign budget optimization on, Meta rejects an ad-set budget — a real `--execute` would fail or double-spend. Choose CBO **or** ABO per `brief.budget_mode`; never both.
2. **Missing `targeting_automation.advantage_audience` flag.** `buildTargeting()` emits raw interest specs with no Advantage+ Audience decision. Meta now requires this on most ad sets; omitting it means the engine isn't speaking the current targeting API.
3. **Multi-client token isolation is bypassed on the runtime path.** `tokens.js` exists and is tested but is **not imported by any MCP organic tool** — `publishing.js`, `inbox.js`, `leads.js`, `threads.js` read the global `META_PAGE_TOKEN` directly. In a multi-client agency this can post/reply to the **wrong client's page**. This is the single most dangerous defect for agency use.
4. **Doc-vs-reality drift.** CLAUDE.md routes to 14 skills that don't exist (`social`, `facebook-posts`, `linkedin-posts`, `video-shorts`, `remotion`, `marketing-psychology`, `customer-research`, `ab-testing`, `content-strategy`, `keyword-research`, `social-media-trends-research`, `competitor-profiling`, `firecrawl-deep-research`, `ui-ux-pro-max`). `platform-specs.md` says "FB Reels ✅ automated" with no FB-video code. `content-plan` claims Social-SEO captions but never imports `social_seo.js`. CLAUDE.md claims a Supabase `error_log` nothing writes to. Either build these or stop promising them.
5. **Guards don't fail-closed on malformed input at the chokepoint.** `checkNaming('create_campaign', {})` and `checkBudget(..., {daily_budget:'abc'})` both return `ok:true` (missing name / NaN budget pass). Add strict type/presence validation at the chokepoint.
6. **No CI.** A 256-test suite exists and passes, but nothing runs it on commit — guard regressions can land silently.

### Tier B — Highest-leverage capability gaps (this is what makes it a 2026 agency engine)

7. **No Advantage+ Shopping/Sales (ASC) path.** Zero references anywhere. ASC is the default e-commerce workhorse in 2026; the engine can only build manual campaigns. Biggest single strategic gap on the paid side.
8. **No structured creative-testing framework.** There's vision QA, copy generation, and fatigue detection, but no skill that runs a concept × hook × format test matrix with win-criteria and an iteration loop. Performance in 2026 is won at creative volume — this is the missing growth engine.
9. **No content *production* engine.** `content-plan` emits a calendar with placeholder captions and hands off to skills that don't exist. There is no code that turns a calendar item into finished, platform-native, spec-compliant copy or short-form video. A "Reels-first" mandate with zero video production capability.
10. **No recurring-revenue automation.** `billing.js` issues one manual invoice per client per month — no Stripe Subscriptions, no scheduled auto-issue, no webhook reconciliation (so `mark-paid` is manual and portal balances drift from reality). An agency cannot hand-run billing for every client every month.
11. **No client-health / churn / renewal / margin model.** Retention economics — the #1 driver of agency profitability — is essentially unmodeled. No health score, no renewal alerting, no cost-to-serve or per-client margin, no capacity/utilization layer.
12. **No real brand-asset generation.** `brand-visual`/`brand-social` record logo/cover/template *paths*; no renderer produces the actual images. A brand-new client finishing the flow has a validated profile pointing at files that may not exist. WCAG AA contrast is cited but never computed.
13. **Sentiment & listening intelligence is schema-only.** `inbox_item.js` and `listening_snapshot.js` have `sentiment` fields nothing populates. "Listening" captures only self-tagged IG mentions — no untagged-mention, keyword, cross-platform, share-of-voice, or crisis detection.

### Tier C — Scale, economics & polish

14. **No account-level economics (MER / nCAC / margin-aware target ROAS)** in `/analyze` and `/report` — everything is per-adset, not how a media director steers.
15. **No organic analytics feedback loop** — post-level Insights aren't rolled up, no best-time-to-post learning, no pillar-performance attribution feeding the next plan.
16. **No agency-side ops dashboard** (MRR, net revenue retention, churn, AR aging, pipeline velocity, capacity) — the operator reads raw CRM JSON.
17. **Measurement spine has two endpoints and no middle** — `capi-setup` verifies firing and `attribution` reads a lift study, but nothing tracks Event Match Quality over time or reconciles modeled vs. observed conversions.
18. **Polish:** hardcoded single-number US benchmarks in `/pre-audit`; over-broad single-flag DELETE guard; no durable `error_log`/observability; thumbnail-only video scoring in `audit-creative`; `.com`-only domain screening; duplicate live-secret `.env` in `mcp/meta-server/`; multi-platform calendar is Instagram-only; no content approval workflow or asset rights/expiry tracking.

---

## 4. Improvement roadmap

A sequenced plan to take smOS from a strong foundation (6.5) to a defensible full-time-agency OS (target 8.5+). Phases are ordered by dependency and leverage, not just severity.

### Phase 0 — Stop the bleeding (Week 1-2) → unblocks safe live operation
- Fix the `launch.js` double-budget bug (CBO/ABO branch on `brief.budget_mode`).
- Add `targeting_automation.advantage_audience` to `buildTargeting()` (default `1` for prospecting).
- Route all MCP organic tools (`publishing`, `inbox`, `leads`, `threads`) through `tokens.js` with the client slug; add a regression test for the wrong-client global-fallback.
- Make the chokepoint fail-closed on missing name / non-finite budget.
- Reconcile docs with reality: either build or remove the 14 phantom routes; flip "FB Reels automated" to "not built"; wire `social_seo.js` into `content-plan` or drop the claim; implement the `error_log` writer or delete the claim.
- Add GitHub Actions CI running `npm test` + `node --check` on hooks; remove the duplicate `mcp/meta-server/.env`.

### Phase 1 — Modernize the paid engine (Week 3-6) → biggest performance leverage
- Add an **Advantage+ Shopping/Sales path**: new branch in `strategy-brief` + `launch` that builds an ASC campaign (existing-customer budget cap, catalog/creative attach) as the default for healthy-pixel e-commerce clients; demote the manual ABO tree to fallback.
- Switch default placements to **Advantage+ / automatic**; keep manual only as explicit override.
- Reframe `/audience-map` around **broad + Advantage+ Audience first**, with interest clusters as seeds/exclusions and lookalikes as one input.
- Ship **`/creative-test`**: concept × hook × format matrix, Dynamic/Advantage+ Creative enrollment, win-criteria reusing `stats.js`, iteration loop feeding `/creative`.
- Extend `audit-creative` to score the first-3s hook + retention, not the thumbnail.

### Phase 2 — Build the organic substance (Week 5-9, parallelizable)
- Build at least one real **content-production skill** (FB/IG native: turns a plan item + pillar into finished, spec-compliant, keyword-first copy; actually imports `social_seo.js`).
- Add **FB Reels + FB video + IG Stories** to `publish.js`; pre-check `/content_publishing_limit`.
- Add a **sentiment + intent classifier** to `inbox` and `listening`; actually generate `draft_reply` copy; triage by urgency.
- Make `content-plan` **multi-platform and cadence-aware** (read `platform-specs.md` cadence rules; derive pillars from VOC/listening, not a hardcoded 4).
- Add an **organic analytics loop** (roll up post-level Insights → `daily_metrics`/`assets`, attribute by pillar, learn best-time-to-post).
- Add a **content approval workflow** (draft → review → client-approved gating `/publish`) and asset rights/expiry tracking.

### Phase 3 — Make it a real business, not just a campaign tool (Week 7-11)
- Add **Stripe Subscriptions** + scheduled monthly auto-issue + a **webhook reconciler** (auto-flip paid/void, dunning, AR aging).
- Add a **client-health + renewal layer**: capture engagement-start/term-end/renewal dates; compute health from `monthly-review` trends; emit "renewal due" and "at-risk" alerts in `crm next`.
- Add **margin / cost-to-serve** fields and a **capacity/utilization** layer (turn `deal.owner` into a real roster with load limits).
- Build an **agency ops dashboard** (MRR, NRR, churn, AR aging, pipeline velocity, capacity) — sibling to `/portal`, with tokenized/authenticated links.
- Add **account-level economics** (blended MER, margin-aware target ROAS, nCAC) to `/analyze` and `/report`.

### Phase 4 — Brand production + measurement depth + polish (Week 10-13)
- Wire a **real asset renderer** for the brand layer (SVG templating + Playwright/`sharp` raster exports for logo lockups, profile pic, cover, highlights, templates) — or honestly relabel the skills as spec-only. Add a fail-closed WCAG **contrast guard**.
- Verify the **landing page (200 check)** and the **IG↔Page link via API** in setup; add multi-TLD + handle-consistency to domain screening; strengthen the trademark knockout to phonetic/similar marks.
- Add the **measurement middle**: EMQ tracking over time + modeled-vs-observed reconciliation in `capi-setup`, linking to `attribution` as one spine.
- Deepen **listening** (untagged mentions, keyword/hashtag, cross-platform, share-of-voice, crisis detection).
- Polish: vertical/geo-segmented benchmarks in `pre-audit`; split the DELETE guard by resource class; durable error logging + correlation IDs; idempotency keys on multi-step IG container writes; surface `paginate` truncation.

### Effort & impact snapshot

| Phase | Theme | Rough effort | Moves the needle on |
|---|---|---|---|
| 0 | Correctness & trust | ~1.5 wks | Safe to run live; credibility |
| 1 | Advantage+ paid modernization | ~3-4 wks | Client results / performance |
| 2 | Organic production & intelligence | ~4-5 wks | Service breadth / deliverables |
| 3 | Retention economics & ops | ~4 wks | Agency survival / margin |
| 4 | Brand production, measurement, polish | ~3-4 wks | Zero-start credibility / defensibility |

Completing Phases 0-1 alone moves the system to ~7.5; through Phase 3 to a defensible 8.5+ as a full-time agency operating system.

---

## 4a. Remediation pass — what was fixed this session (2026-06-30)

The following Tier-A (correctness & trust) and one Tier-B item were implemented and
verified. **All 262 tests pass** (the original 256 + 6 new regression tests added this
session). Each change is surgical and covered by a test or a live functional check.

**Correctness & trust (Tier A):**

1. **Launch double-budget bug — FIXED.** `skills/launch/launch.js` now branches on
   `brief.budget_mode`: CBO (default — Advantage Campaign Budget on the campaign, none on
   the ad set) or ABO (budget on the ad set, none on the campaign). Never both. Verified by
   regenerating Blue Rose Auto's `launch_plan.json`: campaign carries the budget, ad set
   carries none.
2. **Advantage+ Audience — ADDED.** `buildTargeting()` now emits
   `targeting_automation.advantage_audience` (1 for broad/interest prospecting, 0 for
   retargeting/lookalike; overridable per audience). The engine now speaks the current
   targeting API.
3. **Advantage+ / automatic placements — ADDED.** Default `placement_mode: "advantage"`
   leaves placements unset so Meta optimizes across all positions; `"manual"` restores the
   old format-restricted map only when explicitly requested.
4. **Multi-client token isolation — FIXED.** `publishing.js`, `leads.js`, `inbox.js`, and
   `threads.js` now all resolve tokens through the shared `scripts/lib/tokens.js`
   (`resolveToken`) instead of reading the global `META_PAGE_TOKEN`/`META_THREADS_TOKEN`
   directly. Per-client `META_PAGE_TOKEN_<SLUG>` wins; the global fallback is logged with a
   loud warning. `slug` added to the relevant tool schemas. Regression-tested.
5. **Guards fail-closed on bad input — FIXED.** `checkNaming` now BLOCKS a `create_*` with
   no name; `checkBudget` BLOCKS a non-finite/garbage budget while still allowing a
   legitimately-absent budget (CBO ad sets). Regression-tested.
6. **Durable `error_log` — IMPLEMENTED.** `supabase.js` gained `logError()` (appends to
   `logs/error_log.jsonl` offline + mirrors to Supabase `error_log` when configured, never
   throws). Wired into `meta-graph.js` so every terminal Graph error is captured. The
   CLAUDE.md claim is now true.
7. **CI — ADDED.** `.github/workflows/test.yml` runs `npm test` + `node --check` on every
   push/PR.
8. **Docs reconciled with reality.** CLAUDE.md now flags the external/uninstalled skills
   (the 14 phantom routes) with a verified dependency-status banner; `platform-specs.md`
   FB Reels is corrected from "✅ automated" to "⚠ partial (feed/photo built; video/Reels
   not yet wired)".

**Capability (Tier B):**

9. **Social-SEO wired into `/content-plan`.** `content-plan.js` now imports
   `social_seo.js` — keyword-first captions, capped 3–5 targeted hashtags, real alt text.
   The SKILL's Social-SEO claim is now true.
10. **New skill `/creative-test` — BUILT.** A real concept × hook × format testing skill:
    plan mode builds a control-vs-challenger matrix from approved angles + copy; `--evaluate`
    declares a winner only on a two-proportion z-test @95% **and** a ≥25-conversion gate
    (fail-closed on noise), reusing the same `stats.js` rigor as `/scale`. Ships
    JSON + Markdown + design-system HTML/PDF. Routed in CLAUDE.md and regression-tested.

**Flagged for you (not auto-applied):** the duplicate live-secret file
`mcp/meta-server/.env` is redundant (the server resolves the authoritative root `.env`)
and is gitignored, but removing live secrets is irreversible — delete it manually when ready.

### Revised scorecard after remediation

| Domain | Before | After | Note |
|---|---|---|---|
| Paid Media | 6.5 | **7.5** | Launch bug fixed; Advantage+ Audience + placements; `/creative-test` shipped. Still needs a full ASC campaign branch + account-level MER. |
| Organic & Content | 5.5 | **6.0** | Social-SEO wired; docs honest. Production layer still external/unbuilt. |
| Agency Business | 7.5 | 7.5 | Unchanged this pass (Phase 3 work remains). |
| Zero-Start Brand | 7.0 | 7.0 | Unchanged this pass (asset rendering remains). |
| Engineering & Infra | 7.5 | **8.5** | Token isolation, fail-closed guards, durable error log, CI. |
| **Overall** | **6.5** | **~7.5** | Safe for live multi-client operation; materially more honest. |

**On "10/10":** a literal 10 is the full Phase 1–4 roadmap below — weeks of work (full
Advantage+ Shopping path, the external content-production + intelligence skills, Stripe
Subscriptions + churn/health/margin, brand asset rendering, sentiment/listening depth).
This session closed the entire *correctness-and-trust* tier and the single highest-leverage
paid gap. The remaining path to 10 is the roadmap in §4, now with Phase 0 essentially done.

---

## 5. Bottom line for the agency build

You have an unusually well-engineered skeleton with senior-grade safety, governance, and a real commercial spine — materially better than a Notion-plus-spreadsheets-plus-manual-Stripe stack. To run this as a full-time agency, the priorities in order are: **(1) fix the correctness/trust defects that make live operation unsafe or misleading, (2) modernize the paid engine to the Advantage+/creative-testing era, (3) build the organic production substance you currently only schedule, and (4) close the retention-economics half of the business layer.** The architecture will support all of it without a rewrite.
