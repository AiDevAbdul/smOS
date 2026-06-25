---
name: pre-audit
description: Use this skill when the user asks to audit, scope, or pitch an unsigned prospect before client onboarding (typically via `/pre-audit`). Produces a branded HTML+PDF sales artifact scored 0–100 from public data only — Facebook Page, Instagram, Meta Ad Library, website tracking surface, competitor outspend, and a scored competitor creative matrix — with tiered wins/gaps, opportunity sizing, and three recommendations. No client API access required; the Node wrapper renders the report and advances the CRM deal to `audited`.
---

# /pre-audit — Pre-Onboarding Prospect Audit (Phase 5)

Produce a sales asset that scores an *unsigned* prospect 0–100 from public surfaces only,
then render it through the standardized HTML+PDF template and advance the CRM deal. This is
the "before contract" companion to `/audit`: it needs no ad-account or pixel access, so a
prospect can be pitched within an hour of first contact.

The report produces an emotional arc — **recognition → clarity → relief** — across nine
sections. The prospect sees themselves in the data, understands what is broken, and leaves
believing the agency can fix it.

## What This Skill Does

- Gathers public-data inputs (one clarification at a time): Facebook Page, Instagram profile, Meta Ad Library self-check, competitor outspend + creative matrix scan, website tracking surface, optional niche playbook.
- Writes three input JSON files to `prospects/{slug}/`: `page_audit.json`, `competitor_summary.json`, `synthesis.json` (tiered wins/gaps, recommendations, opportunity sizing, 0–100 score, outspend ratio).
- Runs `node skills/pre-audit/pre-audit.js <slug> --business "Name"` to render the standardized HTML via `scripts/meta-ad-library/pre_audit_report.py`, convert to PDF via `scripts/render_pdf.py`, advance the CRM deal to `audited`, and best-effort insert a `prospect_audits` row.

## What This Skill Does NOT Do

- Does not touch any client Meta API (ad account, pixel, insights) — that is `/audit`, which runs post-signature.
- Does not run the competitor Ad Library pulls itself — it reuses the `/research` engine (`scripts/meta-ad-library/`).
- Does not create a client or `client_profile.json` — `/intake` owns onboarding and hydrates from this audit on conversion.
- Does not write per-prospect HTML renderers — the template is fixed (see Must Avoid).
- Does not pitch or send the proposal — `/proposal` owns the next CRM stage.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/meta-ad-library/{client,analyzer,classifier,report,market,pre_audit_report,persist}.py`; `scripts/render_pdf.py`; `skills/pre-audit/pre-audit.js`; `scripts/lib/crm-store.js`; `schemas/deal.js` |
| **Conversation** | Business name, page/IG/website URLs, named competitors, country already stated |
| **Skill References** | Scraping tactics + scoring rubric in `references/` (see table below) |
| **Existing deal** | `crm/pipeline.json` via `getDeal(slug)` — reuse `source`/`activities` instead of re-creating |

## Clarifications

> Before asking: check the conversation and any existing `crm/pipeline.json` deal. Domain
> knowledge (scoring weights, scraping headers, thresholds) lives in `references/` — never
> ask the user for it.

**Required (must resolve before running):**
1. Business name (report title) and `{slug}`.
2. Facebook Page URL.
3. Website URL.
4. Either ≥2 named competitors OR a niche with a `data/niches/<niche>.json` file — if neither, ask for at least 2 named competitors.

**Optional (ask only if relevant):**
5. Instagram handle (skipped if absent).
6. Country (default `US`).
7. Niche label (used to look up the optional category playbook).

## Workflow

1. Resolve the required clarifications (one question at a time).
2. Run the public-data passes (details in `references/domain-standards.md` and `references/api-reference.md`):
   - FB+IG page audit (profile completeness, posting frequency, format mix, ER)
   - Ad Library self-check (active ads, run duration, survival past 60d)
   - Competitor scan: outspend + creative matrix (hook, visual, CTA, trigger, duration)
   - Website tracking surface (Pixel, GTM, GA4, conversion events, viewport)
   - Optional niche sweep
   Mark any blocked fetch `unverified` — never fabricate from absence.
3. Compute the 0–100 score (five equal 20% dimensions), three-tier wins/gaps, max-3 recommendations, opportunity sizing (bottom-up + top-down), and 30/60/90 next steps.
4. Write `page_audit.json`, `competitor_summary.json`, `synthesis.json` to `prospects/{slug}/` (schemas in `references/io-contract.md`).
5. Run the wrapper: `node skills/pre-audit/pre-audit.js {slug} --business "<Name>" [--niche-html prospects/{slug}/reports/market_<ts>.html] [--no-crm]`.
6. Send the prospect the HTML/PDF. Print the wrapper's JSON summary; next step is `/proposal {slug}`.

## Input / Output Specification

**Inputs (to the wrapper):** positional `<slug>`; flags `--business "Name"` (default = slug), `--niche-html <path>` (optional), `--no-crm` (skip CRM write). Required files in `prospects/{slug}/`: `page_audit.json`, `competitor_summary.json`, `synthesis.json` — the wrapper exits `2` if any are missing.

**Outputs:** `prospects/{slug}/pre_audit.html` (interactive sales artifact), `prospects/{slug}/pre_audit.pdf` (shareable; skipped if Playwright absent), CRM deal advanced to `audited` with `links.pre_audit` set, best-effort `prospect_audits` row. The wrapper prints a JSON object (`{slug, business, html, pdf, crm, persisted, next}`).

(Full schemas, example payloads, and exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per prospect / run) | What's CONSTANT (encoded in skill) |
|----------------------------------|------------------------------------|
| Business name, page/IG/website URLs, competitors, country, niche | Five-dimension equal-weight scoring rubric (20% each) |
| Whether IG / niche file / ads exist (each optional, fail-soft) | Scraping headers (mobile UA, `en_US` locale cookie, `X-IG-App-ID`) |
| Outspend ratio, score, tiered wins/gaps, creative matrix scores | Standardized HTML template (9 sections, warm editorial design) |
| Tracking stack found (Pixel/GTM/GA4) | CRM transition target = `audited`; output paths under `prospects/{slug}/` |
| Opportunity sizing inputs (budget, revenue goal) | Industry benchmarks: CPA $38.19, ROAS 1.86×, CPL $27.66 |

## Domain Standards

### Must Follow
- [ ] Render through `scripts/meta-ad-library/pre_audit_report.py` only — the one standardized template.
- [ ] Save under `prospects/{slug}/`, never `clients/{slug}/` (prospect has not signed).
- [ ] Mark any blocked/timed-out fetch `unverified`; score it as unknown, do not infer absence.
- [ ] Include top-3 wins (credibility), not only gaps, so the report reads as honest.
- [ ] Ship both HTML and PDF (PDF only skipped when Playwright is uninstalled).

### Must Avoid
- Writing a per-prospect Python/HTML renderer — edit the shared template instead so every prospect inherits the section.
- Calling any client Meta API endpoint requiring a token.
- Hardcoding "now" — compute recency from the audit date or post timestamps go negative.
- Fabricating likes/followers/spend when the source returned a non-200.

### Output Checklist (verify before delivery)
- [ ] `page_audit.json`, `competitor_summary.json`, `synthesis.json` present and schema-valid.
- [ ] `pre_audit.html` opens; canvas score gauge animates, five dimension bars animate on scroll.
- [ ] All nine sections render: Score, Profile, Organic, Paid Ads, Competitors, Wins & Gaps, Opportunity, Recommendations, Next Steps (CTA).
- [ ] Creative matrix columns visible in competitor table (or "No competitor data" fallback if none).
- [ ] Wins & Gaps show tier labels (Quick Win / Retainer Scope / Roadmap) if `wins_tiers` present; falls back to flat list gracefully.
- [ ] Opportunity Sizing section shows industry benchmarks table; prospect projections shown if `opportunity_sizing` present.
- [ ] 30/60/90 timeline in CTA section populated (custom or default fallback text).
- [ ] `pre_audit.pdf` exists (or wrapper logged the Playwright-missing reason).
- [ ] CRM deal at `audited` with `links.pre_audit` (unless `--no-crm`).
- [ ] Summary JSON printed; `outspend_ratio` matches the hero headline.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing required input file | Wrapper exits `2` naming the files — gather them first, never guess |
| `pre_audit_report.py` fails | Wrapper exits `3` with first 500 chars of stderr — fix the inputs, re-run |
| PDF render fails (no Playwright) | Wrapper continues, HTML still produced; run `pip install playwright && python -m playwright install chromium` |
| FB/IG fetch non-200 | Save with `fetch_status: "blocked_<code>"`, mark sub-tree `unverified` |
| Ad Library rate-limit (429) | Backoff 30s, retry once, then proceed without that competitor |
| Page URL returns 404 | Halt, ask user to verify the URL |
| No competitors AND no niche file | Ask user for ≥2 named competitors before continuing |
| CRM write fails | Wrapper returns `crm.error` but does not fail the run; report still delivered |

## Dependencies & Security

- **Reuses:** `scripts/meta-ad-library/` (shared with `/research`), `scripts/render_pdf.py`, `scripts/lib/crm-store.js` (`getDeal`/`upsertDeal`), `schemas/deal.js` (`isValidTransition`), `scripts/lib/supabase.js`, `scripts/lib/load-env.js`.
- **External APIs:** Meta Ad Library `ads_archive` (public, no token); Instagram `web_profile_info` and `m.facebook.com` (public, unauthenticated). No client Meta token. Rate limits and headers in `references/api-reference.md`.
- **Secrets:** Supabase keys resolved via `loadEnv()` / env — never hardcoded or logged. The classifier's LLM key comes from env. No per-client Meta token is used.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Ads Archive (ads_archive) | https://developers.facebook.com/docs/graph-api/reference/ads_archive/ | Public ad-library fields used for self + competitor scans |
| Archived Ad node | https://developers.facebook.com/docs/graph-api/reference/archived-ad/ | Returned fields (`ad_creative_bodies`, `impressions`, `spend`, `funding_entity`) |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | 429 backoff; codes 4 / 17 / 613 |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | `fbtrace_id` logging, code-10 metadata-access note |
| Outcome objectives (ODAX) | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | Ad-maturity classification of competitor objectives |
| WCAG SC 1.4.3 Contrast | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | Report color-contrast (4.5:1) for shareable deliverable |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Scoring rubric + weights, the three advertiser-maturity buckets, wins/gaps/opportunities synthesis rules, good/bad report examples |
| `references/api-reference.md` | Exact public-scrape recipes — `m.facebook.com` UA + locale cookie, IG `web_profile_info` + `X-IG-App-ID`, Ad Library fields/version, website-tracking regexes, 400/429 handling |
| `references/io-contract.md` | Full JSON schemas for the three input files + wrapper output, example payloads, exit codes, edge cases |
