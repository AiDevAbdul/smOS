---
name: attribution
description: Use this skill to measure incremental conversions and conversion lift for a client's Meta ads — shifting reporting off naive last-click onto sourced incrementality. This skill should be used when the user asks "are the ads actually causing sales", wants conversion-lift / incrementality numbers, or invokes `/attribution {slug}`. Pulls a Meta Conversion Lift study (or a provided lift export), computes incremental conversions, incremental CPA, and the gap vs last-click per campaign, and ships an HTML+PDF report. Fail-closed: refuses to publish a "lift" number with no measurement method attached.
---

# /attribution — Incrementality / Conversion Lift (Phase 3.1)

Moves smOS reporting off last-click. Ingest a Meta Conversion Lift study (or a
provided lift-study export), compute incremental conversions / incremental CPA /
lift factor per campaign with the measurement method attached, and emit an
attribution report (JSON + HTML + PDF). Never present last-click numbers dressed
up as "lift" — rows without a measured incremental figure are rejected, not
back-filled.

## What This Skill Does

- Resolve a lift source by priority: (1) live Meta Conversion Lift study (study id + token), (2) provided `lift_export.json`, (3) HALT.
- Pull the study via the shared Graph client and map measurable cells to canonical rows (`scripts/lib/lift_study.js`).
- Compute, per campaign: last-click conversions, incremental conversions, incremental CPA, lift factor.
- Normalize + fail-closed validate against `schemas/attribution_report.js`, then write `attribution_report.json` + `.md` + `.html` + `.pdf`.
- Best-effort persist the report to the Supabase `lift_studies` table.

## What This Skill Does NOT Do

- Does NOT run on-demand last-click performance breakdowns — that is `/analyze`.
- Does NOT make scaling/pausing decisions from lift — that is `/scale` / `/rules`.
- Does NOT design or launch the holdout/test cells of a lift study (done in Meta Experiments UI / Ads Manager — manual).
- Does NOT set up the pixel/CAPI events that conversions are measured against — that is `/capi-setup`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `schemas/attribution_report.js`, `scripts/lib/lift_study.js`, `scripts/lib/meta-graph.js`, `scripts/lib/tokens.js`, `scripts/lib/md_to_html.js`, `scripts/lib/supabase.js` |
| **Conversation** | The `{slug}`, the measurement method (if the user named one), any study id |
| **Skill References** | Lift taxonomies/formulas + I/O schema from `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` — `accounts.ad_account_id`, `accounts.access_token`, `attribution.lift_study_id` |

## Clarifications

> Before asking: check the conversation, the client profile, and any `lift_export.json` already in the client dir.
> Only ask for what cannot be determined. Lift methods, formulas, and the JSON contract are embedded in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. A lift source must exist — confirm one of: a `--study-id`/`SMOS_LIFT_STUDY_ID`/`profile.attribution.lift_study_id` reachable with a token, OR `clients/{slug}/lift_export.json`. If none, the skill HALTs (this is correct, not a failure to paper over).

**Optional (ask only if relevant):**
3. Measurement method label (`--method=`) — defaults to `meta_lift_study`. Allowed: `meta_lift_study`, `incremental_attribution`, `geo_holdout`, `ghost_ads`, `modeled`.
4. Reporting window (`SMOS_PERIOD_START` / `SMOS_PERIOD_END`) — otherwise inherited from the study's `start_time`/`end_time`.

## Workflow

1. Verify `clients/{slug}/client_profile.json` exists — else HALT (exit 3).
2. Resolve the study id (`--study-id=`, then `SMOS_LIFT_STUDY_ID`, then `profile.attribution.lift_study_id`) and a `user`-kind token via `resolveToken` (require:false).
3. If online and a study id + token resolve: `GET /{studyId}` with cell fields, write `lift_study_raw.json`, map measurable cells via `mapLiftStudy`.
4. If no rows yet and `lift_export.json` exists: load `rows[]` from it.
5. If still no rows: HALT (exit 4) — refuse to emit last-click as lift.
6. Normalize → `schema.validate`; on failure print errors and exit 5.
7. Render `attribution_report.json` + the Markdown table → HTML + PDF; best-effort persist to `lift_studies`.

Run: `node skills/attribution/attribution.js <slug> [--method=M] [--study-id=ID]`

## Input / Output Specification

**Inputs:** arg `<slug>` (required); flags `--method=`, `--study-id=`; env `SMOS_OFFLINE`, `SMOS_LIFT_STUDY_ID`, `SMOS_PERIOD_START`, `SMOS_PERIOD_END`, token vars via `scripts/lib/tokens.js`; files `clients/{slug}/client_profile.json` (required), `clients/{slug}/lift_export.json` (optional fallback).
**Outputs:** `clients/{slug}/attribution_report.json` (shape: `schemas/attribution_report.js`), `attribution_report.md|html|pdf`, `lift_study_raw.json` (when a live study is pulled); best-effort row in Supabase `lift_studies`.
**Exit codes:** `2` no slug · `3` missing profile · `4` no measured incremental data (HALT) · `5` schema invalid · `0` success.
(Full schemas, example payloads, edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Slug, ad account, study id, token | Source-priority order (study → export → HALT) |
| Measurement method label | Allowed method enum + "method required" rule |
| Reporting window, campaign rows | The honesty contract: no incremental figure → row rejected |
| Lift study result shape (`results` vs `result_set`) | Cell→row mapper field-aliasing in `lift_study.js` |
| Confidence / p-value present or not | Report layout, design tokens, Graph API v25.0 |

## Domain Standards

### Must Follow
- [ ] Every published incrementality number declares its `method` (one of the allowed enum).
- [ ] Each report row carries a measured `incremental_conversions` OR `incrementality_factor`.
- [ ] Show last-click side-by-side with incremental so the gap is visible.
- [ ] Default new entities and any account writes to PAUSED — this skill is read-only on the ad account regardless.
- [ ] Ship HTML + PDF (per CLAUDE.md every client-facing report does).

### Must Avoid
- Synthesizing or back-filling an incremental figure from last-click.
- Silently degrading to last-click when the study is still running / unmeasurable.
- Reusing a global page token in a multi-client setup (resolve per-client via `tokens.js`).
- Auto-retrying Meta API errors (the shared client handles transient retry; do not loop on hard errors).

### Output Checklist (verify before delivery)
- [ ] `attribution_report.json` validates (`schema.validate().ok`).
- [ ] `method` set and in enum; `period_start`/`period_end` populated when known.
- [ ] Every row has an incremental figure; none degraded to last-click.
- [ ] HTML + PDF written; Supabase persist attempted (or cleanly skipped).

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `<slug>` arg | Print usage, exit 2 — never guess |
| `client_profile.json` not found | HALT, name the path, exit 3 |
| Study id set but no token resolved | Note it, fall back to `lift_export.json` |
| Live study pull throws | Log `e.message`, continue to export fallback |
| Study returns no measurable cells | Note "still running / unsupported shape", treat as no rows |
| No measured incremental data anywhere | HALT, exit 4 — refuse last-click-as-lift |
| Schema invalid | Print each error, exit 5 |
| Meta API error | Surfaced by `meta-graph.js` with code/type/`fbtrace_id`; token-expiry (190) is non-retryable |
| Supabase unconfigured / insert fails | Log "persist skipped", still succeed (report files are the deliverable) |

## Dependencies & Security

- **Reuses:** `schemas/attribution_report.js`, `scripts/lib/lift_study.js`, `scripts/lib/meta-graph.js` (v25.0, guards + retry), `scripts/lib/tokens.js`, `scripts/lib/md_to_html.js` (→ `scripts/render_pdf.py`), `scripts/lib/supabase.js`, `scripts/lib/load-env.js`.
- **External APIs:** Meta Graph API v25.0 — Conversion Lift study node read only (no account mutations). Rate limits + error codes in `references/api-reference.md`.
- **Secrets:** access tokens resolved via env / `scripts/lib/tokens.js` (`META_ACCESS_TOKEN_<SLUG>` preferred, global `META_ACCESS_TOKEN` discouraged) — never hardcoded or logged. PDF rendering requires `playwright` + Chromium (`pip install playwright && python -m playwright install chromium`).

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API root | https://developers.facebook.com/docs/graph-api/ | Node/edge/field read model |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Confirm v25.0 pin / lifecycle |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Insights + measurement entry point |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage`, codes 4/17/613 |
| CAPI overview | https://developers.facebook.com/docs/marketing-api/conversions-api/ | What conversions are measured against |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Lift methods, formulas (incremental CPA, lift factor), thresholds, good/bad report examples |
| `references/api-reference.md` | Conversion Lift study node fields, endpoint, v25.0, rate limits, error codes (cited URLs) |
| `references/io-contract.md` | Full `attribution_report.json` schema, `lift_export.json` shape, example payloads, edge cases |
