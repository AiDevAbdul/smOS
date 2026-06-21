# Phase 6 — Reporting & Polish

**Status:** ✅ Complete  
**Completed:** 2026-06-21  
**Estimated in blueprint:** 2–3 days · Actual: 1 session

---

## Goal

Automated reporting that goes out without human intervention. Weekly client reports every Monday, before/after comparisons on demand, monthly strategic reviews, and the full system packaged as an installable Claude Code plugin.

---

## What Gets Built

### `/report` Skill (`skills/report.md`)

Weekly client report generation.

**Needs:** `client.*`, `baseline_snapshot`, `performance_analysis`  
**Outputs:** `weekly_report.md` + PDF → Google Drive → Discord digest + Gmail

**Report structure:**
- Executive summary: 3 key numbers, 1 win, 1 flag
- Spend & delivery: budget paced %, impressions, reach
- Performance KPIs: CPA vs target, ROAS vs target, CTR by placement
- Top performer: best ad this week with stats
- Optimizer actions: what was paused/scaled and why
- Recommendations for next week: 2–3 specific actions
- Running before/after delta against baseline

---

### `/before-after` Skill (`skills/before-after.md`)

The signature deliverable — compares current state against the immutable baseline from `/audit`.

**Needs:** `client.*`, `baseline_snapshot`  
**Outputs:** `before_after_report.md` + PDF

Sample output format:

| Metric | Baseline | Current | Change |
|---|---|---|---|
| Facebook followers | X | Y | +Z% ↑ |
| Instagram followers | X | Y | +Z% ↑ |
| Avg engagement rate | X% | Y% | +Z% ↑ |
| Posts per week | X | Y | +Z% ↑ |
| Content quality score | X/10 | Y/10 | +Z% ↑ |
| Page completeness | X% | 100% | +Zpts ↑ |
| Monthly ad spend | $0 | $X | New ↑ |
| Cost per lead | — | $X | New ↑ |
| ROAS | — | Xx | New ↑ |
| Pixel events/mo | 0 | X | New ↑ |

---

### `/monthly-review` Skill (`skills/monthly-review.md`)

Deeper than weekly. Full month trend analysis + strategic direction for the month ahead.

**Needs:** `client.*`, `baseline_snapshot`, all monthly performance data  
**Outputs:** `monthly_review.md` + PDF + `strategy_recommendations.json`

Covers:
- Full month performance trend (from Supabase `daily_metrics`)
- Audience fatigue analysis: frequency curves, engagement decay
- Creative lifecycle: which creatives peaked, need refreshing
- Audience performance ranking: which segments performing best
- Budget efficiency: CPM by placement, audience, creative type
- Competitive landscape update: new competitor ads from Ad Library
- Strategic recommendations for month ahead
- Updated before/after comparison since audit date

---

### Reporter Agent (`agents/reporter.md`)

**Schedule: Monday 9:00 AM**

Generates and distributes weekly reports for all active clients automatically.

**Steps:**
1. Pull 7-day metrics from Meta API for all active clients
2. Pull historical comparison from Supabase
3. Fill `weekly_report.md` template
4. Generate PDF via `python3 scripts/render_pdf.py`
5. Upload to client Google Drive folder via `python3 scripts/lib/drive_upload.py`
6. Post Discord digest to `DISCORD_WEBHOOK_ALERTS` with key metrics + Drive link
7. Send via Gmail to client contact via `python3 scripts/lib/gmail_send.py`
8. Append week-end date to `clients/{slug}/reports/sent.json` (dedup guard)
9. Update `reports` table in Supabase

---

### Auditor Agent (`agents/auditor.md`)

**Schedule: Monthly + on-demand**

Monthly structural health check — broader than the daily optimizer.

**Steps:**
1. Pull full account structure, flag naming convention drift
2. Analyze audience overlap across active adsets
3. Detect creative fatigue: engagement decline curves
4. Check pixel event completeness
5. Review budget allocation efficiency
6. Identify zombie campaigns (active, no delivery)
7. Generate `monthly_health_report.json`
8. Feed recommendations into next strategy brief

---

### Report Templates (`templates/`)

- `templates/weekly-report.md` — weekly report template with fill slots
- `templates/before-after.md` — comparison report template
- `templates/audit-report.md` — audit report template (also used in Phase 2)
- `templates/strategy-brief.md` — strategy brief template (also used in Phase 3)

---

### Plugin Packaging

Final step: package everything as an installable smOS plugin.

```
/plugin install smOS
```

Installs:
- Meta MCP server (auto-configured)
- All skills registered
- All agents registered
- All hooks wired
- CLAUDE.md loaded into session context

---

## Full Cycle Test

The Phase 6 test is the full end-to-end run:

```
/intake → /audit → /audit-creative → /research → /audience-map
→ /strategy-brief → [human approval] → /creative → /launch
→ optimizer-agent (daily, 3+ days) → /report → /before-after
```

Pass criteria:
- Before/after report shows measurable delta vs baseline
- Weekly report generated, PDF rendered, uploaded to Drive, Discord digest posted, Gmail sent
- Reporter agent runs on Monday schedule via native crontab (no human trigger)
- Plugin installs cleanly in a fresh Claude Code session

**Scheduler implementation note:** The schedule runs via native macOS/Linux `crontab` (not `claude scheduler sync`).
- `scripts/scheduler.js` — declares the three jobs as a JSON export
- `scripts/install-crons.sh` — reads that JSON, installs/updates crontab entries, idempotent
- `scripts/run-agent.sh <agent>` — loads smOS env, invokes `claude --print` with the agent's MD file, logs to `logs/<agent>.log`

To update or re-register: `bash scripts/install-crons.sh`. To remove: `bash scripts/install-crons.sh --remove`.

---

## Previous Phase

← [Phase 5 — Optimization Loop](phase5.md)

---

## Total Build Summary (across all phases)

| Phase | Days (est) | Days (actual) | Status |
|---|---|---|---|
| Phase 1 — Foundation | 2–3 | 1 session | ✅ Complete |
| Phase 2 — Intake & Audit | 2–3 | 1 session | ✅ |
| Phase 3 — Research & Strategy | 2 | 1 session | ✅ |
| Phase 4 — Creative & Launch | 2–3 | 1 session | ✅ |
| Phase 5 — Optimization Loop | 2–3 | 1 session | ✅ |
| Phase 6 — Reporting & Polish | 2–3 | 1 session | ✅ |
| **Total** | **12–17 days** | | |
