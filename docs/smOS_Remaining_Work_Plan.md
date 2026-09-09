# smOS — Remaining Work Plan (hand-off spec)
**As of 2026-06-30.** Paste this into a terminal coding agent running in the repo root. It is the prioritized backlog after the 2026-06-30 remediation + file-structure passes.

## Context the agent needs (read first)
- This is a Claude-Code plugin: skills in `skills/<name>/`, shared libs in `scripts/lib/`, hooks in `hooks/`, schemas in `schemas/`, an MCP server in `mcp/meta-server/`, tests in `test/`.
- **Constitution:** `CLAUDE.md` (Meta API v25.0, PAUSED-by-default, naming conventions, guardrails). Obey it.
- **Path module is the single source of truth:** `scripts/lib/paths.js`. Every client file goes through `clientFile(slug, name, {forWrite})` (buckets: `profile.json` / `data/` / `deliverables/<artifact>/` / `state/`) or `clientReport(slug, date, type, ext)`. NEVER hardcode `resolve(dir, "x.json")` again.
- **Guards are fail-closed at one chokepoint:** `scripts/lib/guards.js` (run on every Graph write via `meta-graph.js`). Add rules there, mirror in `hooks/`.
- **Tests:** `node --test test/*.test.js`. The sandbox mount blocks file deletes/renames + fixture unlink — **run the suite in a writable copy**: `cp -r repo /tmp/x && cd /tmp/x && node --test test/*.test.js`. Baseline is **268 passing**. Every task must keep it green and add tests.
- Reports ship HTML **and** PDF via `scripts/render_pdf.py`; all client-facing HTML uses the one design system (`design-system/smos-design-system.css`). Don't hand-roll CSS.
- Two reference docs already in the repo: `smOS_Full_Evaluation_2026-06-30.md` (scores + rationale) and `smOS_File_Structure_Plan_2026-06-30.md` (layout). Read them for "why".

---

## GROUP A — ✅ DONE (2026-06-30). file-structure cleanup
Small, unblocks a fully-clean tree. Mostly mechanical.

> Status: A1 migration already applied (blue-rose-auto clean). A2 moved top-level
> `reports/` → `data/research-cache/` (new `scripts/lib/paths.py` + market.py wired).
> A3 added a call-time `SMOS_DATA_ROOT` override to paths.js (billing/brand routed
> through it) so all fixtures land in `test/.tmp`; routed 13 skills/scripts off
> hardcoded `resolve(ROOT,"clients"/"prospects",slug)`. A4 deleted dead
> `mcp/meta-server/.env`. A5 added `test/layout-guard.test.js`. Suite 269 → 278 green.

A1. **Apply the migration to live data.** Run `node scripts/migrate-layout.js --all` (dry run, review), then `--apply`. Confirm `clients/*/` and `prospects/*/` show the four-bucket layout and the suite stays green.

A2. **Rename top-level `reports/` → `data/research-cache/`.** This dir is the global niche/market-research cache (not client reports). Add a `researchCache()` helper usage in `scripts/meta-ad-library/report.py`, `scripts/meta-ad-library/persist.py`, `skills/research/research.js`, and any reader (grep `reports/cat_` and `_market_research`). `paths.js` already exports `researchCache()` / `researchCacheDir()`. Move the files, update refs, keep green.

A3. **Relocate test fixtures out of real data dirs.** Fixture clients (`clients/__*`, `clients/_gatetest`, `clients/it-intake-audit-fixture`) and `billing/__portal_test_*` should be created under a temp/`test/.tmp` dir by the harness (`test/helpers/pipeline.js`), not in `clients/`. Update the harness + any test that hardcodes those paths.

A4. **Delete the duplicate secrets file** `mcp/meta-server/.env` (root `.env` is authoritative; the server resolves it via `load-env.js`). Verify the MCP server still boots.

A5. **Add a drift-guard test** `test/layout-guard.test.js`: assert that running each report/deliverable-producing skill writes ONLY inside `data/ | deliverables/ | reports/ | state/` (no new flat files at the client root). Lock the layout so it can't regress.

**Acceptance:** suite green; `ls clients/blue-rose-auto/` shows only `CLAUDE.md profile.json data/ deliverables/ reports/ state/`; no fixtures in `clients/`.

---

## GROUP B — Complete the paid engine (highest performance leverage; ~3–4 days)
Already done earlier: launch double-budget fix, Advantage+ Audience flag, automatic placements, `/creative-test`. Remaining:

B1. ✅ **DONE (2026-06-30). Advantage+ Shopping (ASC) campaign path.** `strategy-brief.js` gained `decideCampaignType` (e-commerce + healthy pixel → `campaign_type:"asc"` with an `asc` config block: existing-customer cap default 20%, catalog, conversion event; falls back to `"manual"`). `launch.js` gained `buildAscPlan`/`buildAscCampaignPayload`/`buildAscAdsetPayload` — a single Meta-managed campaign (`smart_promotion_type:"AUTOMATED_SHOPPING_ADS"`, campaign-level budget + `existing_customer_budget_percentage`, pixel/catalog promoted_object) instead of per-audience fan-out. main() guarded in both. 2 tests in `test/launch-asc.test.js`.

B2. ✅ **DONE (2026-06-30). Account-level economics in `/analyze` + `/report`.** Added blended MER, margin-aware breakeven/target ROAS, gross profit, profit-after-ads (POAS), and new-customer CAC (nCAC) via new `scripts/lib/economics.js`. `schemas/client_profile.js` gained `normalizeUnitEconomics` (gross_margin/AOV/LTV/target_cac/target_mer; accepts fraction or %). Wired into `analyze.js` output + markdown (`economicsSection`, exported + main()-guarded) and the weekly report template + raw JSON. 9 math tests in `test/economics.test.js`.

B3. ✅ **DONE (2026-06-30). Score video creatives on hook + retention, not thumbnail.** New `scripts/lib/video_scoring.js` (`computeVideoScore`: hook_rate/thruplay/hold_rate/completion/avg_pct + 1–10 composite + diagnosis). `audit-creative.js` gained `fetchVideoInsights` (ad-level video-play metrics keyed by creative), attaches `video_score` to video assets, ranks videos by retention (not thumbnail) in `weightedScore`, and adds video hook/retention rollups to formatStats + the report section. 5 tests in `test/video-scoring.test.js`.

B4. ✅ **DONE (2026-06-30). Webhook-first leads.** `skills/leads/leads.js` gained a `webhook` mode (PRIMARY): `extractLeadgenIds` (pure) → fetch full lead by id → `enrichLead` (same scoring as poller) → append to the shared per-form JSONL (dedup on id) → rebuild CSV. `sync` reframed as backfill/reconciliation. main() guarded; pure helpers exported. Setup documented in `skills/leads/references/webhook-setup.md` (subscribe, challenge verify, signature, payload shape). 4 tests in `test/leads-webhook.test.js`.

---

## GROUP C — Content production: OPT-IN (per client direction, 2026-06-30)
Per client direction, AI content creation is **optional** — some clients have their own
content team or don't want AI-generated content. Rather than build Group C's mandatory
producers, smOS now gates AI content per client:

C0. ✅ **DONE. Opt-in AI content.** `schemas/client_profile.js` gained
`normalizeContentPreferences` (`mode: "ai_assisted" (default) | "client_team" | "ai_off"`,
`ai_captions` bool). `content-plan.js` still plans the calendar + SEO keyword targets when
AI is off, but flags each item `produced_by:"client_team"` and writes a handoff caption
instead of AI copy (markdown shows a "client team writes copy" note). `schemas/content_plan.js`
item gained `produced_by`. 4 tests in `test/content-optional.test.js`.

> Remaining C1–C6 (real content-production skills, publish.js video/Reels/Stories, sentiment
> classifier, organic analytics loop, multi-platform cadence, approval workflow) are
> **deferred** unless a client opts into AI production. Build on demand.

---

## GROUP C (spec) — the deferred organic backlog, in detail (~4–5 days if activated)

> **This is the specification for the C1–C6 items the section above defers** — it is not
> a second, separate group. Do not start these unless a client opts into AI production.
> Two items have partially landed anyway, as side effects of other work (noted inline).

C1. **At least one real content-production skill.** Build `skills/social/` (or `facebook-posts`) that turns a `content-plan` item + pillar into finished, spec-compliant, keyword-first copy (import `scripts/lib/social_seo.js`), shaped to `skills/content-plan/references/platform-specs.md`. Then either build the other routed producers (`linkedin-posts`, `video-shorts`) or remove their routes from `CLAUDE.md` (don't route to vapor).

C2. **Finish `publish.js`** — _partially landed:_ the FB 3-phase `/video_reels` flow exists (`skills/publish/publish.js:76-92`) and IG `media_type=REELS` is handled (`:145`). **Still missing: IG Stories (`media_type=STORIES`) and the `/content_publishing_limit` pre-check.** Original scope: add FB video + FB Reels (the 3-phase `/video_reels` flow) and IG Stories (`media_type=STORIES`); pre-check `/content_publishing_limit`. Flip `platform-specs.md` FB Reels back to "automated" only once code exists. Tests for each flow (mock Graph).

C3. **Sentiment + intent classifier** — _partially landed:_ `scripts/lib/sentiment.js` exists and `/inbox` consumes it via a fail-closed judgment-merge (`inbox.js:25,141-159`), which reports items still needing a judgment rather than guessing. **Still missing: `/listening` integration, urgency/intent triage, and real `draft_reply` generation.** Original scope: for `skills/inbox/inbox.js` and `skills/listening/listening.js`: populate the existing `sentiment` schema fields, triage inbox by urgency/intent, actually generate `draft_reply` copy (the SKILL claims it). Tests.

C4. **Organic analytics loop:** roll up post-level IG/FB Insights into `daily_metrics`, attribute by pillar, learn best-time-to-post, feed the next `content-plan`. New `skills/` or extend `content-plan`.

C5. **Multi-platform, cadence-aware `content-plan`:** read cadence/best-day rules from `platform-specs.md`, emit per-platform variants, derive pillars from `listening`/`research` VOC instead of the hardcoded 4.

C6. **Content approval workflow:** draft → internal review → client-approved states gating `/publish`. Asset rights/expiry + usage log in `scripts/lib/dam.js` / `skills/assets/`.

---

## GROUP D — Make it a real agency business (retention economics; ~4 days)
D1. **Stripe Subscriptions + auto-issue** in `skills/billing/billing.js` + `scripts/lib/billing-store.js`: real recurring retainers, a scheduled monthly issue (cron via `scripts/scheduler.js`), and send the `Idempotency-Key` header the SKILL references but omits.

D2. **Stripe webhook reconciler:** flip ledger invoices to `paid`/`void` from webhooks; add overdue/AR-aging + dunning. Removes the manual `mark-paid` drift.

D3. **Client-health + renewal layer:** capture `engagement_start` / `term_end` / `renewal_date` on the deal/profile; compute a health score from `monthly-review` trend output; emit "renewal due in 30d" / "at-risk" in `crm next` (`skills/crm/crm.js`, `scripts/lib/crm-store.js`, `schemas/deal.js`).

D4. **Margin / cost-to-serve + capacity:** add `cost_to_serve` + logged-effort fields → per-client profitability; turn `deal.owner` into a roster with load limits.

D5. **Agency ops dashboard** (sibling to `/portal`): MRR, net revenue retention, churn, pipeline velocity, win rate, AR aging, capacity. Tokenized/authenticated share links (replace guessable public paths).

---

## GROUP E — Brand production, measurement depth, hardening (~3–4 days)
E1. **Real brand-asset rendering** in `skills/brand-visual/` + `skills/brand-social/`: SVG templating + `sharp`/Playwright raster exports for logo lockups, profile pic, cover, highlights, templates — OR relabel the skills as spec-only (today they record paths but generate no bytes).

E2. **Fail-closed WCAG contrast guard:** compute relative luminance on `brand_profile.visual.colors`; reject sub-4.5:1 primary-on-neutral. Add to `scripts/lib/guards.js` + a hook.

E3. **Verify, don't assume, in setup:** `skills/setup-web/` GET the landing URL (expect 200) before recording `website_url`; `skills/setup-accounts/` read-verify the IG↔Page link via the API. Strengthen the trademark knockout in `skills/brand-name/` to phonetic/similar marks; add multi-TLD + handle-consistency to the domain screen.

E4. **Measurement spine:** track Event Match Quality over time in `skills/capi-setup/` and reconcile modeled-vs-observed conversions, linking to `/attribution` as one spine.

E5. **Listening depth:** untagged-mention monitoring, keyword/hashtag tracking, cross-platform, share-of-voice, crisis detection in `skills/listening/`.

E6. **Engineering hardening:** split the DELETE guard by resource class (allow organic comment deletes, keep campaign deletes blocked) in `guards.js`; add idempotency keys + cleanup to the multi-step IG container flow in `mcp/meta-server/tools/publishing.js`; surface `paginate` 500-row truncation in `meta-graph.js`; add correlation IDs to `logError`. Replace `/pre-audit` flat US benchmarks with a vertical/geo benchmark table.

---

## Suggested order
A (cleanup) → B1+B2 (ASC + MER, biggest paid wins) → C1+C2 (real content production + publish) → D1+D2+D3 (recurring revenue + retention) → E (brand/measurement/hardening). Each task: branch, implement, add tests, run the full suite in a writable copy, keep it green.

## Definition of done (per task)
1. Code uses `paths.js` (no hardcoded client paths) and obeys `CLAUDE.md`.
2. New/changed behavior has tests; `node --test test/*.test.js` passes in a writable copy.
3. Any new skill has a `SKILL.md`, is routed in `CLAUDE.md`, and (if it renders) ships HTML+PDF via the shared design system.
4. No doc-vs-reality drift: don't claim a capability the code doesn't have.
