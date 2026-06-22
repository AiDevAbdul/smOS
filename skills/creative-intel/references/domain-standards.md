# creative-intel — Domain Standards

Embedded expertise for per-ad creative fatigue detection. Self-contained: thresholds,
metric semantics, formulas, the classification taxonomy, and worked good/bad examples.
No runtime discovery — everything the skill needs to decide is here.

## 1. Why fatigue matters

A creative "fatigues" when the same audience sees it too often: novelty wears off, click-through
falls, and cost per result rises while spend keeps flowing. Detecting decay *early* (before CPA
spikes) lets `/creative` ship a fresh variant before budget is wasted. This skill is the numeric
early-warning system; `/audit-creative` is the qualitative (visual/brand) companion.

## 2. Metric semantics (read before trusting a number)

| Metric | Source field | Meaning / gotcha |
|--------|--------------|------------------|
| Link CTR | `inline_link_click_ctr` | Clicks to the destination link ÷ impressions. Use this, NOT `ctr` (all-clicks incl. likes/expands). |
| Frequency | `frequency` | Avg impressions per person. Returned per daily row but behaves cumulative-ish over a flight — take the **max** across the trailing 7 rows, not a mean. |
| Spend | `spend` | Sum the trailing 7 daily rows for `spend_7d`. |
| Impressions | `impressions` | `days_active` = count of daily rows where impressions > 0. |
| Date | `date_start` / `date_stop` | Returned per row when `time_increment: 1`. Sort ascending before tailing. |

## 3. Derived metrics + formulas

```
ctr_30d_avg = mean(daily inline_link_click_ctr over full window)
ctr_7d_avg  = mean(daily inline_link_click_ctr over last 7 rows)
ctr_delta   = (ctr_7d_avg - ctr_30d_avg) / ctr_30d_avg     # negative = decaying
              -> null when ctr_30d_avg == 0 (no baseline)
frequency_7d = max(frequency over last 7 rows)
spend_7d     = sum(spend over last 7 rows)
consecutive_ctr_decline_days = count from newest row backward
                               while ctr[i] < ctr[i-1]; stop at first non-decline
days_active  = count(daily rows with impressions > 0)
```

`ctr_delta` is a **ratio off the ad's own baseline**, not an absolute CTR. `-0.30` means
"link CTR over the last 7 days is 30% below this ad's 30-day average." This makes the rule
self-calibrating across accounts with very different baseline CTRs.

## 4. Classification taxonomy (evaluated in this order; first match wins)

| Flag | Rule | Intent |
|------|------|--------|
| `INSUFFICIENT_DATA` | `< 7` daily rows | Not enough signal — never classify fatigue on it |
| `FATIGUE_HIGH` | `frequency_7d > 4` AND `ctr_delta < -0.30` | Over-served and CTR collapsed ≥30% off baseline — refresh now |
| `FATIGUE_MEDIUM` | `frequency_7d > 3` AND `ctr_delta < -0.20` | Early fatigue — queue for refresh |
| `STREAK_DECLINE` | `consecutive_ctr_decline_days >= 3` | Monotonic 3-day CTR slide regardless of frequency — directional warning |
| `BURNOUT_SOON` | `frequency_7d > 3.5` AND `days_active > 14` | Proactive — long-running + high frequency, refresh before CTR cracks |
| `HEALTHY` | none of the above | Leave running |

Thresholds are deliberately conservative and align with the constitution's global KPI table
(Frequency pause threshold `> 4.0` in a 7-day window). Per-client `CLAUDE.md` may tighten these;
when it does, the override is read from the client profile, not hardcoded here.

## 5. Refresh-priority ranking

```
refresh_priority_score = round(spend_7d * (1 + |ctr_delta|), 2)
```

Bigger recent spend × deeper decay = higher priority. A high-spend ad decaying 40% outranks a
low-spend ad decaying 60% — you stop the larger bleed first. `HEALTHY` and `INSUFFICIENT_DATA`
score `0`. Flagged ads sort descending; the **top 10** become the `refresh_queue`.

## 6. Good vs bad worked examples

**GOOD — correct FATIGUE_HIGH:**
- Ad ran 21 days, 30d link-CTR avg `1.20%`, last-7d avg `0.78%` → `ctr_delta = (0.78-1.20)/1.20 = -0.35`.
- `frequency_7d = 4.6`, `spend_7d = $420`.
- `freq > 4` AND `ctr_delta < -0.30` → `FATIGUE_HIGH`. Score `= 420 × 1.35 = 567.00`. Top of queue. Correct.

**GOOD — correct INSUFFICIENT_DATA:**
- New ad, only 4 daily rows. Even with a scary one-day CTR drop → `INSUFFICIENT_DATA`, not a fatigue flag. Avoids false alarms on launch noise.

**BAD — using mean frequency:** averaging `frequency` across 7 rows understates exposure because the field accumulates; a truly over-served ad reads `2.1` instead of `4.6` and slips past `FATIGUE_HIGH`. Always take the max.

**BAD — absolute CTR threshold:** flagging "CTR < 0.8%" punishes a low-funnel account whose healthy baseline is 0.6% and ignores a brand account that crashed from 3.0% to 1.5%. The own-baseline `ctr_delta` ratio is correct; a fixed CTR floor is wrong.

**BAD — silent throttle:** if the daily pull hits a rate limit mid-run and the code swallowed it, the report would say "0 fatigued" — a dangerous false negative. The skill instead HALTS on codes 4/17/613 (see api-reference.md).

## 7. Keeping current

- Fatigue thresholds live in the `FATIGUE_RULES` object in `creative-intel.js`. If the agency revises
  the global frequency/CTR KPI table in `CLAUDE.md`, update both and re-verify this table.
- If Meta renames or deprecates `inline_link_click_ctr` or `frequency` at the insights edge, update
  `api-reference.md` field list and the metric table above, then re-verify against the changelog.
- Last verified against the smOS KPI constitution and Meta field names: **2026-06-22**.
