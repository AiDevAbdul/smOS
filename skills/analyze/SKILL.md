---
name: analyze
description: Use this skill when the user asks to analyze, check, or review the live performance of a client's Meta ads (typically via `/analyze {slug}`). It runs `analyze.js`, which pulls 7/14/30-day insights for every active campaign/adset/ad, segments active adsets by placement/age-gender/device, classifies pause/scale/fatigue/anomaly flags against KPI thresholds with statistical-significance gates, computes an account Opportunity Score, ranks winners and losers, writes `performance_analysis.json` + HTML/PDF, and best-effort persists per-day rows to Supabase `daily_metrics`.
---

# /analyze — Performance Deep Dive (Phase 4 · Optimize)

Run an on-demand performance deep dive on a client's Meta ad account. Produce a machine-readable `performance_analysis.json` of derived metrics and classified flags that `/scale` executes against, plus a client-facing HTML+PDF summary. This skill reads and analyzes — it never mutates the account.

## What This Skill Does

- Pull every ACTIVE/PAUSED campaign, adset, and ad via `meta-graph.js`, with insights at `last_7d`, `last_14d`, `last_30d`.
- Segment active adsets at `last_14d` by placement, age+gender, and device (skippable with `--no-breakdowns`).
- Derive canonical metrics (spend, CPM, CTR, link CTR, CPC, CPA, ROAS, frequency) via `metrics.js`.
- Classify ad/adset flags (PAUSE, SCALE, CREATIVE_FATIGUE, anomalies) gated by `stats.js` significance tests.
- Compute one explainable account Opportunity Score (0–100) via `opportunity.js`.
- Rank top/bottom ads and highlight concentrated segments.
- Write `performance_analysis.json` + `performance_analysis.md`/`.html`/`.pdf`; best-effort upsert `daily_metrics`.

## What This Skill Does NOT Do

- Does NOT pause, scale, duplicate, or change any account entity — that is `/scale`.
- Does NOT generate the weekly client report (Drive/Slack/email delivery) — that is `/report`.
- Does NOT do 30-day trend/strategy reset or budget reallocation planning — that is `/monthly-review`.
- Does NOT score creative quality (vision review) — that is `/audit-creative`.
- Does NOT produce the immutable baseline snapshot — that is `/audit`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (client, `act()`, `paginate`, `isTbd`), `scripts/lib/metrics.js` (`deriveMetrics`, `normalizeKpis`, `DEFAULT_KPIS`), `scripts/lib/stats.js`, `scripts/lib/opportunity.js`, `scripts/lib/supabase.js`, `scripts/lib/md_to_html.js` |
| **Conversation** | Which client `{slug}`; whether breakdowns are wanted |
| **Skill References** | Thresholds/flags/formulas in `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.ad_account_id`, `accounts.currency`, `kpis`; per-client `CLAUDE.md` KPI overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. All thresholds and formulas are embedded
> in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. The client `{slug}` whose account to analyze.

**Optional (ask only if relevant):**
2. Skip segmentation breakdowns for a faster, lower-quota run? (maps to `--no-breakdowns`).

## Workflow

1. Resolve `{slug}`; confirm `clients/{slug}/client_profile.json` exists and `accounts.ad_account_id` is not TBD.
2. Run the script: `node skills/analyze/analyze.js {slug} [--no-breakdowns]`.
3. The script merges KPIs (`normalizeKpis`), pulls the campaign→adset→ad tree in batches of 5, derives metrics per window, classifies flags, computes the Opportunity Score, ranks winners/losers, and writes outputs.
4. Read the printed one-line JSON summary (flag counts, opportunity score, output path).
5. Hand off to `/scale` to execute the pause/scale recommendations.

## Input / Output Specification

**Inputs:** positional `{slug}`; flag `--no-breakdowns`; `clients/{slug}/client_profile.json`; env (`META_*`, optional `SUPABASE_*`).
**Outputs:** `clients/{slug}/performance_analysis.json` (+ `.md`/`.html`/`.pdf`); stdout one-line JSON summary; best-effort rows in Supabase `daily_metrics`.
**Exit codes:** `0` ok · `1` no slug / fatal · `2` profile not found · `3` `ad_account_id` is TBD.
(Full schemas + example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| `ad_account_id`, currency, KPI targets (CPA/ROAS/CTR) and pause/scale overrides | Flag taxonomy + classification logic, three time windows, batch size 5 |
| Number of campaigns/adsets/ads and their metrics | Significance gates (z-test, min-conversions), spend floors |
| Whether breakdowns run (`--no-breakdowns`) | Opportunity Score weights (scale .45 / reclaim .35 / refresh .20) |
| Primary conversion events (profile) | Insight field list, API version v25.0, output filenames |

## Domain Standards

### Must Follow
- [ ] Read KPI targets only via `normalizeKpis(profile)` — handles flat and nested shapes.
- [ ] Treat all CTR values as PERCENT (Meta's `ctr`/`inline_link_click_ctr` are already %).
- [ ] Gate CREATIVE_FATIGUE on a significant two-proportion z-test; gate auto-SCALE on min conversions.
- [ ] Compute flags as local arithmetic — never LLM-infer thresholds or values.
- [ ] Default to read-only; emit candidates, never execute account changes.

### Must Avoid
- Do NOT re-fetch windows already cached in `daily_metrics` when avoidable.
- Do NOT classify ROAS=0 with healthy link clicks as PAUSE — flag `ANOMALY_attribution`.
- Do NOT auto-retry on Meta rate-limit/token errors.
- Do NOT hardcode KPI numbers in prose; cite `references/domain-standards.md`.

### Output Checklist (verify before delivery)
- [ ] `performance_analysis.json` written with `flags`, `opportunity`, `winners`, `losers`, `segment_highlights`.
- [ ] Every flag carries `flag`, `metric`, `threshold`, and a one-line `reasoning`.
- [ ] HTML + PDF summary produced (PDF skip tolerated if Playwright absent).
- [ ] One-line JSON summary printed to stdout ending with the `/scale` next-step.

## Error Handling

| Scenario | Action |
|----------|--------|
| No slug argument | Exit `1` with usage string |
| Profile file missing | Exit `2` naming the path — never guess |
| `ad_account_id` is TBD | Exit `3`; route user to `/setup-accounts` |
| Meta rate limit / token error (codes 4/17/613/190) | `meta-graph.js` surfaces it; do not auto-retry; log fbtrace_id |
| Insights error for one entity | Store `{error}` for that window, continue (fail-soft per entity) |
| Active ad, zero impressions | Emit `ANOMALY_delivery_stall`, continue |
| ROAS=0 but link clicks healthy | Emit `ANOMALY_attribution`, do NOT mark PAUSE |
| Supabase unconfigured / insert fails | Skip persistence with a note; JSON output is authoritative |
| Playwright/PDF unavailable | Write HTML only; note "PDF skipped" |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js`, `metrics.js`, `stats.js`, `opportunity.js`, `supabase.js`, `md_to_html.js`, `load-env.js`.
- **Runtime:** Node ESM; `axios` (via meta-graph); Python + Playwright/Chromium only for PDF.
- **External APIs:** Meta Graph/Marketing API **v25.0** (read-only insights); rate limits and fields in `references/api-reference.md`.
- **Secrets:** Meta + Supabase credentials resolved from env via `load-env.js` — never hardcoded, never logged (only `fbtrace_id`/error messages surface).

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API insights / fields | https://developers.facebook.com/docs/graph-api/ | Insights edge, field semantics |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Ad-account entity tree |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Confirm v25.0 pin |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, fbtrace_id |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4/17/613, usage headers |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account insight limits |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | KPI thresholds, full flag taxonomy + trigger logic, metric formulas, Opportunity Score weighting, good/bad examples |
| `references/api-reference.md` | Exact Graph endpoints, insight fields, breakdown enums, v25.0 notes, rate-limit codes |
| `references/io-contract.md` | Full `performance_analysis.json` schema, stdout summary, `daily_metrics` rows, CLI/exit-code contract, edge cases |
