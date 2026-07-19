# /pre-audit — Deep Evaluation & SWOT
**Date:** 2026-07-15 · **Method:** 4 parallel subagent audits (skill core, shared scripts, downstream wiring, usage evidence) + direct verification against disk

---

## 1. System Map — what's actually wired to /pre-audit

```
INPUTS (public only)                    PIPELINE                              CONSUMERS
─────────────────────                   ────────────────────────────          ─────────────────────────
m.facebook.com scrape ─┐                skills/pre-audit/pre-audit.js (153L)  /crm      → deal stage → audited
IG web_profile_info ───┤                  ├─ collect.py   (138L) raw JSON     /proposal → reads synthesis.json
website regex scan ────┼─ collectors.py   ├─ normalize.py (191L) signals.csv  /intake   → hydrates from page_audit.json
Meta Ad Library API ───┘  client.py       ├─ build.py     (275L) 3 JSONs      /bundle   → Phase 1 of client hub
Claude vision (opt.) ──── classifier.py   ├─ pre_audit_report.py (1,091L)     Supabase  → prospect_audits (best-effort)
                                          └─ render_pdf.py (70L) Playwright
SHARED INFRA: paths.js · crm-store.js · schemas/deal.js · design_system.py · smos-design-system.css
Total pipeline: ~2,791 lines. Outputs: prospects/{slug}/data/* + deliverables/pre-audit/pre-audit.{html,pdf}
```

**Contract flow:** raw JSON → `signals.csv` (human-editable source of truth) → `page_audit.json` + `competitor_summary.json` + `synthesis.json` → single canonical HTML template → PDF. Scoring is 5 equal-weight 20% dimensions (profile presence, posting consistency, paid maturity, competitor position, tracking foundation). Optional `narrative.json` overlay polishes prose without touching the score.

---

## 2. Deep Evaluation Findings

### Architecture (strong)
- Deterministic: same `signals.csv` → byte-identical JSON + HTML. Re-render without re-scrape via `--rebuild`.
- Fail-soft collection: each pass records `status` (ok / blocked / timeout / no_token) — never fabricates missing data.
- Fail-closed where it matters: missing render inputs → exit 2; CRM stage advance validates `isValidTransition(current, "audited")`.
- Single canonical renderer, 43 `e()` HTML-escape call sites, no injection paths found (colors in style attrs are constants, never user input).
- All optional deps degrade gracefully: no META token → skip Ad Library; no ANTHROPIC key → skip creative matrix; no Playwright → HTML-only; Supabase down → local JSON remains authoritative.

### Wiring health (clean, no breaks)
- Downstream consumers (/proposal, /intake, /bundle) all have graceful fallbacks when pre-audit artifacts are absent.
- All paths resolve through `scripts/lib/paths.js` — no hardcoded path drift in code.
- CRM write is non-fatal: deliverables still ship if the deal update fails.

### Evidence on disk (the honest picture)
- **9 prospect folders**, ~6 with full HTML+PDF deliverables — this is the most-exercised artifact in smOS.
- **BUT: zero prospects contain `signals.csv`.** Every real report predates the current collect→normalize→build refactor. The pipeline as it exists today has only ever passed its own fixture test (`test/pre-audit-pipeline.test.js`, 5 assertions) — never a live prospect.
- **Path-layout drift:** older prospects (abdulwahab, hope87, actiondigital) carry duplicate artifacts in legacy root layout (`pre_audit.html`) alongside the new `deliverables/pre-audit/` layout; bacreation stores raws in `reports/` instead of `data/raw/`. No migration or cleanup was done.
- Prior internal reviews already flagged: fabricated benchmarks (Expert Review 06-21), measurement-spine isolation (Full Eval 06-30), zero live conversion proof (Gap Analysis 07-14). None fully remediated.
- blue-rose-auto did come through pre-audit → intake, but stalled pre-launch; the sales artifact has never been proven to convert into a live, spending client.

### Data-quality risks
- Scrapers are unauthenticated regex parsers against `m.facebook.com` and IG `web_profile_info` with UA spoofing — brittle against markup changes and soft-blocks, and gray-zone vs platform ToS. IG frequently returns `blocked`; template then falls back to weaker FB signals.
- Benchmarks anchoring the opportunity sizing and 2 of 5 score dimensions are hardcoded, uncited, and stale: $38.19 CPA, 1.86× ROAS, 11.3% ad survival, 0.55% ER, $27.66 CPL — labeled "(2025)" in a 2026 sales document. A prospect's savvy marketer could discredit the whole report on these.
- Report timestamp uses `datetime.now()` not `fetched_at` — re-renders silently mis-date the audit.
- Hardcoded `abdul@duckercreative.com` CTA in the template (line 954) — fine today, breaks white-labeling.
- No `requirements.txt` for the Python side; deps inferred, unpinned.
- No schema validation on manually edited `signals.csv` — an operator typo crashes rebuild with a raw traceback.

---

## 3. SWOT

### Strengths
1. **Best-engineered skill in smOS.** Deterministic 4-stage pipeline, single canonical template, honest missing-data fallbacks, proper HTML escaping, 6 meaningful exit codes.
2. **Zero-access sales weapon.** Needs no client credentials — public data → branded, scored, designed HTML+PDF. Genuinely differentiated agency positioning ("we audited you before you signed").
3. **Human-auditable core.** `signals.csv` as editable source of truth + score-immutable narrative overlay is a rare, well-thought-out human-in-the-loop design.
4. **Clean downstream integration.** CRM stage machine, /proposal findings reuse, /intake hydration, /bundle hub — all wired with graceful fallbacks; nothing breaks if pre-audit is skipped.
5. **Actually used.** 9 prospects, ~6 shipped reports — more real mileage than any other smOS skill — plus a dedicated integration test.

### Weaknesses
1. **The current pipeline is unproven on real prospects.** All shipped reports predate the refactor; no `signals.csv` exists on disk. The tested path and the used path are different code vintages.
2. **Fabricated/stale benchmarks** underpin opportunity sizing and 40% of the score. This is a credibility time-bomb in a *sales* document — flagged in three prior internal reviews, still unfixed.
3. **Scraper fragility.** Regex over mobile-web HTML + unofficial IG endpoint; frequent soft-blocks already degrade real reports (IG "unverified" fallbacks). No proxy/retry strategy beyond one Ad Library 429 backoff.
4. **Prospect-data hygiene debt.** Two coexisting directory layouts, duplicate artifacts, raws scattered in `reports/` — /bundle and /intake hydration rely on the *new* layout only.
5. **Operational rough edges:** `datetime.now()` timestamp bug, hardcoded agency email, no requirements.txt, no CSV schema validation, LLM creative-matrix scores are non-deterministic run-to-run (cached, but first runs vary).

### Opportunities
1. **Swap scrapers for sanctioned sources.** The smos plugin already ships tavily/duckduckgo/meta MCP servers — routing FB/IG collection through them (or Ad Library-only + human-pasted stats into signals.csv) removes the ToS gray zone and most fragility.
2. **Live benchmark refresh.** A small `benchmarks.json` with source + date, refreshed quarterly via WebSearch, turns the weakest section into a defensible one and de-hardcodes build.py + the template in one move.
3. **Re-audit cadence = pipeline nurture.** Scheduled quarterly re-runs per prospect (diff vs prior synthesis.json) creates a "here's what got worse since we told you" follow-up motion — the CRM already tracks `audited` deals to target.
4. **Close the conversion loop.** Pre-audit's predicted opportunity vs post-signing actuals (/analyze data) would let you score your own audit accuracy — unique proof for future pitches.
5. **White-label readiness.** Tokenize the CTA email/agency identity and this becomes a sellable deliverable engine for other agencies (aligns with /portal's white-label direction).

### Threats
1. **Meta closing public surfaces.** m.facebook.com markup changes, IG endpoint lockdown, or Ad Library API tightening could zero out 3 of 4 data passes overnight. No monitoring exists to detect silent scraper rot.
2. **Prospect blowback on numbers.** One prospect fact-checking "$38.19 industry CPA (2025)" publicly or in-room damages agency credibility beyond that deal.
3. **ToS/legal exposure.** UA-spoofed scraping of FB/IG for commercial sales collateral risks the agency's own Meta business assets — the same assets every other smOS skill depends on. This is the highest asymmetric risk in the system.
4. **Silent divergence.** Because collection is fail-soft and CRM/Supabase writes are best-effort, a fully degraded run (all passes blocked, no persistence) still produces a confident-looking scored PDF. Nothing forces a minimum-data-quality gate before a report ships to a prospect.
5. **Refactor regression.** The next real prospect run exercises the new pipeline for the first time in production; legacy-layout prospects may confuse /intake hydration or /bundle.

---

## 4. Priority Recommendations

| # | Action | Fixes | Effort |
|---|--------|-------|--------|
| 1 | Add a **minimum-data-quality gate**: refuse to render (or watermark "LOW CONFIDENCE") when ≥2 collection passes are blocked | T4 — confident reports from empty data | S |
| 2 | Externalize benchmarks to `benchmarks.json` with source+date; refresh via WebSearch; cite in report footnotes | W2, T2 | S |
| 3 | Run **one live prospect end-to-end** through the new pipeline and diff against a legacy report; then migrate/clean legacy prospect layouts | W1, W4, T5 | M |
| 4 | Fix `datetime.now()` → `fetched_at`; tokenize CTA email; add `requirements.txt` + CSV schema validation | W5 | S |
| 5 | Route FB/IG collection through Tavily/Meta MCPs (or manual-paste mode) to exit the scraping gray zone; add a weekly scraper-health canary | W3, T1, T3 | M–L |

**Verdict:** /pre-audit is the strongest, most battle-tested skill in smOS with genuinely good engineering discipline — but its two load-bearing inputs (gray-zone scrapers, invented benchmarks) are exactly the parts a prospect or Meta could break. Fix the credibility layer (items 1–2) before the next pitch; fix the data layer (item 5) before scaling past ~3 audits/day.
