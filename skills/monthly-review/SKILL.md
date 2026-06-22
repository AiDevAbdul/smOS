---
name: monthly-review
description: Use this skill when the user asks for a monthly review, monthly recap, or end-of-month strategy reset (typically via `/monthly-review {slug}` or invoked by the auditor agent on schedule). It pulls ~30 days of Meta insights for one client, computes per-metric trend regression, audience fatigue, creative lifecycle staging, audience-cluster and placement ranking, emits a heuristic recommendations skeleton, and renders a Markdown + HTML + PDF monthly review for Claude to expand and distribute.
---

# /monthly-review — Monthly Strategic Review (Phase 4)

Produce the end-of-month strategic deliverable for one client. The companion script
`monthly-review.js` fetches the trailing insights window from the Meta Marketing API,
runs all numeric analysis locally (no LLM math), and emits structured inputs plus a
heuristic recommendations skeleton. Claude then expands the narrative and the five
concrete actions, calls `/before-after` for the comparison block, and distributes the PDF.

## What This Skill Does

- Run `node skills/monthly-review/monthly-review.js <slug> [--days N]` (default 30, until yesterday).
- Compute per-metric trend regression (slope sign → improving / flat / declining ±5%) for spend, impressions, CTR, CPM, frequency, conversions, revenue, ROAS, CPA.
- Flag audience fatigue per adset against the client's `pause_frequency_ceiling` (default 4.0).
- Stage every ad's creative lifecycle: `ramping` / `peak` / `declining` / `expired`.
- Rank adsets by ROAS/CPA (joined to `audience_map.json` clusters) and rank placements by CPA.
- Emit a heuristic recommendations skeleton; expand it into 5 concrete actions with rationale, impact, budget delta, and owner.
- Render `{YYYY-MM}_monthly_review.md` + HTML + PDF; distribute and log to Supabase `reports`.

## What This Skill Does NOT Do

- **Weekly 7-day reporting** — owned by `/report`.
- **On-demand deep performance dives / segment debugging** — owned by `/analyze`.
- **Executing budget/pause/scale changes on Meta** — owned by `/scale` (this skill only *recommends*; all actions stay human/optimizer-gated).
- **The before/after comparison block** — owned by `/before-after`; this skill calls it, never re-derives it.
- **Refreshing competitor intel** — owned by `/research`; invoke it first if `competitor_intel.json` is stale (>14 days).

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (createGraph, API v25.0, isTbd), `scripts/lib/metrics.js` (normalizeKpis, pause_frequency_ceiling), `scripts/lib/md_to_html.js` (writeHtmlAndPdf), `scripts/render_pdf.py` |
| **Conversation** | The `{slug}` and any non-default `--days` window the user wants |
| **Skill References** | Thresholds/formulas in `references/domain-standards.md`; field/endpoint contract in `references/api-reference.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` (`accounts.ad_account_id`, KPI overrides) + per-client `CLAUDE.md`; `clients/{slug}/audience_map.json`; `clients/{slug}/competitor_intel.json` |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for thresholds, formulas, or staging rules.

**Required (must resolve before running):**
1. Which client `{slug}`? (Must have a `client_profile.json` with a non-TBD `accounts.ad_account_id`.)

**Optional (ask only if relevant):**
2. Non-default analysis window? (`--days N`; default 30.)
3. Should the competitive-refresh section be included this month? (If yes and intel is stale, run `/research` first.)

## Workflow

1. Resolve `{slug}`; confirm `clients/{slug}/client_profile.json` exists and `accounts.ad_account_id` is non-TBD.
2. If the competitive section is wanted and `competitor_intel.json` is >14 days old, run `/research {slug}` first.
3. Run `node skills/monthly-review/monthly-review.js <slug> [--days N]`. It writes `strategy_recommendations.json`, `reports/{YYYY-MM}_monthly_inputs.json`, and `reports/{YYYY-MM}_monthly_review.md` (+ HTML/PDF), and prints a JSON summary on stdout.
4. Read the inputs + recommendations JSON. Expand the skeleton into 5 concrete actions (rationale, expected impact, budget delta, owner: human/optimizer/creative) and write the narrative into the `.md`.
5. Call `/before-after {slug}` and splice its comparison block into the review.
6. Re-render HTML + PDF (`python scripts/render_pdf.py <html> --output <pdf>`); distribute (Drive upload, Discord digest, Gmail) per the `/report` pattern; insert a Supabase `reports` row with `type: 'monthly_review'`.

## Input / Output Specification

**Inputs:** `clients/{slug}/client_profile.json` (required), `clients/{slug}/audience_map.json` (optional join), `clients/{slug}/competitor_intel.json` (optional); env `META_ACCESS_TOKEN`; arg `<slug>`, flag `--days N`.
**Outputs:** `clients/{slug}/strategy_recommendations.json`, `clients/{slug}/reports/{YYYY-MM}_monthly_inputs.json`, `clients/{slug}/reports/{YYYY-MM}_monthly_review.{md,html,pdf}`, a Supabase `reports` row, and a stdout JSON summary.
(Full schemas, field-level contract, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Ad account id, KPI targets (`pause_frequency_ceiling`, cpa/roas via `normalizeKpis`) | Trend ±5% slope band; lifecycle stage cutoffs (7d, 0.8, 0.6) |
| Analysis window (`--days`, default 30) | Regression formula; fatigue heuristic (≥ceiling = saturated, ≥3 = warming) |
| Audience clusters (`audience_map.json`), placement mix | Output file naming, Markdown skeleton, distribution channels |
| Whether competitor section is included | Recommendations always heuristic-seeded then Claude-expanded |

## Domain Standards

### Must Follow
- [ ] Route all KPI thresholds through `normalizeKpis(profile)` — never hardcode targets per client.
- [ ] Treat recommendations as heuristic seeds; Claude must expand to 5 actions with owner + impact before any client-facing send.
- [ ] Keep all numeric analysis local (regression, fatigue, lifecycle) — the LLM only writes narrative.
- [ ] Ship HTML **and** PDF for every review (constitution: every report ships both).
- [ ] Reuse `/before-after` for the comparison block; reuse `/research` for competitive refresh.

### Must Avoid
- Auto-executing any pause/scale/budget change — recommendations are advisory; `/scale` owns execution under human/optimizer gates.
- Inventing data for short windows — flag "Partial month — only N days" instead.
- Re-fetching insights already written to `{YYYY-MM}_monthly_inputs.json`.

### Output Checklist (verify before delivery)
- [ ] `{YYYY-MM}_monthly_review.md` + `.html` + `.pdf` all present.
- [ ] 5 expanded recommendations, each with rationale, impact, budget delta, owner.
- [ ] Before/after comparison block spliced in from `/before-after`.
- [ ] Partial-window banner present if fewer than `--days` rows returned.
- [ ] Supabase `reports` row inserted with `type: 'monthly_review'`.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` arg | Script exits 1 with usage string — supply the slug |
| `client_profile.json` not found | Script throws `Profile not found: <path>` — halt, do not guess |
| `accounts.ad_account_id` TBD/missing | Script throws (`isTbd`) — needs live insights; run `/setup-accounts` first |
| Meta API error | `createGraph` retries transient codes with backoff; on fatal, log code/type/fbtrace_id, do not auto-retry |
| Placement breakdown call fails | Script catches and returns `[]` — review renders without placement section |
| `audience_map.json` absent | Cluster column renders `—`; ranking still produced |
| Competitor intel stale and `/research` fails | Render review without competitive section, note it in the Discord digest |
| < `--days` of data returned | Render all available days; add "Partial month — only N days of data" banner |
| PDF render fails (Playwright missing) | `writeHtmlAndPdf` skips PDF (logs "PDF skipped"); install Playwright and re-run `scripts/render_pdf.py` |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js`, `scripts/lib/metrics.js`, `scripts/lib/md_to_html.js`, `scripts/lib/load-env.js`, `scripts/render_pdf.py`; skills `/before-after`, `/research`.
- **External APIs:** Meta Marketing API **v25.0** (insights edge; rate limits in `references/api-reference.md`).
- **Runtime:** Node ESM; Python + Playwright/Chromium for PDF.
- **Secrets:** `META_ACCESS_TOKEN` resolved via env / `scripts/lib/tokens.js` — never hardcoded or logged. Per-client overrides come from the profile, not source.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Insights pipeline entry point |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 pin (latest, 2026-02-18) |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, recovery, `fbtrace_id` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-Business-Use-Case-Usage`; codes 4/17/613 |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account insights limits |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Trend bands, fatigue/lifecycle thresholds, ranking & efficiency formulas, recommendation taxonomy, good/bad examples |
| `references/api-reference.md` | Exact insights endpoint, fields, breakdowns, time_range, version, rate limits with cited URLs |
| `references/io-contract.md` | Full JSON schemas for inputs/recommendations/summary + example payloads + edge cases |
