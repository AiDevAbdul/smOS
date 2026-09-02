# Weekly Report — Blue Rose Auto Care & Repair Services

**Week:** 2026-08-24 → 2026-08-31
**Prepared by:** smOS · 2026-08-31T10:51:04.367Z

---

## Executive Summary

- **Total spend:** $615.31 (176% of weekly budget)
- **Conversions:** 27 · **ROAS:** 16.25x · **CPA:** $22.79
- **Win:** New Leads Ad Set returned 41.2x ROAS at a $12.13 CPA on $121 spend — Facebook Feed alone drove 70% of its conversions at a $7.73 CPA.
- **Flag:** PPF Broad Audience (web form) spent $203.71 across 121 link clicks with zero attributed revenue — a pixel/CAPI attribution gap, not necessarily a dead ad. Link CTR (0.68%) also sits under the 1% target.

---

## Spend & Delivery

| Metric | This week | Prior week | Δ |
|---|---|---|---|
| Spend | $615.31 | $912.12 | -32.5% |
| Impressions | 37,428 | 55,614 | -32.7% |
| Reach | 20,083 | 24,645 | -18.5% |
| Frequency | 1.86 | 2.26 | -0.39 |

---

## Performance vs Targets

| KPI | Target | Actual | Status |
|---|---|---|---|
| CPA | $35 | $22.79 | ✓ on target |
| ROAS | 1.5x | 16.25x | ✓ on target |
| CTR (link) | 1% | 0.68% | ⚠ off target |

## Account Economics

| Metric | Value |
|---|---|
| Blended MER | 16.25x |
| Breakeven ROAS | —x |
| Target ROAS | —x |
| Gross profit (ad-driven) | — |
| Profit after ad spend | — |
| New-customer CAC | $22.79 |

### CTR by Placement

| Placement | CTR | Spend share |
|---|---|---|
| audience_network · an_classic | 9.09% | 0.2% |
| audience_network · rewarded_video | 5.94% | 0.1% |
| facebook · facebook_notification | 5.22% | 6.7% |
| facebook · facebook_profile_feed | 5.71% | 0.1% |
| facebook · facebook_reels | 1.33% | 28.9% |
| facebook · facebook_reels_overlay | 0.67% | 0.7% |
| facebook · facebook_stories | 5.10% | 3.1% |
| facebook · feed | 2.18% | 46.1% |
| facebook · instream_video | 1.13% | 0.7% |
| facebook · marketplace | 0.09% | 5.2% |
| facebook · search | 5.41% | 0.1% |
| instagram · feed | 1.43% | 3.7% |
| instagram · instagram_reels | 0.12% | 3.1% |
| instagram · instagram_stories | 1.33% | 1.4% |
| threads · threads_feed | 0.00% | 0.0% |
| unknown · unknown | 0.00% | 0.0% |
| whatsapp · status | 0.00% | 0.0% |

---

## Top Performer

**New Leads Ad** — New Leads Ad
- Spend: $122.84
- Conversions: 13
- ROAS: 48.84x · CPA: $9.45 · CTR: 1.61%
- Frequency: 1.89

---

## Optimizer Actions This Week

_(No optimizer actions logged this week. Optimizer log will populate once Supabase is wired.)_

---

## Recommendations for Next Week

1. **Close the attribution gap before judging PPF.** The PPF Broad Audience web-form ad shows 121 link clicks and $203.71 spend with $0 attributed revenue. Re-run `/capi-setup` and verify the web form fires a server-side `Lead` event with a matching `event_id` — until that resolves, its true CPA is unknown and it should not be paused on ROAS.
2. **Hold budget on the two SCALE_WATCH ad sets one more week, then scale.** New Leads Ad Set (41.2x ROAS, 10 conv) and PPF Broad Audience – Leads From (15.4x, 9 conv) both clear the 3.0x scale threshold but sit under the 15-conversion significance floor. Keep budgets flat this week; if each crosses 15 conversions, step up ≤20%.
3. **Rebalance placement spend toward Facebook Feed and away from Marketplace.** Feed takes 46% of spend at a 2.18% CTR while Marketplace takes 5.2% at 0.09% CTR — and Feed owns 70% of New Leads conversions. Exclude Marketplace and Instagram Reels (0.12% CTR, 3.1% of spend) on the lead ad sets to lift the blended link CTR toward the 1% target.

---

## Running Before/After (since 2026-08-04)

| Metric | Baseline | Current | Change |
|---|---|---|---|
| Monthly ad spend | — | $2637.04 | — |
| Best CPA | — | $22.79 | — |
| Best ROAS | — | 16.25x | — |

---

_Full data: _(set after Drive upload)__
