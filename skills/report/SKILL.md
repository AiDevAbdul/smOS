---
name: report
description: Use this skill when the user asks to generate the weekly client report or it's invoked on the Monday 09:00 schedule (typically via `/report {slug}`). Pulls 7-day Meta metrics, compares against baseline + prior week, fills the weekly-report template, generates PDF, uploads to Drive, and sends to Discord + email.
---

# /report — Weekly Client Report

## Required Context

- `clients/{slug}/client_profile.json` — for `name`, `accounts.ad_account_id`, `kpis`, `approvals.channel`, `contacts.primary_email`, `drive_folder_id`
- `clients/{slug}/baseline_snapshot.json` — anchor for the running before/after delta
- `clients/{slug}/performance_analysis.json` — latest analyze output (regenerate via `/analyze` if older than 24h)
- Supabase `daily_metrics`, `optimizer_log`, `reports` tables
- `templates/weekly-report.md`
- Connectors: Discord webhook, Google Drive upload, Gmail send

## Workflow

### Step 1 — Window

Compute `week_end = today`, `week_start = today - 7d`, `prior_start = today - 14d`. Use client timezone, not server TZ.

### Step 2 — Pull metrics

1. From Supabase `daily_metrics`: rollup of last 7d and the prior 7d (for week-over-week deltas)
2. From `performance_analysis.json`: top performer, segmentation highlights, flags
3. From Supabase `optimizer_log`: every action this past week (paused / scaled / flagged) with reasoning

If `daily_metrics` is missing days for the window, call `get_campaign_insights` and `get_ad_insights` only for those days and upsert before continuing.

### Step 3 — Compute report sections

- **Executive summary:** 3 numbers — total spend, conversions, ROAS — plus the single biggest win and the single biggest flag
- **Spend & delivery:** budget paced % (spend / (daily_budget × 7)), impressions, reach, frequency
- **KPIs:** CPA vs target, ROAS vs target, CTR by placement (from breakdowns)
- **Top performer:** best ad by ROAS this week with spend, conversions, CPA, CTR, frequency
- **Optimizer actions:** condensed list of paused / scaled entities with the rule that fired
- **Recommendations:** 2–3 concrete next-week actions (sourced from `performance_analysis.json` flags + segment highlights)
- **Before/after delta:** running comparison vs `baseline_snapshot.json` (followers, engagement rate, posts/week, monthly ad spend, CPA, ROAS, pixel events/mo)

### Step 4 — Fill template

Load `templates/weekly-report.md` and replace `{{placeholders}}`. Write rendered file to `clients/{slug}/reports/{YYYY-MM-DD}_weekly.md`.

### Step 5 — Generate PDF

Convert the markdown to PDF (Pandoc or headless Chrome via the chrome-devtools MCP). Output → `clients/{slug}/reports/{YYYY-MM-DD}_weekly.pdf`.

### Step 6 — Distribute

1. **Drive upload** — run `python3 scripts/lib/drive_upload.py <pdf_path> --folder-id <client_profile.drive_folder_id>`. Capture `drive_link` from the JSON output.

2. **Discord digest** — POST to `DISCORD_WEBHOOK_ALERTS` with this message body:
   ```
   **Weekly report — {client_name} · week ending {date}**
   Spend: ${X} · Conv: {N} · ROAS: {x.x} · CPA: ${X}
   🏆 Top: {ad_name} · 📉 Killed: {N} · ⏳ Pending: {N}
   Full report: {drive_link}
   ```

3. **Gmail send** — run `python3 scripts/lib/gmail_send.py --to <primary_email> --subject "Weekly Report — {client_name} | {week_end}" --body "..." --attachment <pdf_path>`.

4. **Supabase log** — insert row into `reports` table: `client_id`, `type: 'weekly'`, `summary_json`, `drive_url`, `created_at`.

> **Auth:** Both scripts share `~/.config/smos/google_token.json`. Run `python3 scripts/lib/google_auth.py` once to authorize — no re-auth needed after that.

### Step 7 — Mark sent

Append `{week_end_date}` to `clients/{slug}/reports/sent.json` so the reporter agent won't double-send.

## Output

- `clients/{slug}/reports/{date}_weekly.md`
- `clients/{slug}/reports/{date}_weekly.pdf`
- Drive upload, Discord post, Gmail send, `reports` row

## Error Handling

- Drive upload fails → keep going; Discord mentions "Drive upload failed, attaching PDF inline"
- Gmail fails → log to `error_log`, surface in Discord message
- PDF generation fails → ship the markdown instead, flag in Discord
- Missing baseline → skip the before/after section but still send the report; flag in digest that `/audit` needs to run

## Token Efficiency

- Pull from Supabase first; only hit Meta for missing days
- Template fill — no blank-page generation
- One Gmail / Drive / Discord call per client, never per metric

## PDF Rendering

Every report ships in HTML **and** PDF. After the HTML/markdown is written, run the shared helper:

```bash
python scripts/render_pdf.py <report.html> --output <report.pdf>
```

For markdown-first reports (audit_report.md, weekly_report.md), first convert markdown → HTML using your existing renderer, then call `render_pdf.py`. The helper uses headless Chromium (Playwright) so Apple-style gradients, charts, and table borders render correctly. First-time setup: `pip install playwright && python -m playwright install chromium`.
