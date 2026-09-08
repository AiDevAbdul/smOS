# Audit Report — Ilyas General Hospital
**Audit date:** 2026-09-08
**Ad Account:** `act_461411569038304` · **Currency:** PKR · **Timezone:** Asia/Karachi

---

## Executive Summary

- **Overall health score:** 33/100
- **Top 3 wins to surface to client:**
  1. Page identity basics are in place — name, category, phone, address, profile/cover photo all set (67/100 completeness) and posting cadence is active (last post 3 days ago).
  2. The ad account is not new — 923 days old with 48 lifetime campaigns and PKR 500,568 in historical spend, so there's real account maturity and delivery history to build on rather than a cold start.
  3. The account already pivoted from a reach-only strategy to a WhatsApp-click campaign (live since 2026-09-07) — the right conversion event for a hospital, and a clear improvement over the prior awareness-only approach.
- **Top 3 issues blocking results:**
  1. **No pixel installed** — pixel health is "none" and `pixel_id` is unset, so there is zero conversion tracking on the WhatsApp-click campaign currently running; every rupee spent is unmeasured.
  2. **Naming convention compliance is 0%** across all 48 lifetime campaigns — no `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]` structure, which blocks clean before/after comparison and optimizer rule-matching going forward.
  3. **Organic reach and page completeness are weak** — only 14 followers, 0.8 posts/week, "About"/"Website"/"Email" fields empty, and Instagram is unreachable via the Graph API (missing permissions on `17841438014011289`) — the account has no measurable IG presence to audit.

---

## Organic Audit — Facebook Page

- **Page name:** Ilyas General Hospital
- **Followers:** 14 (new follows, 90d: 0)
- **Page completeness:** 67/100
- **Posts (last 60 days):** 7 (0.8/week) · last post 3 days ago
- **Format mix:** 0% video · 100% image · 0% carousel · 0% link
- **Avg engagement rate:** —% _(per-post engagement unavailable — pages_read_user_content not granted (code 10); cadence & format mix are live)_
- **Best post:** — — —% ER
- **Worst post:** — — —% ER

### Completeness checks
| Field | Set |
|---|---|
| Name | ✓ |
| About | ✗ |
| Category | ✓ |
| Website | ✗ |
| Phone | ✓ |
| Email | ✗ |
| Address | ✓ |
| Profile picture | ✓ |
| Cover photo | ✓ |

## Organic Audit — Instagram

- **Followers:** —
- **Posts (last 60 days):** — (—/week)
- **Format mix:** 0% Reels · 0% image · 0% carousel
- **Avg engagement rate:** 0%
- **Reach (28d):** —
- **Profile views (28d):** —

---

## Paid Audit — Ad Account

- **Account status:** ACTIVE
- **Account age:** 923.19827546296 days
- **Total historical spend:** PKR 500,568.29
- **Current balance / payment method:** PKR 205.14
- **Campaigns lifetime:** 48 (3 active)
- **Best CPA seen:** PKR 15,720.04
- **Best ROAS seen:** —

### Pixel Health

- **Pixel ID:** `—`
- **Status (account-side):** none (n/a)
- **Installed on website:** unknown
- **Events firing:** —
- **Missing events (recommended to add):** _(review Standard Events list)_


### Website & Tracking — carried from pre-audit (none found)

> Public website-scrape signals from the prospect-stage pre-audit — the Graph API does not expose these. Not re-fetched.

- **Meta Pixel on site:** unknown
- **Conversion events on site:** unknown
- **Google Analytics 4:** unknown
- **Google Tag Manager:** unknown
- **Mobile responsive:** unknown
- **Ad Library history:** —

### Audiences

- **Custom audiences:** 0 (0 healthy, 0 broken/stale)
- **Lookalikes:** _(see audiences)_ (— healthy, — broken)
- **Audiences needing attention:**
  _(none)_

### Account Structure Health

- **Naming convention compliance:** 0% of campaigns follow `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]`
- **Zombie campaigns** (active, no delivery in 14d): 0
- **Frequency issues** (any active adset > 4.0): _(see /analyze)_

---

## Creative Audit
(Populated by `/audit-creative` — separate section appended below.)

_(Run `/audit-creative` to populate.)_

---

## Recommended Next Steps

1. Install the Meta Pixel (and ideally CAPI) on the hospital's booking/contact surface immediately — the live WhatsApp-click campaign is currently running blind, repeating the prior campaign's core failure (912K impressions, 6 link clicks, zero measurable conversions).
2. Re-launch/rename active campaigns under the `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]` convention (e.g. `LEADS_GYNAEPEDS2545_202609`) so structure health, before/after comparisons, and optimizer rules can actually apply — current compliance is 0% across 48 campaigns.
3. Fix Instagram access (re-grant permissions on IG business ID `17841438014011289` or re-link the account) and raise organic cadence past 0.8 posts/week — the Page has no video/carousel mix and IG is currently unauditable.

---

## Baseline Snapshot

This audit's metrics are saved as the immutable baseline in `baseline_snapshots` table. All future before/after reports compare against this row.

- **Snapshot ID:** _(set after baseline-snapshot.js)_
- **Saved at:** 2026-09-08T12:01:05.765Z
