# /report — Domain Standards

Embedded expertise for the weekly client report. Read this when you need the window
math, KPI thresholds, metric formulas, event taxonomies, currency/locale format points,
or quality examples. Self-contained — no need to read the `.js` to apply these.

## 1. Reporting window

`report.js` computes a strict, non-overlapping pair of 7-day windows:

```
week_end   = --week-end | today
week_start = week_end - 7d
prior_end  = week_start - 1d
prior_start= prior_end - 7d
```

- Current week = `[week_start, week_end]`; prior week = `[prior_start, prior_end]`.
- The two windows do not overlap, so week-over-week deltas are clean.
- Dates are handled as UTC ISO (`YYYY-MM-DD`). Interpret/report results in the **client's** reporting context, not server TZ.

## 2. Metric formulas (single source of truth: `scripts/lib/metrics.js`)

The rollup in `report.js` aggregates raw insight rows, then derives:

| Metric | Formula | Notes |
|--------|---------|-------|
| Spend | Σ row.spend | currency-agnostic float |
| Impressions / Reach / Clicks | Σ of each | integers |
| Link clicks | Σ `inline_link_clicks` | |
| CTR | `clicks / impressions × 100` | **PERCENT** — Meta's `ctr` is already a percentage |
| Link CTR | `inline_link_clicks / impressions × 100` | PERCENT; this is the KPI-compared CTR |
| Frequency | `impressions / reach` | recomputed from totals (not row-averaged) |
| Conversions | first matching `actions[].value` over the event list | see §3 |
| Revenue | first matching `action_values[].value` over the event list | |
| CPA | `spend / conversions` | `null` when conversions = 0 |
| ROAS | `revenue / spend` | `null` when spend = 0 |

Week-over-week delta: `((now - prior) / prior) × 100`, signed, 1 decimal.
When `prior = 0`: `"+∞"` if `now > 0`, else `"0"`.

## 3. Conversion event taxonomy

`report.js` counts the **first matching** action type in this combined order
(purchase first, then lead):

```
PURCHASE_TYPES = purchase, offsite_conversion.fb_pixel_purchase, omni_purchase
LEAD_TYPES     = lead, offsite_conversion.fb_pixel_lead, onsite_conversion.lead_grouped
```

**CONSTANT — with rationale.** This list is hardcoded in `report.js` (not read per run) so
every weekly report counts conversions identically; making it a per-run input would let two
reports disagree on what a "conversion" is. To change the taxonomy, edit `report.js`.

`report.js` defines its OWN lists and does NOT call `metrics.js` `deriveMetrics`. The
`metrics.js` `DEFAULT_PRIMARY_EVENTS` (purchase, fb_pixel_purchase, complete_registration,
lead) is a separate list used by `/analyze` + `/scale`. The two are deliberately documented
together so a maintainer unifying them knows both shapes; if you add an event type, update
both to keep the skills aligned.

## 4. KPI targets & thresholds

Targets come ONLY from `normalizeKpis(profile)`, which reads flat (`kpis.cpa_target`) or
nested (`kpis.leads.target_cpa`) shapes and merges over `DEFAULT_KPIS`.

**Single source of truth — do not copy literal default numbers into this doc or the
SKILL.md.** The default CPA/ROAS/CTR values and all pause/scale thresholds live in
`scripts/lib/metrics.js` `DEFAULT_KPIS`. Restating them here risks drift with no check
tying the two back together. To inspect the live values, read that file. The *direction* of
each comparison (stable, encoded in `report.js` `kpiStatus`) is:

| KPI | Direction | Status rule in report | Null handling |
|-----|-----------|-----------------------|---------------|
| CPA | lower is better | `actual ≤ target` → "✓ on target" | null target → "—" |
| ROAS | higher is better | `actual ≥ target` → "✓ on target" | null target → "—" |
| CTR (link) | higher is better | `actual ≥ target` → "✓ on target" | null target → "—" |

The constitution's pause/scale thresholds (CPA > 3× target after $50, ROAS < 1.0 after
$100, CTR < 0.5% after $30, frequency > 4.0, CPM > $50) are *enforced by `/scale`*, not by
this skill, and are themselves keyed to `DEFAULT_KPIS`. Cite them as context for
recommendations only; read `metrics.js` for the authoritative numbers.

## 5. Top-performer selection

`fetchTopAd` pulls ad-level insights (`limit: 200`, `sort: spend_descending`), then:

- Skips ads with spend < $20 (noise floor).
- Scores each: `roas × 1000 − cpa` (crude composite favoring ROAS, then low CPA).
- Picks the highest score; falls back to the top-spend ad if none clear the floor.

This is a heuristic surfacing one headline winner — not the ranked analysis `/analyze` does.

## 6. Budget pacing

`daily_budget = (monthly_budget.client_confirmed | planning_assumption_high) / 30`.
`budget_paced_pct = round(spend / (daily_budget × 7) × 100)`. Renders "—" when no
confirmed budget exists. Do not invent a budget.

## 7. Before/after (running baseline delta)

Reads `baseline_snapshot.json`. Rows: FB/IG followers, avg engagement rate, posts/week
(baseline-only), monthly ad spend (`spend × 30/7`), best CPA, best ROAS. Change % =
`(cur - base) / |base| × 100`. No baseline → single row "_(no baseline — run `/audit` first)_".

## 7b. Currency / locale format points (known constraint)

`report.js` does NOT read any `profile.locale` or `profile.currency` field. Formatting is
hardcoded:

| Template var(s) | Format in code |
|-----------------|----------------|
| `spend_total`, `spend_prior`, `cpa`, `top_ad_*` money, before/after `$` | `"$" + Number(v).toFixed(2)` — **USD assumed** |
| `impressions`, `reach` (and priors) | `Number.toLocaleString()` — **host default locale** |
| `roas`, `frequency`, CTR | `.toFixed(2)` — plain decimal |

**CONSTANT today, with a parameterization path.** To make this per-client, add
`profile.currency` (ISO 4217) and `profile.locale` (BCP-47), then replace the literals with
`new Intl.NumberFormat(profile.locale, { style: "currency", currency: profile.currency })`
for money and `new Intl.NumberFormat(profile.locale)` for counts. Until that field exists,
every report renders in `$`/host-locale — call this out in the digest for non-USD clients
rather than letting it pass silently. This is a named constraint, not silent behavior.

## 8. Good vs bad report

**Good**
- Executive summary leads with spend, conversions, ROAS, one real win, one real flag.
- KPI status reflects the client's actual targets; deltas signed vs prior week.
- `win_headline` / `rec_*` cite a concrete entity ("Killed FEED_2545 at 4.2× target CPA").
- Empty-week guard halted; agent verified the account before forcing.

**Bad**
- All-$0.00 report shipped because the account was unconnected (guard bypassed blindly).
- CTR treated as a fraction (0.005) so it reads 0.005% — wrong by 100×.
- Recommendations invented ("try new creative") with no basis in `performance_analysis.json`.
- Second PDF route (Pandoc) used, producing a visually inconsistent deliverable.
- Report re-sent because `sent.json` was ignored.

## Keeping current

- KPI defaults live in `scripts/lib/metrics.js` `DEFAULT_KPIS`; the report-counting event
  taxonomy lives in `report.js`. Change them there, never by copying values into the docs.
- The Meta **v25.0** pin is owned by `scripts/lib/meta-graph.js` `API_VERSION`. Re-verify
  the pin + Meta field names against the URLs in `api-reference.md` each quarter; owner: the
  smOS maintainer (next review 2026-09). When the pin changes there, this skill inherits it.
- Last verified: 2026-06-22.
