# /report — I/O Contract

Full input/output contract for `skills/report/report.js`. Self-contained.

## Invocation

```
node skills/report/report.js <slug> [--week-end YYYY-MM-DD] [--allow-empty]
```

| Arg / flag | Required | Meaning |
|------------|----------|---------|
| `<slug>` (argv[0]) | yes | Client directory under `clients/`. Missing → usage to stderr, exit 1 |
| `--week-end YYYY-MM-DD` | no | End of the reporting week. Default: today (UTC) |
| `--allow-empty` | no | Force-emit a report even when the week has no spend/impressions/conversions |

## Files read

| Path | Required | On absence |
|------|----------|-----------|
| `clients/<slug>/client_profile.json` | yes | exit 2 |
| `clients/<slug>/baseline_snapshot.json` | no | before/after section degrades to "run `/audit` first" |
| `clients/<slug>/optimizer_log.json` | no | optimizer table renders the empty-state note |
| `templates/weekly-report.md` | yes | (template ships with repo) |

Env (via `loadEnv()`): `META_ACCESS_TOKEN`, `META_APP_SECRET`.

## Files written (under `clients/<slug>/reports/`)

| File | Content |
|------|---------|
| `<week_end>_weekly.md` | template-filled markdown report |
| `<week_end>_weekly.html` | styled, self-contained HTML (via `writeHtmlAndPdf`) |
| `<week_end>_weekly.pdf` | shareable PDF (via `render_pdf.py`); skipped non-fatally if render fails |
| `<week_end>_weekly_raw.json` | raw metrics + vars + placement + top_ad + optimizer_actions + errors |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | success (files written, summary on stdout) |
| 1 | missing `<slug>` (usage) **or** uncaught fatal |
| 2 | `client_profile.json` not found |
| 5 | empty week (no data) and `--allow-empty` not passed |

Note: when `ad_account_id` is TBD the script does **not** exit — it logs to stderr, skips
Meta calls, and writes a skeleton (which then trips the empty-week guard unless `--allow-empty`).

## stdout — summary JSON

```json
{
  "slug": "acme",
  "week_start": "2026-06-15",
  "week_end": "2026-06-22",
  "spend": 1840.55,
  "conversions": 73,
  "roas": 2.81,
  "cpa": 25.21,
  "ctr": 1.34,
  "week_over_week_spend_delta_pct": "+12.4",
  "report_path": "clients/acme/reports/2026-06-22_weekly.md",
  "raw_path": "clients/acme/reports/2026-06-22_weekly_raw.json",
  "errors": []
}
```
All progress/diagnostic lines go to **stderr** (prefixed `[report]`), keeping stdout pure JSON.

## `_raw.json` shape

```json
{
  "slug": "acme",
  "window": { "week_start": "...", "week_end": "...", "prior_start": "...", "prior_end": "..." },
  "vars": { /* every {{template var}} (see map below) */ },
  "metrics": { "now": { /* rollup */ }, "prior": { /* rollup */ } },
  "placement_breakdown": [ { "publisher_platform": "instagram", "platform_position": "feed", "spend": "...", "ctr": "..." } ],
  "top_ad": { "ad_name": "...", "spend": "...", "roas": 0, "cpa": null, "conversions": 0, "format": "..." },
  "optimizer_actions": [ { "date": "...", "entity": "...", "action": "...", "rule": "..." } ],
  "errors": []
}
```

A rollup object: `spend, impressions, reach, clicks, link_clicks, conversions, revenue,
ctr, link_ctr, frequency, cpa (|null), roas (|null)`.

## Template variable map (`weekly-report.md`)

Deterministic (filled by script): `client_name, week_start, week_end, generated_at,
spend_total, budget_paced_pct, conversions_total, roas, cpa, spend_prior, spend_delta_pct,
impressions(_prior/_delta_pct), reach(_prior/_delta_pct), frequency(_prior/_delta),
cpa_target, roas_target, ctr_target, ctr, cpa_status, roas_status, ctr_status,
placement_breakdown_rows, top_ad_name, top_ad_format, top_ad_spend, top_ad_conversions,
top_ad_roas, top_ad_cpa, top_ad_ctr, top_ad_frequency, optimizer_actions_table,
baseline_date, before_after_rows, drive_link`.

Claude-only (script writes a `_(Claude to fill …)_` placeholder, agent replaces):
`win_headline, flag_headline, rec_1, rec_2, rec_3`.

Unresolved `{{key}}` renders as `_key_` (so a leftover is visibly an italicized token —
treat any `_…_` placeholder in the final report as a failed fill.)

## Persistence contract (Supabase — read first, never re-fetch)

`/report` is read-only against Meta, but its pulls are expensive. Per the constitution's
Token-Efficiency rule, persist the window's data once and read it back rather than
re-hitting Meta per metric.

**`daily_metrics`** — one row per `(client_id, date)` for the window's days. Columns:

| Column | Type | Source |
|--------|------|--------|
| `client_id` | uuid/text | `clients` table id for `<slug>` |
| `date` | date | each day in `[week_start, week_end]` |
| `spend` | numeric | account-day insight |
| `impressions` / `reach` / `clicks` / `link_clicks` | int | account-day insight |
| `conversions` / `revenue` | numeric | first-match over PURCHASE+LEAD types |
| `raw_json` | jsonb | the raw insight row (audit trail) |

Write via the REST + service-key pattern (see project memory "Supabase access pattern").
Before fetching from Meta, the agent SHOULD check `daily_metrics` for the window and only
fetch the missing days. The `_raw.json` sidecar is the local fallback when Supabase is
unavailable.

**`reports`** — one row per delivered report: `client_id`, `type:'weekly'`,
`summary_json` (the stdout summary), `drive_url`, `created_at`.

## Distribution contract (agent steps after exit 0)

> **Confirm channels with the user before any of steps 2–5** — Drive/Gmail/channel posts
> are irreversible external sends. Do not proceed if `{week_end}` is already in `sent.json`.

1. **PDF** already produced by the script (`writeHtmlAndPdf`).
2. **Drive:** `python3 scripts/lib/drive_upload.py <pdf> --folder-id <profile.drive_folder_id>` → capture `drive_link`; substitute into the report's `drive_link` / digest.
3. **Digest** to the client channel (`approvals.channel`):
   ```
   Weekly report — {client_name} · week ending {week_end}
   Spend: ${spend} · Conv: {conversions} · ROAS: {roas} · CPA: ${cpa}
   Top: {top_ad_name} · Killed: {N} · Pending: {N}
   Full report: {drive_link}
   ```
   **CONSTANT — with rationale.** The digest shape and the `sent.json` de-dupe key
   (`{week_end}`) are fixed on purpose: a stable, channel-agnostic message + a single
   idempotency key keep the Monday-09:00 schedule from double-posting whether it lands in
   Slack, Discord, or email. This couples the skill to one *message contract*, not to a
   specific channel — any channel adapter consumes the same fields. To restyle per channel,
   build a channel adapter that reads these fields; do not change the de-dupe key.
4. **Gmail:** `python3 scripts/lib/gmail_send.py --to <profile.contacts.primary_email> --subject "Weekly Report — {client_name} | {week_end}" --body "..." --attachment <pdf>`.
5. **Supabase:** insert the `reports` row (see Persistence contract above).
6. **De-dupe:** append `{week_end}` to `clients/<slug>/reports/sent.json`. Check this file
   *before* step 2 — if `{week_end}` is present, halt distribution.

## Edge cases

| Case | Behavior |
|------|----------|
| `ad_account_id` TBD | skeleton report; combine with `--allow-empty` to force, else exit 5 |
| Zero conversions but real spend | `cpa`/`roas` render "—"; report still ships (has data) |
| `prior` week empty | deltas show `+∞` / `0` |
| No baseline | before/after collapses to the "run `/audit`" row |
| Partial Meta failure | failed call's data empty, `errors[]` populated, report still emits |
| PDF render fails | HTML ships; stderr `(PDF skipped)`; flag in digest |
| Re-run same `week_end` | files overwritten; guard against re-distribution via `sent.json` |
| `week_end` already in `sent.json` | halt distribution; ask the user before re-sending (no double-send) |

**Last verified:** 2026-06-22
