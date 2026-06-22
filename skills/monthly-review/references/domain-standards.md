# Monthly Review — Domain Standards

Embedded expertise for the 30-day strategic review. All thresholds and formulas here
mirror `monthly-review.js` exactly. KPI *targets* vary per client (resolved through
`normalizeKpis(profile)` in `scripts/lib/metrics.js`); the *rules below are constant*.

---

## 1. Trend analysis (per metric)

Metrics analyzed daily over the window: `spend`, `impressions`, `ctr`, `cpm`,
`frequency`, `conversions`, `revenue`, `roas`, `cpa`.

**Method:** ordinary least-squares slope of `y` against the day index `0..n-1`.

```
slope = Σ((xᵢ - x̄)(yᵢ - ȳ)) / Σ((xᵢ - x̄)²)      # 0 if denom 0 or n < 2
pctSlope = (slope · n) / mean(y)                 # slope as a fraction of the mean
```

**Direction band (constant ±5%):**

| pctSlope | direction |
|----------|-----------|
| > +0.05  | `improving` |
| < −0.05  | `declining` |
| otherwise (incl. mean 0) | `flat` |

Each metric also reports `mean`, `first_7d_avg`, `last_7d_avg` (rounded to 2 dp; slope to 3 dp).

> Note: "improving" is direction of the raw series. For cost metrics (CPA, CPM, frequency)
> a *rising* series is bad — Claude must interpret direction against the metric's polarity
> in the narrative; the script does not invert it.

### Conversion / revenue extraction
- `conversions` = first matching `actions` entry whose `action_type` matches `/purchase|complete_registration|lead/`.
- `revenue` = first `action_values` entry matching `/purchase/`.
- `roas` = revenue / spend (0 if no spend); `cpa` = spend / conversions (0 if no conversions).

---

## 2. Audience fatigue (per adset)

Aggregated per `adset_id` over the window (max frequency seen, latest CTR).

| Condition | `fatigue` | `needs_refresh` |
|-----------|-----------|-----------------|
| frequency ≥ `pause_frequency_ceiling` (default **4.0**) | `saturated` | true |
| 3.0 ≤ frequency < ceiling | `warming` | false |
| frequency < 3.0 | `ok` | false |

The ceiling is the only per-client variable here (`normalizeKpis(profile).pause_frequency_ceiling`,
which itself derives from the constitution's global 4.0 frequency pause threshold).
Sorted descending by frequency. Ideal fatigue detection (rising freq + falling CTR) needs
a daily adset breakdown; the script uses the aggregate ceiling heuristic — call this out
when the data warrants a finer read.

---

## 3. Creative lifecycle (per ad)

Requires ≥ 3 days of daily ad rows; ads with fewer are skipped.

```
peakCtr   = max daily CTR
currentCtr= last day's CTR
sincePeak = (lastIndex − peakIndex)
pctOfPeak = currentCtr / peakCtr
```

| Stage | Rule (evaluated in order) |
|-------|---------------------------|
| `ramping`   | days_active < 7 |
| `peak`      | sincePeak < 14 AND pctOfPeak ≥ 0.80 |
| `declining` | pctOfPeak ≥ 0.60 |
| `expired`   | otherwise (pctOfPeak < 0.60) |

**Refresh recommended** on `declining` + `expired`. Sorted ascending by `pct_of_peak`
(worst first). Reported per ad: `days_active`, `peak_ctr`, `current_ctr`, `pct_of_peak` (%),
`days_since_peak`, `stage`.

---

## 4. Adset ranking

Aggregate per adset: `spend`, `conversions`, `revenue`, `impressions`, `clicks`.

```
roas = revenue / spend          (0 if no spend)
cpa  = spend / conversions      (0 if no conversions)
ctr  = clicks / impressions · 100   (percent)
```

**Cluster join:** match `adset_name` (uppercased) against `audience_map.json`
`interest_clusters` (or `clusters`) by `id` or `label` substring; unmatched → `null` (renders `—`).
Sorted descending by ROAS.

---

## 5. Placement efficiency

Breakdown by `publisher_platform` × `platform_position`; label `"<platform>/<position>"`.
Reports `spend`, `ctr`, `cpm`, `conversions`, `cpa`. Sorted ascending by CPA (nulls last).
Recommend biasing budget toward the lowest-CPA placement.

---

## 6. Recommendation taxonomy (heuristic seed → Claude expansion)

The script emits up to 5 seed recommendations; Claude expands each into a full action.

| id | Trigger | owner | budget_delta |
|----|---------|-------|--------------|
| 1 | any fatigued (saturated) adsets | `creative` | 0 |
| 2 | any declining/expired ads | `creative` | 0 |
| 3 | a top-ROAS adset exists | `optimizer` | `+20%` |
| 4 | worst adset with spend > $50 | `optimizer` | `-$<spend>` |
| 5 | a lowest-CPA placement exists | `human` | 0 |

`owner` enum: `human` | `optimizer` | `creative`. Budget moves > $500/day or new launches
> $200/day require Discord approval (constitution Guardrails) — never auto-execute.

---

## 7. Good vs bad examples

**Good recommendation (Claude-expanded):**
> 3. **Shift 20% of FEED budget to "FEED_2545_FITNESS"** — it returned ROAS 4.1 vs account 2.3
> over 30 days at a stable frequency of 2.6. Expected impact: +0.3 account ROAS within 7 days.
> Budget Δ: +20% (≈ $40/day, under the $500 approval gate). Owner: optimizer.

**Bad recommendation (reject):**
> 3. Improve performance. (No metric, no target, no owner, no budget — unactionable.)

**Good fatigue read:**
> "REELS_1834_VALUE hit frequency 4.3 (saturated) while CTR fell to 0.6% — refresh creative."

**Bad fatigue read:**
> "Frequency is high." (No adset, no number, no action.)
