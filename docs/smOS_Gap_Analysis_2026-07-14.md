# smOS — Gap Analysis & Productivity Plan
**Date:** 2026-07-14 · **Evaluator:** Claude (full repo audit + test run + cross-check against prior evaluations)

---

## 1. Verdict in one paragraph

smOS is now a **genuinely production-grade Meta paid-ads agency engine** — the June remediation work landed. One guarded Graph API chokepoint (`scripts/lib/meta-graph.js`, v25.0, retries, fail-closed guards), 41 skills with 40 executable backings, an intact JSON handoff chain from intake to scale, 298 tests (279 pass locally in a sandbox; the 19 failures are all sandbox `EPERM` filesystem artifacts, not code bugs), a real design system, and honest docs. What it is **not yet** is a full Social Media Operating System: the organic production layer routes to external skills that aren't installed, listening has no sentiment classifier, the business-retention layer (subscriptions, churn, MRR) is unbuilt, multi-platform is zero code, and — most importantly — **no client has ever run through the system live**. The gap between 7.5 and 9+ is no longer architecture. It is proof, production, and platform breadth.

---

## 2. Scorecard — stack & wiring, out of 10

| Layer | Score | Why |
|---|---|---|
| **Architecture & wiring** | **9.0** | Single Meta chokepoint; MCP server + all skills funnel through it; guards fail-closed pre-HTTP; per-client tokens; schemas with human gates; hooks delegate to one guards.js. Best-in-class for a solo-built system. |
| **Safety & guardrails** | **9.0** | PAUSED defaults, dry-run defaults, circuit breakers, business-hours fail-closed, rollback on /scale, approval TTLs, destructive-action blocks. The 06-21 "guards silently disabled" bug is fixed and tested. |
| **Paid Meta engine** | **8.0** | Full pipeline audit→research→audience→brief→creative→launch→analyze→scale, ASC path, creative-test with real z-tests, video scoring, webhook leads. Docked: warm/LAL funnel still has `<TBD_>` custom-audience IDs; daily_metrics persistence partial. |
| **Testing & reliability** | **8.0** | 298 tests incl. integration + E2E + layout guards. No CI runner wired (tests run manually). |
| **Data layer (Supabase)** | **7.0** | schema.sql complete, error_log + optimizer_log wired, best-effort non-blocking writes. daily_metrics not yet populated by real runs; no dashboards on top of it. |
| **Agency business layer (CRM→billing)** | **6.5** | CRM state machine, proposal, contract, billing all real. But: one-off invoices only (no Stripe subscriptions), no churn/health/MRR, ledger drift (port-co proposal exists with no CRM deal; blue-rose-auto absent from pipeline). |
| **Autonomy & scheduling** | **6.0** | optimizer/reporter/auditor agents well-specified; scheduler.js declares crons but execution depends entirely on external Claude scheduler; no flock/per-TZ buckets; auditor references Graph calls with no skill backing. **Never proven on a live client.** |
| **Organic / content OS** | **4.5** | Calendar (/content-plan), publish (FB+IG), inbox, listening skeletons are real. But production skills (social, facebook-posts, linkedin-posts, video-shorts, remotion) are external and NOT installed — routes point to vapor; no sentiment classifier; FB Reels publish unwired. |
| **Multi-platform readiness** | **3.0** | Zero LinkedIn/TikTok code. No platform-adapter abstraction — publish/inbox/tokens/insights are Meta-shaped, so expansion currently means refactoring, not adding. Docs/specs exist. |
| **Docs honesty** | **8.0** | Massively improved since 06-21; dependency-status warnings are exemplary. Remaining drift: CLAUDE.md "Active Clients" vs CRM ledger; a few routed-but-uninstalled skills. |

### **Overall: 7.5 / 10** as a Meta ads agency engine · **5.5 / 10** against the "full Social Media OS / full-time agency" ambition.

Trajectory check: 06-21 expert review ≈ "impressive but unsafe" → 06-30 evaluation 6.5 → today 7.5. The curve is right; the remaining points are not buyable with more architecture.

---

## 3. The gaps, ranked by what they cost you

### 🔴 Tier 1 — Existential (blocks everything downstream)

**G1. Zero live proof.** Blue Rose Auto is in planning mode; no campaign has ever shipped through /launch to a real ad account; the optimizer/reporter agents have never run a real cycle. Every other gap is theoretical until one client completes one full loop. An agency OS that has never invoiced against delivered ad performance is a prototype, however good.

**G2. Agency foundation incomplete.** Business verification + App Review Advanced Access (`docs/agency-foundation.md`) are documented but not done. Without them, `/setup-accounts` can't create ad accounts programmatically and half the token scopes don't exist. This is a weeks-long external clock — nothing you build in the repo shortens it.

**G3. Measurement spine partial.** `daily_metrics` isn't being populated by real runs, so /before-after, /monthly-review trend regression, and the optimizer's 3-day ROAS windows have no longitudinal data to stand on. The tables exist; the habit of filling them doesn't.

### 🟠 Tier 2 — Revenue-limiting (paid engine ceiling)

**G4. Warm/LAL funnel can't actually build.** Retargeting layers in audience_map still carry `<TBD_>` custom-audience IDs — audience *creation* (website custom audiences, engagement audiences, LALs from seeds) isn't closed-loop. Mid/bottom-funnel campaigns are therefore hand-assembled.

**G5. No creative refresh loop.** /creative-intel detects fatigue and /creative can write copy, but nothing connects "ad X is fatiguing" → auto-brief the creative-agent → queue replacements for approval. In 2026 Meta, creative volume is the growth lever; this loop is the single highest-ROI automation left in the paid engine.

**G6. CRM ledger drift.** port-co proposal with no deal record; blue-rose-auto engagement not in pipeline; CLAUDE.md client list maintained by hand. The moment you have 5+ clients this becomes silent revenue-forecast corruption.

### 🟡 Tier 3 — The "OS" claim gap (organic + business)

**G7. Content production is routed, not built.** CLAUDE.md routes to `social`, `facebook-posts`, `linkedin-posts`, `video-shorts`, `remotion`, `marketing-psychology`, `keyword-research` etc. — none installed. Fallback ("do it inline, tell the user") is honest but means the organic half of the OS is Claude improvising per session with no SOP consistency. Note: the bundled `video`/`video-script`/`video-render`/`video-mux` skills in your environment already cover a chunk of `video-shorts` — they're not wired into smOS routing.
**G8. Listening has no brain.** `sentiment` field exists in the schema; nothing classifies it. Competitor organic benchmarks are snapshots without narrative.
**G9. No retention economics.** No Stripe subscriptions (invoices are one-off), no client health score, no churn early-warning, no agency MRR/margin dashboard. You can win clients through the pipeline and have no instrument telling you which are about to leave.
**G10. Portal is read-only assembly.** No recurring auth, no live data, approvals via mailto. Fine for now; not a moat.

### ⚪ Tier 4 — Structural debt for the multi-platform future

**G11. No platform adapter layer.** `publish.js`, `inbox`, `tokens.js`, insights are all Meta-shaped. Adding LinkedIn/TikTok later means surgery on working code instead of dropping in an adapter.
**G12. Platform API approvals have long external clocks.** TikTok content-posting audit: 2–4+ weeks. LinkedIn Community Management API: partner approval, notoriously slow. These queues can run in parallel with everything above — but only if you start them.
**G13. Misc:** auditor agent lacks a skill backing; scheduler lacks flock + per-client-TZ buckets; no CI; FB Reels publish path unwired; layout migration (`migrate-layout.js --all`) not yet run on live client dirs.

---

## 4. The plan — five phases, ordered by leverage

> Principle: **prove → close the paid loop → add organic substance → instrument the business → then widen platforms.** Start all external approval clocks (G2, G12) in week 1 regardless of phase.

### Phase 1 — Prove it live (weeks 1–2) · target: first real campaign
1. **Complete agency foundation** (G2): business verification, app creation, Advanced Access requests, system-user token. Manual, external clock — start today.
2. **Take Blue Rose Auto live end-to-end:** /setup-accounts → /capi-setup → /audit (real baseline) → /strategy-brief → /creative → /launch (PAUSED) → human activates → first optimizer cycle → first /report. Treat every friction point as a bug ticket.
3. **Turn on the measurement spine** (G3): make /analyze runs persist daily_metrics unconditionally; verify optimizer_log rows appear after the first real /scale dry-run.
4. **Hygiene sweep:** run `migrate-layout.js --all`, reconcile CRM ledger (add port-co + blue-rose-auto deals), make CLAUDE.md "Active Clients" generated from `crm/pipeline.json` instead of hand-edited (kills G6 permanently).
5. **File the TikTok content-posting audit and LinkedIn partner applications now** — even with zero code, the queue time is free.

### Phase 2 — Close the paid loop (weeks 2–4) · target: hands-off mid-funnel
6. **Audience creation closed-loop** (G4): extend audience tooling to *create* website/engagement custom audiences and LALs via the chokepoint, write real IDs back into audience_map.json. Kill every `<TBD_>`.
7. **Creative refresh loop** (G5): creative-intel refresh queue → auto-spawn creative-agent with the fatiguing ad's angle + asset history from /assets → draft variants → Discord approval → /launch replacements PAUSED. This is the compounding-returns feature.
8. **Install /rules on the live account** so Meta-side guardrails run even when smOS is off.
9. **Add CI** (GitHub Actions: `npm test` on push) — 298 tests deserve a runner.

### Phase 3 — Organic substance (weeks 4–8) · target: the "S" in smOS
10. **Resolve the external-skill question per route** (G7): install from marketplace where available; where not, write thin smOS-native versions of the two that matter most for Meta-only scope — `facebook-posts` and a Reels/short-form producer (wire your already-bundled `video-*` pipeline skills into smOS routing for this — they exist and are free to run). Delete or demote routes you won't support.
11. **Wire FB Reels publishing** in /publish (the container flow already exists for IG).
12. **Sentiment classifier for /listening + /inbox** (G8): a Claude-scored pass over mentions/comments writing the existing `sentiment` field — small job, big report value.
13. **Content approval flow**: replace mailto approvals in /portal with the approvals.js workflow you already built.

### Phase 4 — Business instrumentation (weeks 6–10, overlaps 3) · target: retention
14. **Stripe subscriptions** for retainers (G9) — billing.js gains a `subscribe` mode; invoices become receipts.
15. **Client health score**: composite of KPI trend + report engagement + inbox SLA + payment timeliness, computed monthly by the auditor agent, written to Supabase.
16. **Agency ops dashboard**: one page over Supabase (MRR, margin per client, pipeline forecast, health scores). *(This is a perfect Cowork live-artifact use case — no need to build hosting.)*

### Phase 5 — Multi-platform (after Meta is proven, ~week 10+)
17. **Extract a platform adapter interface first** (G11): `adapters/meta/`, defining publish/inbox/insights/tokens contracts. Refactor Meta behind it while it's the only implementation — cheap now, expensive later.
18. **LinkedIn adapter** (B2B clients, text+document posts = lowest media complexity), then **TikTok adapter** (assuming Phase-1 applications have cleared).
19. Extend tokens.js to `{PLATFORM}_{KIND}_{SLUG}` naming, platform-specs.md stays the single SOP.

---

## 5. What NOT to do

- Don't build more paid-media features before one client is live — the engine is already ahead of its proof.
- Don't hand-build LinkedIn/TikTok integrations before the adapter layer exists and the API approvals clear.
- Don't add a web app / hosted portal yet — HTML+PDF + /bundle + a Cowork artifact dashboard covers the next 6 months.
- Don't let CLAUDE.md carry state (client lists, statuses) that a ledger already owns — generate, don't duplicate.

---

## 6. Bottom line

| Question | Answer |
|---|---|
| Stack & wiring quality | **7.5 / 10** — architecture and safety are 9s; autonomy, organic, and business layers pull it down |
| Distance to "full agency OS (Meta-only)" | ~8 weeks of the plan above, **gated mostly by external approval clocks and one live client** |
| Distance to multi-platform OS | Adapter refactor + approvals; realistically Q4 2026 |
| Single highest-leverage next action | **Start business verification + take Blue Rose Auto live.** Everything else is sharpening a knife that has never cut. |
