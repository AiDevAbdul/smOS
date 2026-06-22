# Monthly Review — I/O Contract

Exact input/output shapes for `monthly-review.js`. Each artifact is self-describing so a
downstream skill (or Claude) can consume it without re-running the analysis.

---

## Inputs

| Input | Required | Shape / source |
|-------|----------|----------------|
| `<slug>` (argv[0]) | yes | Client directory under `clients/` |
| `--days N` | no | Integer window; default **30**; window is `[N days ago, yesterday]` |
| `clients/{slug}/client_profile.json` | yes | Must contain `accounts.ad_account_id` (non-TBD) and optional KPI overrides |
| `clients/{slug}/audience_map.json` | no | `interest_clusters` (or `clusters`) `[{id,label}]` for the cluster join |
| `clients/{slug}/competitor_intel.json` | no | Read by Claude (not the script) for the competitive section |
| `META_ACCESS_TOKEN` (env) | yes | Resolved via `load-env.js` / `tokens.js`; never hardcoded |

**Halts:** missing slug → exit 1 with usage; missing profile → `throw "Profile not found"`;
TBD/missing `ad_account_id` → `throw` (needs live insights).

---

## Output 1 — `clients/{slug}/strategy_recommendations.json`

```json
{
  "client_slug": "acme",
  "month": "2026-06",
  "generated_at": "2026-06-22T08:00:00.000Z",
  "recommendations": [
    { "id": 1, "action": "Refresh creative for 2 saturated adset(s)",
      "rationale": "frequency ≥ 4", "impact": "reduce CPM drag",
      "budget_delta": 0, "owner": "creative" }
  ],
  "note": "Recommendations are heuristic-generated. Have Claude review + add qualitative actions before sending to client."
}
```
`recommendations` is `[]` when no heuristic triggers (e.g. healthy account). Claude must
expand to 5 actions before any client send.

---

## Output 2 — `clients/{slug}/reports/{YYYY-MM}_monthly_inputs.json`

```json
{
  "client_slug": "acme",
  "month": "2026-06",
  "days_window": 30,
  "trends": {
    "spend":  { "slope": 1.234, "direction": "improving", "mean": 412.5, "first_7d_avg": 380.1, "last_7d_avg": 445.0 },
    "ctr":    { "slope": -0.001, "direction": "declining", "mean": 1.2, "first_7d_avg": 1.4, "last_7d_avg": 1.0 }
  },
  "fatigue": [
    { "adset_id": "23847...", "adset_name": "FEED_2545_FITNESS", "frequency": 4.3, "ctr": 0.6, "fatigue": "saturated", "needs_refresh": true }
  ],
  "lifecycle": [
    { "ad_id": "23848...", "ad_name": "IMG_PAIN_v1", "days_active": 21, "peak_ctr": 1.8, "current_ctr": 0.9, "pct_of_peak": 50, "days_since_peak": 12, "stage": "expired" }
  ],
  "adset_ranking": [
    { "adset_id": "23847...", "adset_name": "FEED_2545_FITNESS", "cluster": "Fitness Enthusiasts", "spend": 1200.5, "conversions": 34, "roas": 4.1, "cpa": 35.3, "ctr": 1.3 }
  ],
  "placement_ranking": [
    { "placement": "instagram/reels", "spend": 300.0, "ctr": 1.6, "cpm": 8.2, "conversions": 12, "cpa": 25.0 }
  ],
  "counts": { "daily_rows": 30, "adsets": 6, "ads": 14, "placements": 9 }
}
```
`trends` keys: `spend, impressions, ctr, cpm, frequency, conversions, revenue, roas, cpa`.

---

## Output 3 — `clients/{slug}/reports/{YYYY-MM}_monthly_review.md` (+ `.html`, `.pdf`)

Markdown skeleton with sections: Trend snapshot, Audience fatigue, Creative lifecycle table,
Adset ranking table, Placement efficiency table, Recommendations (heuristic). Rendered to a
self-contained HTML page via `writeHtmlAndPdf(mdPath, md, { title, subtitle })`
(`scripts/lib/md_to_html.js`) and to PDF via headless Chromium. Claude expands the narrative,
splices the `/before-after` block, and re-renders before distribution.

---

## Output 4 — stdout JSON summary (machine-readable handoff)

```json
{
  "slug": "acme",
  "month": "2026-06",
  "days_window": 30,
  "inputs_path": ".../reports/2026-06_monthly_inputs.json",
  "review_md_path": ".../reports/2026-06_monthly_review.md",
  "recommendations_path": ".../strategy_recommendations.json",
  "counts": { "daily_rows": 30, "adsets_seen": 6, "ads_seen": 14, "placements": 9 },
  "fatigued_adsets": 2,
  "refresh_needed_ads": 3,
  "top_adset": "FEED_2545_FITNESS",
  "worst_adset": "STORY_1824_GENERIC",
  "next": "have Claude expand recommendations + the narrative in the .md, then render PDF via scripts/render_pdf.py"
}
```

---

## Output 5 — Supabase `reports` row

Inserted by Claude (post-script) with `type: 'monthly_review'`, client slug, month, and the
PDF path/Drive URL. Mirrors the `/report` persistence pattern.

---

## Edge cases

| Case | Behavior |
|------|----------|
| Fewer than `--days` daily rows | All available days used; banner "Partial month — only N days of data" |
| `n < 2` daily points for a metric | slope = 0 → `flat` |
| metric mean = 0 | `flat` (avoids divide-by-zero) |
| Ad with < 3 daily rows | Skipped from lifecycle |
| Placement call errors | `placement_ranking: []`; section omitted |
| `audience_map.json` missing | `cluster: null` → renders `—` |
| No heuristic triggers | `recommendations: []`; Claude must still author actions |
| PDF render fails | HTML written, PDF skipped (logged); re-run `scripts/render_pdf.py` after installing Playwright |
