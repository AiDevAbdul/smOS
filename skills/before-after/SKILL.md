---
name: before-after
description: Use this skill when the user asks to show a client's before/after, progress, or improvement over the baseline (typically via `/before-after {slug}`). Compares current account + page state against the immutable `/audit` baseline; outputs markdown + PDF with side-by-side metrics and percent deltas. The agency's signature deliverable.
---

# /before-after — Baseline vs Current

## Required Context

- `clients/{slug}/client_profile.json`
- `clients/{slug}/baseline_snapshot.json` — must exist (created by `/audit`); halt if missing
- Live Meta page + ad-account metrics (current) — `get_page_insights`, `get_campaign_insights`, account-level rollups
- Supabase `daily_metrics` for the trailing 30 days
- `templates/before-after.md`

## Workflow

### Step 1 — Validate baseline

Read `baseline_snapshot.json`. If missing or older than `client_profile.engagement_start_date`, halt and tell the user to run `/audit` first. The baseline is **immutable** — never overwrite it.

### Step 2 — Capture current state

Pull the same fields the baseline captured, fresh:

- Facebook followers, Instagram followers
- Avg engagement rate (last 30 days, from page insights)
- Posts per week (last 30 days)
- Content quality score (re-run the `/audit-creative` scoring rubric on the latest 10 posts)
- Page completeness % (re-evaluate against the audit checklist)
- Monthly ad spend (last 30 days from `daily_metrics`)
- Cost per lead / CPA (rolling 30d)
- ROAS (rolling 30d)
- Pixel events per month (last 30 days)

### Step 3 — Compute deltas

For each metric: `change = current - baseline`, `pct = (current - baseline) / baseline × 100` (handle baseline = 0 as "New").

Mark direction:
- Positive direction good → ↑ green
- Negative direction good (CPA, frequency) → ↓ green
- Wrong direction → ↓ or ↑ red

### Step 4 — Fill template

Load `templates/before-after.md` and render the comparison table. Write to `clients/{slug}/reports/{YYYY-MM-DD}_before_after.md`.

### Step 5 — Headline summary

Add a 2-sentence headline above the table: "Since {baseline_date}, {client} has grown followers by X%, lifted engagement Y%, and gone from $0 to ${spend}/mo in measurable ad performance with a ${cpa} CPA." — generated from the actual deltas.

### Step 6 — PDF + persist

- Convert to PDF → `clients/{slug}/reports/{date}_before_after.pdf`
- Insert into Supabase `reports`: `type: 'before_after'`, `summary_json` with all delta values, `created_at`
- Optionally upload to Drive (if `drive_folder_id` set)

### Step 7 — Discord post

> *Before/After — {client_name}*
> {headline_summary}
> Full report: {drive_link or path}

## Output

- `clients/{slug}/reports/{date}_before_after.md` + `.pdf`
- Row in Supabase `reports`

## Error Handling

- Missing baseline → halt with explicit message: "No baseline snapshot for {slug}. Run `/audit` first to capture one."
- Page insights API fails → degrade gracefully: render the rows we have, mark missing as "—", flag in Discord
- Pixel events unavailable → mark "—" with note "pixel not connected at baseline"

## Token Efficiency

- Read once: baseline JSON, then a single live pull
- Template fill, no LLM generation in the body
- One PDF, one Discord post, one DB row

## PDF Rendering

Every report ships in HTML **and** PDF. After the HTML/markdown is written, run the shared helper:

```bash
python scripts/render_pdf.py <report.html> --output <report.pdf>
```

For markdown-first reports (audit_report.md, weekly_report.md), first convert markdown → HTML using your existing renderer, then call `render_pdf.py`. The helper uses headless Chromium (Playwright) so Apple-style gradients, charts, and table borders render correctly. First-time setup: `pip install playwright && python -m playwright install chromium`.
