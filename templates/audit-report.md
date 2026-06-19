# Audit Report — {{CLIENT_NAME}}
**Audit date:** {{AUDIT_DATE}}
**Ad Account:** `{{AD_ACCOUNT_ID}}` · **Currency:** {{CURRENCY}} · **Timezone:** {{TIMEZONE}}

---

## Executive Summary

- **Overall health score:** {{HEALTH_SCORE}}/100
- **Top 3 wins to surface to client:**
  1. {{WIN_1}}
  2. {{WIN_2}}
  3. {{WIN_3}}
- **Top 3 issues blocking results:**
  1. {{ISSUE_1}}
  2. {{ISSUE_2}}
  3. {{ISSUE_3}}

---

## Organic Audit — Facebook Page

- **Page name:** {{PAGE_NAME}}
- **Followers:** {{FB_FOLLOWERS}} (90-day change: {{FB_FOLLOWERS_DELTA}})
- **Page completeness:** {{PAGE_COMPLETENESS}}/100
- **Posts (last 60 days):** {{FB_POST_COUNT}} ({{FB_POSTS_PER_WEEK}}/week)
- **Format mix:** {{FB_VIDEO_PCT}}% video · {{FB_IMAGE_PCT}}% image · {{FB_CAROUSEL_PCT}}% carousel · {{FB_LINK_PCT}}% link
- **Avg engagement rate:** {{FB_AVG_ER}}%
- **Best post:** {{FB_BEST_POST_LINK}} — {{FB_BEST_POST_ER}}% ER
- **Worst post:** {{FB_WORST_POST_LINK}} — {{FB_WORST_POST_ER}}% ER

### Completeness checks
{{PAGE_COMPLETENESS_TABLE}}

## Organic Audit — Instagram

- **Followers:** {{IG_FOLLOWERS}}
- **Posts (last 60 days):** {{IG_POST_COUNT}} ({{IG_POSTS_PER_WEEK}}/week)
- **Format mix:** {{IG_REELS_PCT}}% Reels · {{IG_IMAGE_PCT}}% image · {{IG_CAROUSEL_PCT}}% carousel
- **Avg engagement rate:** {{IG_AVG_ER}}%
- **Reach (28d):** {{IG_REACH_28D}}
- **Profile views (28d):** {{IG_PROFILE_VIEWS_28D}}

---

## Paid Audit — Ad Account

- **Account status:** {{ACCOUNT_STATUS}}
- **Account age:** {{ACCOUNT_AGE_DAYS}} days
- **Total historical spend:** {{TOTAL_SPEND}}
- **Current balance / payment method:** {{BALANCE_STATUS}}
- **Campaigns lifetime:** {{TOTAL_CAMPAIGNS}} ({{ACTIVE_CAMPAIGNS}} active)
- **Best CPA seen:** {{BEST_CPA}}
- **Best ROAS seen:** {{BEST_ROAS}}

### Pixel Health

- **Pixel ID:** `{{PIXEL_ID}}`
- **Status:** {{PIXEL_STATUS}} ({{PIXEL_LAST_FIRED}})
- **Events firing:** {{PIXEL_EVENTS_FIRING}}
- **Missing events (recommended to add):** {{PIXEL_EVENTS_MISSING}}

### Audiences

- **Custom audiences:** {{CA_COUNT}} ({{CA_HEALTHY}} healthy, {{CA_BROKEN}} broken/stale)
- **Lookalikes:** {{LAL_COUNT}} ({{LAL_HEALTHY}} healthy, {{LAL_BROKEN}} broken)
- **Audiences needing attention:**
  {{AUDIENCE_ISSUES}}

### Account Structure Health

- **Naming convention compliance:** {{NAMING_COMPLIANT_PCT}}% of campaigns follow `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]`
- **Zombie campaigns** (active, no delivery in 14d): {{ZOMBIE_COUNT}}
- **Frequency issues** (any active adset > 4.0): {{FREQ_ISSUES}}

---

## Creative Audit
(Populated by `/audit-creative` — separate section appended below.)

{{CREATIVE_AUDIT_SECTION}}

---

## Recommended Next Steps

1. {{NEXT_STEP_1}}
2. {{NEXT_STEP_2}}
3. {{NEXT_STEP_3}}

---

## Baseline Snapshot

This audit's metrics are saved as the immutable baseline in `baseline_snapshots` table. All future before/after reports compare against this row.

- **Snapshot ID:** {{SNAPSHOT_ID}}
- **Saved at:** {{SNAPSHOT_TIMESTAMP}}
