---
name: report
description: Use this skill when the user asks to generate the weekly client report, or when the reporter agent invokes it on the Monday 09:00 schedule (typically via `/report {slug}`). It pulls a rolling 7-day Meta account-level window, compares it against the prior 7 days and the immutable audit baseline, fills `templates/weekly-report.md`, emits markdown + HTML + PDF + a raw JSON sidecar, and refuses to ship an all-zero week unless forced with `--allow-empty`. The agent then fills the narrative placeholders and orchestrates distribution (Drive, Slack/Discord, Gmail).
---

# /report — Weekly Client Report (Phase 4)

Produce the agency's recurring weekly performance deliverable for one client: a
template-filled report with week-over-week deltas, KPI status vs targets, a CTR-by-placement
breakdown, the top ad, logged optimizer actions, and a running before/after vs the audit
baseline. `report.js` does the deterministic data fetch + transform + template fill and emits
files + a stdout summary; the agent supplies the narrative and orchestrates distribution.

## What This Skill Does

- Compute a rolling 7-day window (current vs the immediately preceding non-overlapping 7 days), anchored on `--week-end` or today (UTC).
- Pull account-level insights, a `publisher_platform,platform_position` breakdown, and the top ad from Meta Graph API v25.0 (skipped when `ad_account_id` is TBD).
- Roll up spend/impressions/reach/clicks/conversions/revenue; compute CTR, link-CTR, frequency, CPA, ROAS, and KPI status vs `normalizeKpis(profile)` targets.
- Fill `templates/weekly-report.md`; write `.md`, `.html`, `.pdf`, and a `_raw.json` sidecar under `clients/{slug}/reports/`.
- Fail-closed (exit 5) on an all-zero week (no spend AND no impressions AND no conversions) unless `--allow-empty`.
- Print a JSON summary on stdout for the agent's narrative fill + distribution.

## What This Skill Does NOT Do

- Per-campaign/adset/ad/placement/device deep dive — owned by `/analyze`.
- Pause/scale/duplicate entities — owned by `/scale`. This skill is strictly read-only and only *reports* logged optimizer actions.
- 30-day trend + strategy reset — owned by `/monthly-review`.
- The actual Drive upload, Slack/Discord post, Gmail send, and `reports` row insert — orchestrated by the **agent** using `scripts/lib/drive_upload.py`, `gmail_send.py`, `google_auth.py` (see `references/io-contract.md`). `report.js` only produces files + a summary.
- Establish the baseline — owned by `/audit`. This skill reads `baseline_snapshot.json` if present, else renders the before/after section as "run `/audit` first".

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/metrics.js` (`normalizeKpis`, KPI defaults), `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `act`, v25.0), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`), `scripts/lib/load-env.js`, `templates/weekly-report.md` |
| **Conversation** | A specific `{slug}`; an explicit week-end date; whether the user wants an empty week forced; which channels to distribute to |
| **Skill References** | Window math, metric formulas, KPI taxonomy, persistence + distribution contract (see Reference Files) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `name`, `accounts.ad_account_id`, `kpis`, `monthly_budget`, `contacts.primary_email`, `drive_folder_id`, `approvals.channel`; per-client `CLAUDE.md` KPI overrides |
| **Handoff files** | `clients/{slug}/baseline_snapshot.json`, `clients/{slug}/optimizer_log.json`, `clients/{slug}/reports/sent.json` |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for thresholds, formulas, or event taxonomies.

**Required (must resolve before running):**
1. Which client `{slug}`? (Must have `clients/{slug}/client_profile.json`.)
2. Confirm distribution channels and recipients BEFORE the agent sends — Drive upload, Slack/Discord post, and Gmail are **irreversible external sends**. Confirm the Drive folder, channel, and recipient email, and that this `week_end` is not already in `sent.json`, before any distribution step. (File generation by `report.js` is safe and needs no confirmation.)

**Optional (ask only if relevant):**
3. A specific `--week-end YYYY-MM-DD`? (Default: today, UTC.)
4. Force-emit despite a zero-data week (`--allow-empty`)? (Default: refuse.)

## Workflow

1. Resolve `{slug}`; halt if `client_profile.json` is missing.
2. Run `node skills/report/report.js <slug> [--week-end YYYY-MM-DD] [--allow-empty]`.
3. The script computes the window, fetches Meta data (or skips to a skeleton if `ad_account_id` is TBD), fills the template, and writes `.md` / `.html` / `.pdf` / `_raw.json`.
4. If it exits 5 on an empty week, surface the message and upstream errors; re-run with `--allow-empty` only on explicit user opt-in.
5. Open the filled markdown and replace the Claude-only placeholders: `win_headline`, `flag_headline`, `rec_1..3` — source them from `performance_analysis.json` flags + segment highlights, never invented.
6. Confirm distribution channels with the user (Required clarification #2), then distribute (agent-orchestrated): Drive upload → capture `drive_link`; post the digest to the client's channel; Gmail send with PDF attachment; insert a `reports` row.
7. Append `{week_end}` to `clients/{slug}/reports/sent.json` so the agent never double-sends.

## Input / Output Specification

**Inputs:** `<slug>` (argv[0]); flags `--week-end YYYY-MM-DD`, `--allow-empty`. Reads `client_profile.json` (required), `baseline_snapshot.json` (optional), `optimizer_log.json` (optional), `templates/weekly-report.md`. Env via `loadEnv()`: `META_ACCESS_TOKEN`, `META_APP_SECRET`.
**Outputs:** `clients/{slug}/reports/{week_end}_weekly.md` + `.html` + `.pdf` + `{week_end}_weekly_raw.json`; a JSON summary on **stdout**; progress/errors on **stderr**.
(Full flags, exit codes, schemas, template-var map, persistence + distribution contract: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) — rationale |
|--------------------------------|-----------------------------------------------|
| KPI targets (CPA/ROAS/CTR), monthly budget, ad account id, client name, recipient email, Drive folder, approval channel | 7-day window math (current vs prior, no overlap, UTC) — uniform reporting cadence |
| Whether a baseline / optimizer log exists | Conversion event taxonomy (`PURCHASE_TYPES` + `LEAD_TYPES` in `report.js`) — see `references/domain-standards.md §2`; change in code, not per run |
| Conversion event types present (purchase vs lead) | KPI defaults (CPA=50, ROAS=2.0…) live ONLY in `metrics.js` `DEFAULT_KPIS`; this skill reads them via `normalizeKpis` — single source, never re-stated as live values |
| Data volume (zero-week vs high-spend) | Template structure + section order (`weekly-report.md`) — one report shape across clients |
| **Currency/locale of displayed numbers** | **CONSTANT today: USD `$` prefix + `Number.toLocaleString()` with the host default locale.** `report.js` does NOT read a profile locale field — see `references/domain-standards.md §6` for the exact format points and how to parameterize off a future `profile.locale`/`profile.currency` field. Treat this as a known constraint, not silent behavior. |
| | Empty-week fail-closed guard; PAUSED-safe (read-only, no writes to Meta); one PDF path (`writeHtmlAndPdf` → `render_pdf.py`); digest-message + `sent.json` de-dupe shape (see `references/io-contract.md` — CONSTANT-with-rationale: a fixed shape keeps the schedule idempotent across channels) |

## Domain Standards

### Must Follow
- [ ] Compute the window as current 7d vs the immediately preceding non-overlapping 7d, anchored on `--week-end` or today (UTC).
- [ ] Read KPI targets through `normalizeKpis(profile)` so report/analyze/scale agree; never inline literal targets.
- [ ] Persist expensive pulls: the agent writes the window's rows to Supabase `daily_metrics` (see `references/io-contract.md §Persistence`) and inserts a `reports` row — never re-fetch stored data per metric.
- [ ] Treat all CTR values as PERCENT (Meta's `ctr` / `inline_link_click_ctr` are already percentages).
- [ ] Ship HTML + PDF for every report via `writeHtmlAndPdf` (single authoritative path).
- [ ] Source `win_headline`, `flag_headline`, `rec_1..3` from real analysis output — never fabricate.

### Must Avoid
- Do not write to the Meta API — `/report` is strictly read-only (no pause/scale/create).
- Do not hand-render a per-client report; always fill `templates/weekly-report.md`.
- Do not introduce a second PDF route (no Pandoc, no chrome-devtools MCP) — `render_pdf.py` via `writeHtmlAndPdf` is canonical.
- Do not ship an all-$0.00 report; let the empty-week guard halt unless the user opts in.
- Do not double-send: respect `reports/sent.json` and confirm channels before any external send.

### Output Checklist (verify before delivery)
- [ ] `.md`, `.html`, `.pdf`, and `_raw.json` all exist under `clients/{slug}/reports/`.
- [ ] No `_placeholder_` tokens (unresolved `{{vars}}` render as `_key_`) and no Claude-only fill notes remain in the markdown.
- [ ] KPI status reflects the client's real targets; deltas are signed week-over-week.
- [ ] Before/after section present (or explicitly notes "run `/audit` first").
- [ ] Channels confirmed; `drive_link` set after upload; `reports` row inserted; `sent.json` appended.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` argv | Script prints usage, exits 1 — halt and ask the user |
| `client_profile.json` not found | Script exits 2 — name the missing file, do not guess |
| `ad_account_id` is TBD | Skip Meta calls, write a skeleton report; flag that accounts need `/setup-accounts` |
| Per-fetch Meta error (current/prior/placement/topAd) | Caught into `errors[]`; report still emits; surface `errors` from `_raw.json` / stdout |
| All-zero week (no spend/impr/conv) and no `--allow-empty` | Script exits 5 with upstream errors — do NOT force; confirm account/window with user first |
| PDF render fails | Non-fatal: HTML still ships, stderr logs `(PDF skipped)`; mention it in the digest |
| No baseline | Before/after row reads "_(no baseline — run `/audit` first)_"; still send, flag in digest |
| No optimizer log | Table reads "_(No optimizer actions logged this week…)_" — not an error |
| Drive/Gmail send fails (agent step) | Log to `error_log`, surface in the digest ("Drive upload failed, attaching PDF inline"), do not auto-retry |
| `week_end` already in `sent.json` | Halt distribution — do not double-send; ask the user before re-sending |

## Dependencies & Security

- **Reuses:** `scripts/lib/metrics.js` (`normalizeKpis` + `DEFAULT_KPIS`), `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `act`, `API_VERSION = v25.0`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`), `scripts/lib/load-env.js`, `templates/weekly-report.md`.
- **Distribution helpers (agent-run):** `scripts/lib/drive_upload.py`, `scripts/lib/gmail_send.py`, `scripts/lib/google_auth.py` (shared `~/.config/smos/google_token.json`); `scripts/render_pdf.py` (headless Chromium / Playwright).
- **External APIs:** Meta Graph API **v25.0** (read-only insights); Google Drive + Gmail for distribution. Endpoints + rate limits in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN`, `META_APP_SECRET` via env (`loadEnv()`); Google OAuth token on disk — never hardcoded, never logged. `appsecret_proof` is added by `meta-graph.js`.
- **Setup:** `pip install playwright && python -m playwright install chromium`; `python3 scripts/lib/google_auth.py` once to authorize Drive/Gmail.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API Insights | https://developers.facebook.com/docs/marketing-api/insights/ | `time_range`, `level`, `breakdowns`, sorting account/ad insights |
| Ad insights fields | https://developers.facebook.com/docs/marketing-api/reference/adgroup/insights/ | `spend`, `impressions`, `actions`, `action_values`, `purchase_roas` field defs |
| Graph API versions | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current (released 2026-02-18) |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-Business-Use-Case-Usage`; codes 4 / 17 / 613 |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table, `fbtrace_id`, recovery |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Keeping current:** the **v25.0** pin is owned centrally in `scripts/lib/meta-graph.js` (`API_VERSION`), NOT in this skill. The smOS maintainer re-verifies the pin against the Graph API versions page each quarter (next: 2026-09); when it changes there, every skill inherits it — do not hardcode a version here. KPI defaults are owned by `metrics.js`; never copy literal values into this doc.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Window math, KPI thresholds/taxonomy, metric + delta formulas, conversion-event lists, top-ad scoring, currency/locale format points, good/bad report examples |
| `references/api-reference.md` | Exact Meta insights endpoints/fields/breakdowns/sort, v25.0, rate limits, plus the Google Drive/Gmail distribution endpoints |
| `references/io-contract.md` | Full input flags, exit codes, output file + stdout JSON schemas, template var map, Supabase persistence + distribution + de-dupe contract, edge cases |
</content>
</invoke>
