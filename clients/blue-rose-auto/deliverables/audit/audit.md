# Audit Report — Blue Rose Auto Care & Repair Services
**Audit date:** 2026-07-21
**Ad Account:** `act_1999616770762846` · **Currency:** USD · **Timezone:** America/Los_Angeles

---

## Executive Summary

- **Overall health score:** 40/100
- **Top 3 wins to surface to client:**
  1. Facebook Page profile is 100% complete (name, about, category, website, phone, email, address, profile picture, cover photo all set) — no trust-signal gaps for prospective customers.
  2. Two campaigns are live and delivering: $163.12 spent lifetime across 73,350+ impressions, with a heavy (90%) video-first creative mix that plays well on Feed/Reels placements.
  3. Zero zombie campaigns — both active campaigns are actually delivering impressions, not silently burning budget with no reach.
- **Top 3 issues blocking results:**
  1. Pixel is installed but showing 0 events despite $163+ in spend — conversion tracking is not confirmed working, which blocks any CPA/ROAS optimization.
  2. Campaign naming doesn't follow the agency convention (`[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]`) — 0% compliance, which will make scaling/reporting harder as more campaigns launch.
  3. Posting cadence is light (1.2 posts/week) and per-post engagement can't be measured yet — the Page access token is missing `pages_read_user_content`, so engagement rate is a known gap, not a zero.

---

## Organic Audit — Facebook Page

- **Page name:** Blue Rose Auto Care & Repair Services
- **Followers:** 1,784 (new follows, 90d: 0)
- **Page completeness:** 100/100
- **Posts (last 60 days):** 10 (1.2/week) · last post 0 days ago
- **Format mix:** 90% video · 0% image · 10% carousel · 0% link
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

- **Followers:** —
- **Posts (last 60 days):** — (—/week)
- **Format mix:** 0% Reels · 0% image · 0% carousel
- **Avg engagement rate:** 0%
- **Reach (28d):** —
- **Profile views (28d):** —

---

## Paid Audit — Ad Account

- **Account status:** ACTIVE
- **Account age:** 12.589965277778 days
- **Total historical spend:** USD 163.12
- **Current balance / payment method:** USD 13.04
- **Campaigns lifetime:** 2 (2 active)
- **Best CPA seen:** —
- **Best ROAS seen:** —

### Pixel Health

- **Pixel ID:** `2183558222437003`
- **Status (account-side):** none (—)
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

1. Confirm pixel firing — verify the Meta Pixel (`2183558222437003`) is correctly installed on blueroseauto.com and test standard events (Lead, Schedule) before optimizing spend toward conversions.
2. Grant the app's Meta token `pages_read_user_content` and `read_insights` permissions on this Page so per-post engagement, best/worst post, and true engagement rate can be measured.
3. Rename the two active campaigns to the agency convention and set up Custom/Lookalike audiences — currently 0 custom audiences exist, so targeting is running on interest/broad only.

---

## Baseline Snapshot

This audit's metrics are saved as the immutable baseline in `baseline_snapshots` table. All future before/after reports compare against this row.

- **Snapshot ID:** _(set after baseline-snapshot.js)_
- **Saved at:** 2026-07-21T05:22:37.619Z
