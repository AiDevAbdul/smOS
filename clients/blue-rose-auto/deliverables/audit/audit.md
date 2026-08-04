# Audit Report — Blue Rose Auto Care & Repair Services
**Audit date:** 2026-08-04
**Ad Account:** `act_1999616770762846` · **Currency:** USD · **Timezone:** America/Los_Angeles

---

## Executive Summary

- **Overall health score:** 53/100
- **Top 3 wins to surface to client:**
  1. **Pixel verified + lead conversions flowing**: Pixel is firing on-site with 572 PageView events and 11 Lead events captured in the first week (Jul 28–Aug 4). Conversion event is live and trackable.
  2. **Consistent content calendar (2.2 posts/week, 89.5% video)**: 19 posts in 60 days with last post 1 day ago. Heavy video-first approach is highest-engagement format for automotive service at scale.
  3. **Page completeness is 100%**: All required fields (name, about, category, website, phone, email, address, profile pic, cover) are set — removes a common friction point for trust + click-through.
- **Top 3 issues blocking results:**
  1. **0% naming convention compliance**: All 4 campaigns bypass the required `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]` naming standard. Prevents systematic optimization, audience layering, and scaling — must rename before next spend increase.
  2. **Instagram account unreachable**: Cannot access IG Business account (API 100 error). Likely missing Professional Account conversion or app permissions. No visibility into 2nd major platform; need immediate troubleshooting.
  3. **Permission gap: pages_read_user_content not granted**: Engagement rate, best/worst posts, and per-content performance cannot be measured. Blocks creative optimization loop. Need to re-grant at Page level (Code 10 — Meta API limitation, not account issue).

---

## Organic Audit — Facebook Page

- **Page name:** Blue Rose Auto Care & Repair Services
- **Followers:** 1,794 (new follows, 90d: 0)
- **Page completeness:** 100/100
- **Posts (last 60 days):** 19 (2.2/week) · last post 1 days ago
- **Format mix:** 89.5% video · 0% image · 10.5% carousel · 0% link
- **Avg engagement rate:** —% _(per-post engagement unavailable — pages_read_user_content not granted (code 10); cadence & format mix are live)_
- **Best post:** — — —% ER
- **Worst post:** — — —% ER

### Completeness checks
| Field | Set |
|---|---|
| Name | ✓ |
| About | ✓ |
| Category | ✓ |
| Website | ✓ |
| Phone | ✓ |
| Email | ✓ |
| Address | ✓ |
| Profile picture | ✓ |
| Cover photo | ✓ |

## Organic Audit — Instagram

**⚠️ Account unreachable (API 100 error)** — Instagram Business Account `17841417245534835` cannot be accessed due to missing permissions or account status issue. Likely causes:
- IG account not yet converted to Professional Account status
- IG↔Page link not active
- Missing `instagram_business_management` app permission

**Action:** Verify Professional Account conversion in IG settings, re-grant app permissions, then re-run audit.

- **Followers:** — (blocked)
- **Posts (last 60 days):** — (blocked)
- **Avg engagement rate:** — (blocked)
- **Reach (28d):** — (blocked)

---

## Paid Audit — Ad Account

- **Account status:** code=9
- **Account age:** 26.684050925926 days
- **Total historical spend:** USD 731.40
- **Current balance / payment method:** USD 9.04
- **Campaigns lifetime:** 4 (2 active)
- **Best CPA seen:** —
- **Best ROAS seen:** —

### Pixel Health

- **Pixel ID:** `2183558222437003`
- **Status (account-side):** Firing (verified)
- **Installed on website:** Confirmed (572 PageView events, 11 Lead events captured Jul 28 – Aug 4)
- **Events firing:** PageView (572), Lead (11)
- **Missing events (recommended to add):** View, InitiateCheckout, Purchase (for full ROAS optimization); Schedule event for appointment bookings (CTA-specific conversion tracking)


### Website & Tracking — carried from pre-audit (none found)

> Public website-scrape signals from the prospect-stage pre-audit — the Graph API does not expose these. Not re-fetched.

- **Meta Pixel on site:** unknown
- **Conversion events on site:** unknown
- **Google Analytics 4:** unknown
- **Google Tag Manager:** unknown
- **Mobile responsive:** unknown
- **Ad Library history:** —

### Audiences

- **Custom audiences:** 3 (3 healthy, 0 broken/stale)
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

1. **Audit + rename existing campaigns** to naming convention (`CONV_[AUDIENCE]_202608` etc.). Block future launches via `naming-check` guard until all active campaigns comply. Current 4 campaigns need immediate re-labeling to enable optimization rules & scaling.
2. **Re-grant pages_read_user_content permission** for the Page token. This unblocks per-post engagement metrics, creative scoring via `/audit-creative`, and audience-targeting optimization. Quick fix, high ROI.
3. **Troubleshoot Instagram Business account access**: Verify IG account is linked to Page, converted to Professional Account status, and that the app has `instagram_business_management` permission. Once fixed, run `/audit --no-ig false` to capture IG baseline (followers, content cadence, reach/impressions).

---

## Baseline Snapshot

This audit's metrics are saved as the immutable baseline in `baseline_snapshots` table. All future before/after reports compare against this row.

- **Snapshot ID:** _(set after baseline-snapshot.js)_
- **Saved at:** 2026-08-04T07:38:09.954Z


### Creative Audit

**Assets scored:** 26 (0 organic, 26 ads)
**Overall creative health score:** 6/10

| Format | Visual quality | Brand consistency | CTA presence | Text density compliant | Messaging clarity |
|---|---|---|---|---|---|
| Image | 6 | 7 | 0% | 0% | 5 |
| Video | 6 | 7 | 0% | 0% | 5.2 |
| Carousel | 6 | 7 | 0% | 0% | 5 |

**Video hook & retention** (scored on play metrics, not thumbnail):
- Avg retention score: 4.6/10
- Avg hook rate (3s): 87.8% · hold rate (p75): 3.6% · completion: 1.5%

**Top 3 best performers:**
1. 1752908102370494 — 64x64, text~42%, brightness~119 (weighted 7.2)
2. 28430768893191889 — 64x64, text~100%, brightness~117 (weighted 6.5)
3. 2506427769769931 — 64x64, text~100%, brightness~70 (weighted 6.5)

**Top 3 worst performers (replace):**
1. 982577398204025 —  (weighted 4.5)
2. 1967588900617203 — 64x64, text~100%, brightness~117 (weighted 4.5)
3. 4541398592812452 — 64x64, text~100%, brightness~115 (weighted 4.5)

**Brand voice violations:** none
