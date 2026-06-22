# /analyze — Domain Standards

Embedded performance-analysis expertise: KPI thresholds, metric formulas, the full
flag taxonomy with exact trigger logic, the Opportunity Score model, and worked
good/bad examples. All values mirror `scripts/lib/metrics.js` (`DEFAULT_KPIS`),
`scripts/lib/stats.js`, and `scripts/lib/opportunity.js` — the code is the source of
truth; this file documents it. Read this before changing any threshold or flag.

---

## 1. Metric definitions (canonical — `metrics.js#deriveMetrics`)

One Meta insights row → one metric object. Semantics are fixed across `/analyze`,
`/report`, `/monthly-review`, `/scale`:

| Metric | Formula / source | Unit | Notes |
|--------|------------------|------|-------|
| `spend` | Meta `spend` | currency | rounded 2dp |
| `impressions` | Meta `impressions` | count | |
| `clicks` | Meta `clicks` | count | all clicks |
| `link_clicks` | Meta `inline_link_clicks` | count | |
| `reach` | Meta `reach` | count | |
| `frequency` | Meta `frequency` | ratio | impressions/reach |
| `ctr` | Meta `ctr`, else `(clicks/impressions)*100` | **percent** | already a % |
| `link_ctr` | Meta `inline_link_click_ctr`, else `(link_clicks/impressions)*100` | **percent** | |
| `cpc` | Meta `cpc` | currency | link CPC |
| `cpm` | Meta `cpm` | currency | per 1000 impr |
| `conversions` | first match in `actions` of primary events | count | |
| `conversion_value` | first match in `action_values` of primary events | currency | |
| `cpa` | `spend / conversions` | currency | `null` if 0 conversions |
| `roas` | `purchase_roas[0].value`, else `conversion_value / spend` | ratio | `null` if no value |

**Primary events** (`DEFAULT_PRIMARY_EVENTS`, override per client profile):
`purchase`, `offsite_conversion.fb_pixel_purchase`, `complete_registration`, `lead`.

**Critical unit rule:** CTR is a PERCENT. A 0.5% floor is `0.5`, never `0.005`.
A prior bug treated `link_ctr` as a fraction so the CTR pause never fired.

---

## 2. KPI thresholds (`DEFAULT_KPIS` — overridable per client)

| Key | Default | Meaning |
|-----|---------|---------|
| `cpa_target` | 50 | client CPA goal |
| `roas_target` | 2.0 | client ROAS goal |
| `ctr_target` | null | optional link-CTR goal (percent) |
| `pause_cpa_multiplier` | 3 | CPA > N× target → pause candidate |
| `pause_cpa_min_spend` | 50 | min spend before CPA pause applies |
| `pause_roas_floor` | 1.0 | ROAS below this → pause candidate |
| `pause_roas_min_spend` | 100 | min spend before ROAS pause applies |
| `pause_ctr_floor` | 0.5 | link CTR % below this → pause candidate |
| `pause_ctr_min_spend` | 30 | min spend before CTR pause applies |
| `pause_frequency_ceiling` | 4.0 | 7d frequency above this → pause candidate |
| `scale_roas_floor` | 3.0 | adset ROAS at/above this → scale candidate |
| `fatigue_ctr_decay` | 0.6 | 7d CTR < this × 30d CTR → fatigue |
| `fatigue_frequency_min` | 3.0 | min 7d frequency for fatigue |
| `scale_min_conversions` | 15 | conversions needed for auto-scale (else watch) |
| `spend_spike_multiplier` | 2.0 | 7d daily spend > N× 30d daily avg → anomaly |
| `spend_spike_min_daily` | 10 | ignore spikes below this absolute daily spend |

Resolve via `normalizeKpis(profile)`: it accepts flat (`kpis.cpa_target`) or nested
per-objective (`kpis.leads.target_cpa`) shapes, merges over `DEFAULT_KPIS`, and
preserves extra flat overrides (e.g. custom pause multipliers).

These mirror the constitution's Global KPI Thresholds. Any change must change
`metrics.js` too — do not diverge prose from code.

---

## 3. Flag taxonomy (exact triggers)

### Ad-level (`classifyFlags`) — uses 7d + 30d metrics
| Flag | Trigger |
|------|---------|
| `PAUSE_CANDIDATE_CPA` | `spend_7d ≥ pause_cpa_min_spend` AND `cpa_7d > pause_cpa_multiplier × cpa_target` |
| `PAUSE_CANDIDATE_ROAS` | `spend_7d ≥ pause_roas_min_spend` AND `roas_7d < pause_roas_floor` |
| `PAUSE_CANDIDATE_CTR` | `spend_7d ≥ pause_ctr_min_spend` AND `link_ctr_7d < pause_ctr_floor` |
| `PAUSE_CANDIDATE_FREQUENCY` | `frequency_7d > pause_frequency_ceiling` |
| `CREATIVE_FATIGUE` | `link_ctr_7d / link_ctr_30d < fatigue_ctr_decay` AND `frequency_7d > fatigue_frequency_min` AND two-proportion z-test on clicks/impressions is significant (95%) |
| `ANOMALY_spend_spike` | `daily_7d ≥ spend_spike_min_daily` AND `daily_7d > spend_spike_multiplier × daily_30d` (daily = window spend / days) |
| `ANOMALY_delivery_stall` | ad `status==ACTIVE` AND `impressions_7d == 0` |
| `ANOMALY_attribution` | `spend_7d > 50` AND `link_clicks_7d > 50` AND `roas` is null/0 |

### Adset-level (`classifyAdsetFlags`)
| Flag | Trigger |
|------|---------|
| `SCALE_CANDIDATE` | `spend_7d ≥ pause_roas_min_spend` AND `roas_7d ≥ scale_roas_floor` AND `conversions_7d ≥ scale_min_conversions` |
| `SCALE_WATCH` | same ROAS/spend condition but `conversions_7d < scale_min_conversions` (sample too thin to auto-scale) |

Every flag object carries `entity_type`, `entity_id`, `name`, `campaign_id` (and
`adset_id` for ads), `flag`, `metric`, `threshold`, `reasoning`. Significance-gated
flags also carry a `significance` block.

---

## 4. Significance gates (`stats.js`)

- **`twoProportionZ(x1,n1,x2,n2)`** — clicks/impressions for 7d vs 30d. `significant`
  when `|z| ≥ 1.96` (two-sided 95%). Prevents "fatigue" on tiny samples.
- **`scaleSignificance(conversions, min)`** — returns `significant` when
  `conversions ≥ min`. A ROAS win on <15 conversions becomes `SCALE_WATCH`, not
  an auto `SCALE_CANDIDATE`. Stops 1.2×-ing a budget on one lucky sale.
- **`wilsonLowerBound`** — available for conservative proportion estimates.

Rationale: the optimizer acts on these flags. Acting on noise burns budget; the
gates make the engine refuse to move money on statistically thin signals.

---

## 5. Winners / losers / segments

- **Winners/losers** rank only ads with `spend_7d ≥ $50` (eligibility floor):
  `top_roas` (top 5 by 7d ROAS), `lowest_cpa` (top 5 by lowest 7d CPA),
  `bottom_roas` (worst 5 by 7d ROAS).
- **Segment highlights** run per active adset with breakdowns. For each dimension
  (placement / age_gender / device), if one segment owns **> 50%** of conversions,
  emit a "concentrate spend" recommendation.

---

## 6. Opportunity Score (`opportunity.js`, 0–100)

Quantifies unrealized upside right now (not past grade). Higher = more money on the
table. Weighted sum of spend-share ratios over total 7d spend:

| Component | Weight | Ratio basis |
|-----------|--------|-------------|
| `scale` | 0.45 | spend on `SCALE_CANDIDATE` adsets / total |
| `reclaim` | 0.35 | spend on PAUSE-candidate ads / total |
| `refresh` | 0.20 | spend on `CREATIVE_FATIGUE` ads / total |

`score = round(45·scaleRatio + 35·wasteRatio + 20·fatigueRatio)`. Ratios clamp to
[0,1]; zero total spend → score 0 (never NaN). Output includes per-component
points, the dollar amounts, and ranked recommendations.

---

## 7. Good vs bad examples

**Good — significance-gated fatigue call**
```
link_ctr_7d=0.9%, link_ctr_30d=1.8% (decay 0.5 < 0.6), frequency_7d=3.4 (>3.0),
z-test on clicks/impressions significant → CREATIVE_FATIGUE with z and reasoning.
```
Correct: real CTR collapse on adequate volume.

**Bad — noise dressed as fatigue (correctly suppressed)**
```
link_ctr_7d=0.4%, link_ctr_30d=1.0% (decay 0.4), frequency_7d=3.2, but only 60
impressions in 7d → z-test NOT significant → NO flag.
```
The gate suppresses it. Do not "fix" by removing the gate.

**Good — attribution anomaly, not a pause**
```
spend_7d=$120, link_clicks_7d=85, roas=0 → ANOMALY_attribution (pixel gap), NOT
PAUSE_CANDIDATE_ROAS. The ad may be fine; the data is broken.
```

**Bad — pausing on thin spend**
```
spend_7d=$12, cpa_7d=$300 (>3× $50 target) → NO PAUSE_CANDIDATE_CPA because
spend < pause_cpa_min_spend ($50). Respect minimum-spend floors.
```
