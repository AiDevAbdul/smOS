---
name: research
description: Use this skill to pull a client's competitors' live ads from the Meta Ad Library and analyze their formats, angles, offers, CTAs, and competitive gaps. This skill should be used when the user asks for competitor research, ad-library analysis, or competitive intel for a client — typically via `/research {slug}`. Produces `competitor_intel.json` (with a top-level `angles` array) plus a ranked HTML/PDF report that feeds `/strategy-brief`.
---

# /research — Competitor Ad Intelligence (Phase 3 · Pre-Strategy)

Pull every competitor's currently-running ads from the public Meta Ad Library, cluster them into angles/offers/CTAs, diff against the prior snapshot, and emit `competitor_intel.json` — the canonical input `/strategy-brief` reads to choose creative angles. Output ships as JSON + ranked HTML + PDF.

## What This Skill Does

- Resolve each `profile.competitors` entry to a Meta Page ID (numeric → used directly; name → Graph `/ads_archive` search, pick the highest-ad-volume matching page).
- Fetch active ads per page via the Python pipeline (`client.py`), analyze them (`analyzer.py`), LLM-classify angles (`classifier.py`), render HTML (`report.py`), and convert to PDF.
- Diff against the most recent prior `analyzed_*.json` snapshot when one exists (`differ.py`).
- Normalize results through `schemas/competitor_intel.js` into `competitor_intel.json` and print a machine-readable summary on stdout.

## What This Skill Does NOT Do

- Score or grade creative quality with vision — that is `/audit-creative`.
- Synthesize the launch plan or pick the winning angle — that is `/strategy-brief` (it reads this skill's `angles`).
- Audit the client's own account/page — that is `/audit`.
- Persist to Supabase `reports`/`competitor_snapshots` — `research.js` writes files only; run `scripts/meta-ad-library/persist.py` separately if a DB snapshot is wanted.
- Download creative assets — `creatives.py` exists for `/audit-creative`; this skill does not call it.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, pinned v25.0), `scripts/meta-ad-library/*.py`, `schemas/competitor_intel.js`, `scripts/render_pdf.py` |
| **Conversation** | Lookback window, country override, whether to skip LLM classification |
| **Skill References** | Angle taxonomy + gap formulas (`references/domain-standards.md`); endpoints (`references/api-reference.md`); output shape (`references/io-contract.md`) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `competitors`, `audience.geo_targets`, `location.country`, `business.usp` |

## Clarifications

> Before asking: check the conversation, the client profile, and prior `reports/analyzed_*.json`.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. The client `{slug}` (must have `clients/{slug}/client_profile.json`).
2. At least **2** entries in `profile.competitors` — the run halts below 2. If short, ask the user for competitor names or Facebook Page IDs.

**Optional (ask only if relevant):**
3. Lookback window (`--days`, default 90).
4. Country override (`--country`, default = first `geo_targets` entry, else profile country, else `US`).
5. Skip LLM angle classification (`--skip-classify`).

## Workflow

1. Run `node skills/research/research.js {slug} [--days N] [--country CC] [--skip-classify]`.
2. The script: loads `.env`, reads the profile, halts if `competitors.length < 2`, resolves page IDs via Graph `/ads_archive`, then chains `client.py → analyzer.py → classifier.py → report.py → render_pdf.py → differ.py`.
3. It normalizes the analyzed output through `competitorSchema.normalize(...)` and writes `clients/{slug}/competitor_intel.json`.
4. Review the printed summary + the ranked HTML, then proceed to `/strategy-brief`.

A failing `classifier.py`, `render_pdf.py`, or `differ.py` is non-fatal — the script logs and continues. Only a missing profile, `<2` competitors, zero resolved page IDs, or a `client.py`/`analyzer.py`/`report.py` failure halts the run.

## Input / Output Specification

**Inputs:** CLI `{slug}` + optional `--days`, `--country`, `--skip-classify`; `clients/{slug}/client_profile.json`; `META_ACCESS_TOKEN` (loaded by `loadEnv()`).
**Outputs:** `clients/{slug}/competitor_intel.json` (canonical; top-level `angles`, `competitors`, `gaps`, `client_slug`, passthrough `generated_at`/`country`/`days_window`/`artifacts`); `clients/{slug}/reports/{raw,analyzed}_<ts>.json`; `competitor_report_<ts>.html` + `.pdf`; `snapshot_diff_<ts>.json` (when a prior snapshot exists). A JSON summary is printed to stdout.
(Full schema, the exact `competitor_intel.json` shape, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Competitor list, geo_targets, business USP | Graph API version (v25.0), `/ads_archive` edge as canonical path |
| Lookback `--days`, `--country` | 6-theme angle taxonomy, gap categories (format/angle/offer/voice) |
| Number/activity of competitors | Halt-below-2-competitors gate; PDF + HTML dual output |
| Whether a prior snapshot exists | `competitor_intel.json` normalized shape (via schema) |

## Domain Standards

### Must Follow
- [ ] Halt when `profile.competitors` has fewer than 2 entries — never fabricate competitors.
- [ ] Treat Graph `/ads_archive` as the canonical resolution path (an MCP `search_ad_library` tool is NOT used).
- [ ] Resolve a name by tallying `page_id` across returned ads and picking the most frequent match.
- [ ] Write the final JSON through `competitorSchema.normalize()` so the top-level `angles` array always exists.
- [ ] Surface, never swallow, a fatal pipeline failure; let non-essential passes degrade gracefully.

### Must Avoid
- Inventing a `format_mix` field — the schema does NOT write one; do not document or expect it.
- Renaming `angles` to `top_angles` in output — `/strategy-brief` reads `.angles`.
- Auto-retrying on a rate-limit (code 4 / 17 / 613) — halt and surface `fbtrace_id`.
- Re-pulling ads already captured in `raw_<ts>.json`.

### Output Checklist (verify before delivery)
- [ ] `competitor_intel.json` exists and has a non-null `angles` array (may be empty = degraded-but-valid).
- [ ] `competitors`, `gaps`, `client_slug`, `artifacts` present; NO `format_mix` key.
- [ ] Ranked HTML written; PDF written or its skip logged.
- [ ] stdout summary printed with `intel_path`, `gap_count`, and `next` hint.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Halt with the missing path — never guess |
| `< 2` competitors in profile | Halt; ask user for ≥2 names or Page IDs |
| Name resolves to no page | Record `status: inactive_or_not_found`, continue |
| Zero page IDs resolved overall | Halt — ask user to supply Page IDs directly |
| Empty geo result | Re-run with `--country US`; flag in output |
| Rate limit (code 4 / 17 / 613) | Halt, surface `fbtrace_id`, do not auto-retry |
| `classifier.py` fails | Log, continue with regex-derived angles |
| `render_pdf.py` / `differ.py` fails | Log, continue; PDF/diff omitted |
| `client.py` / `analyzer.py` / `report.py` fails | Fatal — exit non-zero with stderr |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js`, `scripts/lib/load-env.js`, `schemas/competitor_intel.js` (via `schemas/index.js`), `scripts/meta-ad-library/{client,analyzer,classifier,report,differ}.py`, `scripts/render_pdf.py`.
- **External APIs:** Meta Graph API **v25.0** — `/ads_archive` edge (public, no ad-account access). Rate limits + fields in `references/api-reference.md`.
- **Runtime:** Node (ESM) + Python 3 (`python3` on PATH); Playwright Chromium for PDF (`pip install playwright && python -m playwright install chromium`).
- **Secrets:** `META_ACCESS_TOKEN` loaded via `loadEnv()`; `meta-graph.js` adds `appsecret_proof` when the app secret is present. Never hardcoded or logged.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Ads Archive (ads_archive) | https://developers.facebook.com/docs/graph-api/reference/ads_archive/ | Search params: `search_terms`, `ad_reached_countries`, `ad_active_status`, `search_page_ids`, fields |
| Archived Ad node | https://developers.facebook.com/docs/graph-api/reference/archived-ad/ | Returned fields: `ad_creative_bodies`, `ad_snapshot_url`, `page_id/name`, `spend`, `impressions` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4 / 17 / 613; `X-App-Usage` header |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | `fbtrace_id`, recovery, no auto-retry |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current (released 2026-02-18) |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Angle taxonomy, gap categories, resolution heuristics, good/bad examples |
| `references/api-reference.md` | `/ads_archive` exact params/fields, v25.0, rate-limit codes, cited URLs |
| `references/io-contract.md` | Full `competitor_intel.json` schema, CLI contract, example payloads, edge cases |
