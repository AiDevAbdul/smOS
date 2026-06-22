---
name: before-after
description: Use this skill to compare a client's current Meta account + page state against the immutable `/audit` baseline and produce the agency's signature before/after deliverable (markdown + HTML + PDF with side-by-side metrics and percent deltas). This skill should be used when the user asks to show a client's before/after, progress, growth, or improvement over the baseline — typically via `/before-after {slug}`.
---

# /before-after — Baseline vs Current (Reporting)

Compare the locked `/audit` baseline snapshot against a fresh live pull of the client's Facebook, Instagram, and paid metrics, compute directional deltas, and render the agency's signature before/after report in markdown, HTML, and PDF. The baseline is immutable; this skill never writes it.

## What This Skill Does

- Run `node skills/before-after/before-after.js <slug>` — the sole entrypoint; one positional arg (`<slug>`).
- Read `clients/{slug}/client_profile.json` and `clients/{slug}/baseline_snapshot.json`; normalize + fail-closed validate the baseline (must be frozen via `immutable_locked_at`).
- Pull current state via Meta Graph API v25.0: FB followers/engagement/posts/page-completeness, IG followers/engagement/posts, paid spend/leads/purchases/CPL/ROAS/pixel events (trailing 30 days).
- Compute per-metric delta, percent change, direction, and good/bad color (CPL inverted — lower is better; baseline 0 → "new").
- Generate a deltas-driven 2-sentence headline.
- Fill `templates/before-after.md`, write `.md` + `_raw.json`, then HTML + PDF via `writeHtmlAndPdf`.
- Emit a JSON summary (paths + headline + deltas) to stdout for the orchestrator.

## What This Skill Does NOT Do

- Create or update the baseline — that is `/audit` (writes `baseline_snapshot.json`). This skill is read-only on the baseline.
- Re-score creative quality — content score requires a `/audit-creative` re-run; this skill emits "—"/placeholder for it.
- Pull weekly or single-period performance — use `/report` (7-day) or `/analyze` (on-demand deep dive).
- Take any optimization action (pause/scale/budget) — that is `/scale`.
- Upload to Drive or post to Discord/Slack — the JS produces files only; delivery is the caller's job.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/before-after/before-after.js`, `schemas/baseline_snapshot.js` + `schemas/client_profile.js`, `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`), `templates/before-after.md` |
| **Conversation** | The `{slug}`; whether the user wants Drive upload / Discord post (caller-side, not in JS) |
| **Skill References** | Delta/color/headline rules + formulas from `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.{facebook_page_id, instagram_business_id, ad_account_id, pixel_id}`; per-client `CLAUDE.md` KPI overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and `baseline_snapshot.json`.
> Only ask for what cannot be determined. Domain knowledge (formulas, color rules, thresholds)
> is embedded in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}`? (Maps to `clients/{slug}/`.)

**Optional (ask only if relevant):**
2. Deliver beyond local files (Drive upload, Discord/Slack post)? Default: files only.
3. Re-run `/audit-creative` first so the content-quality row is populated rather than "—"?

## Workflow

1. Resolve `{slug}`. Halt if absent (Required clarification #1).
2. Run `node skills/before-after/before-after.js <slug>`.
3. The script halts fail-closed if the profile or baseline is missing, or the baseline is unlocked/incomplete (see Error Handling). Relay its exact message — do not fabricate numbers.
4. On success, read the stdout JSON for paths and the headline.
5. Fill the four `_(Claude to fill)_` narrative slots in the `.md` (organic / paid / creative / optimization drivers) from real deltas and account history — never invent metrics.
6. If the user requested delivery, upload the PDF / post the headline (caller-side).

## Input / Output Specification

**Inputs:** positional `<slug>`; `clients/{slug}/client_profile.json`; `clients/{slug}/baseline_snapshot.json` (locked); `templates/before-after.md`; env via `scripts/lib/load-env.js` (`META_ACCESS_TOKEN`, optional `META_APP_SECRET`).
**Outputs:** `clients/{slug}/reports/{YYYY-MM-DD}_before_after.md` + `.html` + `.pdf` (PDF best-effort) + `_before_after_raw.json`; stdout JSON summary.
(Full schemas, field maps, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Account IDs, follower/engagement/spend/CPL/ROAS values | Trailing-30-day window; FB/IG/paid field set pulled |
| Which surfaces exist (TBD/missing IDs auto-skip) | Delta + percent formula; baseline-0 → "new" rule |
| KPI targets (per-client `CLAUDE.md`) | CPL inverted-good; color = green/red/neutral logic |
| Baseline date / engagement length | Template `templates/before-after.md`; locked-baseline gate |
| Drive/Discord delivery | Graph API v25.0 pin; markdown→HTML→PDF render path |

## Domain Standards

### Must Follow
- [ ] Treat the baseline as immutable — read only; never write `baseline_snapshot.json`.
- [ ] Require `immutable_locked_at` (fail-closed `validate(..., {requireLock:true})`) before computing deltas.
- [ ] Apply inverted-good direction to CPL (and any cost/frequency metric): lower = green.
- [ ] Use the actual deltas for the headline and narratives; mark unavailable rows "—".
- [ ] Ship all three formats (md + HTML + PDF) and persist `_raw.json`.

### Must Avoid
- Guessing missing metrics or back-filling from a prior report.
- Overwriting a baseline because it looks stale — instruct the user to re-`/audit` instead.
- Comparing against an unlocked / partial baseline.
- Hardcoding follower/spend numbers in the template.

### Output Checklist (verify before delivery)
- [ ] `.md`, `.html`, `.pdf`, `_raw.json` all present in `clients/{slug}/reports/`.
- [ ] Headline reflects real deltas (or the "collecting baseline data" fallback).
- [ ] CPL row trends green when cost dropped, not red.
- [ ] Skipped surfaces render "—" (not 0 or invented values).
- [ ] Four narrative slots filled from real data.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` arg | Exit 1, print usage — never guess a client |
| `client_profile.json` missing | Exit 2, name the path — halt |
| `baseline_snapshot.json` missing | Exit 3, "Run /audit first to capture one" |
| Baseline unlocked / incomplete | Exit 4, list `validate` errors, tell user to re-`/audit` and re-lock |
| Account ID is TBD / placeholder | `isTbd` skips that surface; rows render "—" |
| Page/IG/paid insights API fails | Per-surface `.catch` → degrade gracefully, that surface "—", continue |
| Pixel events unavailable | Mark "—" (pixel not connected at baseline) |
| Meta API error (general) | `meta-graph` logs code/type/fbtrace_id; no auto-retry beyond built-in backoff |
| PDF render fails | HTML still written; log "(PDF skipped)", do not crash |

## Dependencies & Security

- **Reuses:** `schemas/baseline_snapshot.js`, `schemas/client_profile.js`, `scripts/lib/meta-graph.js`, `scripts/lib/md_to_html.js`, `scripts/lib/load-env.js`, `templates/before-after.md`.
- **External APIs:** Meta Graph API v25.0 (Page, IG Media, Ad Account Insights, Pixel stats). Rate limits in `references/api-reference.md`.
- **Scripts:** `skills/before-after/before-after.js` (Node ESM). PDF: `scripts/render_pdf.py` via `writeHtmlAndPdf` (Playwright/Chromium — `pip install playwright && python -m playwright install chromium`).
- **Secrets:** `META_ACCESS_TOKEN` / `META_APP_SECRET` resolved via `load-env.js` — never hardcoded or logged; `appsecret_proof` applied when the secret is set.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Page node | https://developers.facebook.com/docs/graph-api/reference/page/ | FB fields: `fan_count`, `about`, `category`, `website` |
| Page /feed (posts) | https://developers.facebook.com/docs/graph-api/reference/page/feed/ | Pulling 30-day posts + summaries |
| IG Media Insights | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | `reach`; `impressions`→`views` migration note |
| Ad Account insights (rate limits) | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Account-level spend/actions/ROAS limits |
| Error handling | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | `fbtrace_id`, recovery, no auto-retry |
| Graph API rate limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4/17/613, `X-App-Usage` |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Delta/percent/color formulas, inverted-good metrics, headline rules, good/bad examples |
| `references/api-reference.md` | Exact Graph v25.0 endpoints/fields, rate limits, `impressions`→`views`, cited URLs |
| `references/io-contract.md` | Baseline + profile field maps, exit codes, stdout JSON, raw-file schema, edge cases |
