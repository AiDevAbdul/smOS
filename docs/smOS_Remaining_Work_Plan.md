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

## GROUP D — ✅ DONE (2026-09-09). Retention economics

All five items shipped. What landed, and the three things worth remembering:

- **D1** `schemas/subscription.js` + `scripts/lib/stripe.js` + `scripts/billing-cron.js`.
  Recurring retainers are now an explicit record, every mutating Stripe POST carries a
  deterministic `Idempotency-Key`, and the monthly cron is dry-run by default and never
  issues locally for a Stripe-collected subscription (that would double-bill).
- **D2** `scripts/lib/reconcile.js` + `ar.js` + `scripts/stripe-webhook.js`. One writer
  for invoice status that refuses to reopen a settled invoice on an out-of-order event;
  AR aging and a dunning ladder that drafts but never sends, and never auto-pauses a
  client's service. Webhook signature verification is mandatory and fail-closed.
- **D3** `scripts/lib/client-health.js` + retention fields on the deal. A missing signal
  is removed from the *denominator*, never scored zero — a client with no artifacts
  scores `null`, and `confidence` says what share of the weighting had data.
- **D4** `scripts/lib/agency-economics.js` + `config/roster.json`. Per-client margin
  against cost-to-serve; unknown cost is `null`, never a 100% margin; `hours_basis`
  always labels logged vs budgeted; no invented FX.
- **D5** `skills/agency-ops/` + `agency-metrics.js` + `share-token.js`. The whole-book
  dashboard, MRR snapshots (which is what makes NRR possible at all), and signed
  expiring share links replacing guessable public paths.

Three cross-cutting fixes fell out of it, all now enforced in CLAUDE.md:
never blend currencies; never let missing data score as good news; never read revenue as
profit. Also fixed: `SMOS_DATA_ROOT` didn't isolate `crm/pipeline.json` (a scratch run
could append to real data), and a placeholder `STRIPE_API_KEY=FILL_IN` counted as
configured.

Suite went 505 → 572 across the group (386 at the start of the session).

---

## GROUP D (original spec) — Make it a real agency business (retention economics; ~4 days)
D1. **Stripe Subscriptions + auto-issue** in `skills/billing/billing.js` + `scripts/lib/billing-store.js`: real recurring retainers, a scheduled monthly issue (cron via `scripts/scheduler.js`), and send the `Idempotency-Key` header the SKILL references but omits.

D2. **Stripe webhook reconciler:** flip ledger invoices to `paid`/`void` from webhooks; add overdue/AR-aging + dunning. Removes the manual `mark-paid` drift.

D3. **Client-health + renewal layer:** capture `engagement_start` / `term_end` / `renewal_date` on the deal/profile; compute a health score from `monthly-review` trend output; emit "renewal due in 30d" / "at-risk" in `crm next` (`skills/crm/crm.js`, `scripts/lib/crm-store.js`, `schemas/deal.js`).

D4. **Margin / cost-to-serve + capacity:** add `cost_to_serve` + logged-effort fields → per-client profitability; turn `deal.owner` into a roster with load limits.

D5. **Agency ops dashboard** (sibling to `/portal`): MRR, net revenue retention, churn, pipeline velocity, win rate, AR aging, capacity. Tokenized/authenticated share links (replace guessable public paths).

---

## GROUP E — Brand production, measurement depth, hardening (~3–4 days)

> **Status 2026-09-09: ALL of Group E is DONE** (E1–E5 plus E6's four hardening items and its
> pre-audit vertical/geo benchmark table). Suite 572 → 615 → 645 → 717 → **735 green**.
>
> - **E1 — real brand-asset rendering.** `scripts/lib/brand_render.js` renders an actual
>   monogram identity system (primary lockup / mark / wordmark / mono / reverse, SVG+PNG)
>   plus the applied social surface (profile picture 1080², FB cover 1640×856 with the
>   1090×360 safe zone, IG highlight covers, post 1080×1350 + story 1080×1920 templates)
>   through Satori → resvg with the bundled brand fonts — deterministic, offline, no GenAI.
>   `/brand-visual --render` and `/brand-social --render` write into
>   `clients/<slug>/deliverables/brand-assets/` and record only paths that exist. The skills
>   were relabeled honestly: this is a starter identity, not bespoke logo art.
> - **E2 — WCAG contrast guard.** `scripts/lib/contrast.js` (luminance/ratio/level) +
>   `guards.checkBrandContrast`. Fail-closed at the point the colors are chosen
>   (`/brand-visual` exit 4, nothing persisted) and mirrored on the MCP creative path by
>   `hooks/contrast-check.js`. `primary` is blocking against its OWN neutrals (the pairing a
>   designer would actually use); `secondary`/`accent` warn. `SMOS_ALLOW_LOW_CONTRAST=1`
>   overrides and says so. All five live client palettes pass.
> - **E6a — DELETE split by resource class.** `classifyDeleteTarget` + `ORGANIC_DELETABLE` /
>   `BLOCKED_DELETE_CLASSES`. Comment moderation works without `SMOS_ALLOW_DELETE=1` (which
>   previously also unlocked campaign deletes); ad structure, pixels, datasets, audiences and
>   automated rules stay blocked, each with its own reason; an **undeclared** delete is
>   treated as ad structure. Callers declare it: `graph.delete(path, params, {resource})`.
> - **E6b — IG container idempotency + cleanup.** `scripts/lib/ig_publish_state.js`: a
>   deterministic key over (account, media urls, caption) → replay an identical post without
>   a single write, resume a mid-flight container instead of making a second one, record
>   orphans on failure (containers can't be DELETEd via the API — they expire in 24h), prune
>   expired entries. `idempotency_nonce` is the deliberate way to post the same asset twice.
> - **E6c — pagination truncation is visible.** `paginate()` attaches non-enumerable
>   `truncated`/`pageCount`/`nextCursor`, warns on stderr, and takes an `onTruncate` hook. It
>   silently `slice`d at 500 before, so a 700-ad account looked complete.
> - **E6d — correlation IDs.** Every request carries one (`withCorrelationId()` shares one
>   across a flow); it lands on the thrown error and in `error_log.context` with the attempt
>   count.

E1. ✅ **DONE (2026-09-09). Real brand-asset rendering** in `skills/brand-visual/` + `skills/brand-social/`: logo lockups, profile pic, cover, highlights, templates. *Spec said `sharp`/Playwright; implemented with **Satori → resvg** instead* — the pipeline `poster_text_layer.js` already proves out, which embeds the bundled brand fonts as glyph paths so output is deterministic across hosts (Playwright would have added a headless-browser dependency for the same result). Both skills were also relabeled honestly: what they generate is a monogram starter identity, not bespoke logo art.

E2. ✅ **DONE (2026-09-09). Fail-closed WCAG contrast guard:** compute relative luminance on `brand_profile.visual.colors`; reject sub-4.5:1 primary-on-neutral. Add to `scripts/lib/guards.js` + a hook.

E3. ✅ **DONE (2026-09-09). Verify, don't assume, in setup.**
- `scripts/lib/verify_url.js` (`probeUrl`): manual redirect-following (≤5, chain reported), 2xx-only, 401/403 counted as unreachable, never throws. `/setup-web --set-website` refuses a URL that doesn't answer (exit 5, nothing written), records the **post-redirect final URL**, and writes `setup.landing_verified_at` + `setup.landing_probe`. `--force` records unverified and says so; `--probe` is read-only. `SMOS_PROBE_TIMEOUT_MS` overrides the 10s default. *No parking-page heuristic* — every version of it false-positives on real minimal landers.
- `scripts/lib/meta_verify.js` (`verifyPage`, `verifyIgPageLink`): `/setup-accounts --done ig_page_linked_at` reads the Page's `instagram_business_account` edge before stamping — exit 6 when absent, and exit 6 on a **mismatch** (Page linked to a different IG than the profile records, which is the case that would otherwise silently break `/publish` + `/inbox`). On success it back-fills the live `instagram_business_id`. New `--verify` mode; `--status` marks each API-verifiable step `api_verified`. A `*_verified_at` timestamp means smOS confirmed it; the gate timestamp alone means a human said so.
- `scripts/lib/phonetics.js` (soundex / consonant skeleton / Levenshtein / `isConfusable` / `spellingVariants`): the knockout now queries the name **plus its respellings** and scores returned marks for confusability, so "Klaritee" surfaces a live "CLARITY". Fail-open discipline extended: if ANY variant query fails the whole screen is `null` (incomplete), never "clear". With no API key it hands over the exact respelling set to search by hand.
- Domain screen is multi-TLD (`com,co,io,net`, `--tlds` override) with `.com` still the gate field; handles roll up into one `handle_consistency` verdict (`true` only when every platform 404s).
- Tests: `test/verify-url.test.js`, `test/phonetics.test.js`, `test/setup-verify.test.js`, `test/setup-web-cli.test.js` (+30 → 645). Note for future CLI tests: use async `spawn`, not `spawnSync`, when the test itself hosts the HTTP server — `spawnSync` blocks the event loop and the child's request never gets accepted.

E4. ✅ **DONE (2026-09-09). Measurement spine.** `scripts/lib/measurement_spine.js` is the single module `/capi-setup` writes and `/attribution` reads (JSON handoff at `clients/<slug>/data/measurement_spine.json`; `measurement_snapshots` DDL added to `scripts/schema.sql`, not yet created live — persistence reports `{persisted:false, reason}` until it is).
- **EMQ over time:** `parseDatasetQuality()` normalizes Meta's Dataset Quality API (v25.0) across its three response shapes and keeps the match-key coverage breakdown **in the API's own unit** rather than guessing between 0–1 and 0–100. `recordEmqSnapshot` dedupes an identical same-day capture so history can't be padded; bands `great≥8/good≥6/ok≥4/poor` with a 0.1 noise floor, 365-entry cap.
- **Modeled vs observed:** `reconcileConversions()` → `gap`, `gap_pct`, `coverage_ratio`, verdict, each side labeled `platform_reported` vs `audited|observed_unverified`. The observed count is operator-supplied by design (`--observed`, `--observed-source`, `--observed-audited`) — nothing in the Meta API knows the CRM number; the platform side comes from `/analyze`'s existing `performance_analysis.json` per the Token Efficiency Rules.
- Honesty invariants, each test-covered: an EMQ Meta didn't return is `null` never 0 (and the dataset average averages only scored events); a trend needs two **real** samples and a failed capture is not one; a zero/unknown denominator ⇒ `coverage_ratio: null` **with the reason**, never `1.0`/`Infinity`; a corrupt spine reports `corrupt: true` rather than "no history".
- *Deliberate behavior change:* offline/token-less `/capi-setup` now reports event status `unknown` + `data_source: "offline"`. It previously marked every event `never_fired` — an assertion about a pixel it never queried.
- New flags: `/capi-setup --no-emq --observed N --observed-source <label> --observed-audited --platform-conversions N --event <name> --window <label>`; `/attribution --spine` (read-only inspect) plus the same observed flags. `/attribution` still HALTs exit 4 without measured lift rows — the spine is not a substitute.
- *Not verified:* the live `/dataset_quality` payload shape. The parser is shape-tolerant and degrades to `unknown` with a reason rather than guessing, but the per-key field names come from Meta's docs, not an observed response.
- Tests: `test/measurement-spine.test.js` (24) + `test/capi-emq.test.js` (10, real CLI runs, offline).

E5. ✅ **DONE (2026-09-09). Listening depth.** `scripts/lib/listening_depth.js` (pure calculators: source catalog, term matching, mention normalization with a deterministic `mention_id` + tagged/untagged classification, coverage accounting, `shareOfVoice`, `rollingBaseline`/`sentimentSkew`/`detectCrisis`), `scripts/lib/listening_watchlist.js` (persisted per-client watchlist + append-only time series via `paths.js`), `scripts/lib/web_search.js` (Node twin of the existing Tavily helper, key-gated, fail-soft).
- **The coverage reality, which the spec understated:** IG `/tags` is *structurally* tagged-only and can never be the untagged path. The only first-party untagged path is **IG Hashtag Search** (`/ig_hashtag_search` → `/{id}/recent_media`) — public top-level posts, ~24h recency, **30 unique hashtags per IG user per rolling 7 days**, which is why it's opt-in behind `--hashtag-search`. **Facebook has no public keyword/mention search**; the ceiling is comments on the client's own Page posts, implemented and labelled as the ceiling. TikTok/X/LinkedIn/YouTube/Reddit have no reachable listening API and are emitted every run as `status:"unavailable"`, `mentions: null`, with a reason. The web path is Tavily-backed and its coverage row says it is an index of public pages, **not a per-platform census**.
- Consequence: `mention_total` and every SoV share carry `is_floor: true` plus `basis_platforms` and `confidence`; `share_of_voice` returns `no_data`/`no_attributable_mentions` with `null` shares rather than a 0/100 split.
- **Crisis detection:** 3 weighted signals (volume spike 3 / negative skew 3 / velocity 2). Needs **5 prior time-series points** (else `severity: null`, `status:"insufficient_data"`) and 5 sentiment-classified mentions before skew scores at all — an unmeasured signal leaves the denominator instead of scoring 0; `confidence < 0.5` ⇒ `severity_provisional`; a zero baseline yields no ratio (undefined, not infinite). The time series is idempotent per `captured_at`, so a retry can't fabricate a spike. `elevated`/`critical` sets `requires_human`.
- `schemas/listening_snapshot.js` gained a fail-closed rule: a coverage row whose status isn't `ok`/`partial` may not carry a non-null `mentions` (and one that ran must carry a number). Pre-E5 snapshots still validate.
- New flags: `--show-watchlist`, `--add-brand-term/-keyword/-hashtag/-competitor` (repeatable), `--remove`, `--hashtag-search`, `--fb-comments`, `--web-search`, `--baseline-window N`, `--no-timeseries` — all 11 registered in `skills/manifest.json` (the listening entry previously had none). New exits: 6 corrupt watchlist, 7 empty watchlist.
- *Deviation:* no HTML+PDF renderer. `/listening` writes engine JSON only, like `/inbox`, `/attribution` and `/assets`; `/portal` and `/report` are the rendering consumers. Made explicit in the skill's "does NOT do" list rather than left ambiguous.
- Tests: `test/listening-depth.test.js`, `test/crisis-detect.test.js`, `test/listening-cli.test.js` (38, offline).

E6. ✅ **DONE (2026-09-09). Engineering hardening** — all five items: the four listed above (DELETE by resource class, IG container idempotency + cleanup, visible `paginate` truncation, correlation IDs) plus the pre-audit benchmark table:
- **Vertical/geo benchmark table** replacing the flat US one. `benchmarks.json` grew from 5 flat metrics to three blocks: `global` (the cross-vertical floor, unchanged), `verticals` (18 rows × CPM/CPC/CTR/CPA + ~60 `vertical_aliases` so `hvac`/`dental`/`shopify`/`pizza` land on the right row), and `geos` (52 countries with a `cpm_index` off the US base). `benchmarks.py resolve(vertical, geo)` returns the set **and how close it actually is**; `build.py --vertical/--geo` resolves once into `synthesis.json.benchmarks` and the renderer reads that (Token Efficiency), falling back to `resolve(None, None)` for a pre-existing synthesis.
- The finding that shaped the design: **no public source we have holds an observed vertical-by-geo cell.** So each metric carries a `basis` — `vertical_observed` (the source's own mixed-geo figure), `geo_derived` (vertical × CPM index, an estimate), `global_default` — and the report badges every row accordingly with a scope line above the table. Four enforced rules: **only CPM is geo-adjusted** (no published CPC/CPA index exists; scaling them would imply clicks and conversions move with impression price); **an unmeasured market stays unmeasured** (PK/BD/NG/TR/ID are in `geo_gaps` → `cpm_index: null`, no neighbour substituted — notable given PKR retainers); **`nonprofit`/`ngo`/`charity` are mapped to `null` on purpose** (no commercial row is a defensible proxy for donation-objective economics); **untailored is stated** ("Cross-vertical — not tailored to this vertical"), never implied.
- Sources are third-party aggregates, not smOS account data, and they **disagree materially** — US CPM is quoted from $16.08 to $23.00 for the same period. That conflict is recorded in `disagreement`, the tier is `third_party_aggregate`, and both reach the rendered page as caveats.
- Tests: `test/pre-audit-benchmarks.test.js` (18 — resolver semantics, build wiring, and three renderer assertions incl. the pre-block-synthesis fallback).

---

## Suggested order
A (cleanup) → B1+B2 (ASC + MER, biggest paid wins) → C1+C2 (real content production + publish) → D1+D2+D3 (recurring revenue + retention) → E (brand/measurement/hardening).

**Status 2026-09-09 (end of session):** A, B, C0, **all of D** and **all of E** are done;
suite **735 green**. C1–C6 stay deferred by client direction (AI content is opt-in and nobody
has opted in) — **that deferred Group C spec is the only remaining work in this plan.** Each
task:
branch, implement, add tests, run the full suite in a writable copy, keep it green.

## Definition of done (per task)
1. Code uses `paths.js` (no hardcoded client paths) and obeys `CLAUDE.md`.
2. New/changed behavior has tests; `node --test test/*.test.js` passes in a writable copy.
3. Any new skill has a `SKILL.md`, is routed in `CLAUDE.md`, and (if it renders) ships HTML+PDF via the shared design system.
4. No doc-vs-reality drift: don't claim a capability the code doesn't have.
