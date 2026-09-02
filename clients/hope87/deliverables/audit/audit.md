# Audit Report — HOPE'87
**Audit date:** 2026-08-12
**Ad Account:** `TBD_no_ad_account_yet` · **Currency:** EUR · **Timezone:** Europe/Vienna

---

## Executive Summary

- **Overall health score:** 0/100 — driven entirely by a Meta API permission gap on the Facebook Page (see Issue 1); this is not a true reflection of HOPE'87's organic equity, which is real but currently unmeasurable via the API.
- **Top 3 wins to surface to client:**
  1. Instagram is a verified-category **Nonprofit organization Business account** with 289 followers and a linked donation URL — the basic trust/credibility infrastructure for accepting donations is already in place.
  2. The website (hope87.at) is **mobile responsive** (viewport meta present) — a clean technical foundation to build conversion tracking on top of once the pixel is installed.
  3. HOPE'87 carries genuine, decades-earned community trust with the AT/DE Pakistani diaspora that a newer or paid-only competitor cannot buy — the audit's job now is to make that trust measurable and paid-amplifiable.
- **Top 3 issues blocking results:**
  1. **The Meta system-user token has no role on HOPE'87's Facebook Page** (`100064328454024`) — every live Graph API call against the Page returned a permissions error, so Page name, follower count, page completeness, posting cadence, and engagement rate could not be measured this cycle. This must be resolved (grant the agency's system user a role on the Page in Business Manager, or supply a page-scoped access token) before a real organic baseline can lock.
  2. **No Meta Pixel, GTM, or GA4 is installed anywhere on hope87.at**, and no on-site conversion events fire — every visitor who clicks through to the PayPal donation link today is completely unmeasured, and no paid campaign can be launched with confidence until this is fixed.
  3. **No ad account exists yet** (`ad_account_id: TBD`) — HOPE'87 has zero paid distribution in AT/DE, and Instagram's own posting cadence has slipped to 0.75 posts/week (well below the ≥3/week target for a maintained account).

---

## Organic Audit — Facebook Page

- **Page name:** —
- **Followers:** — (new follows, 90d: —)
- **Page completeness:** —/100
- **Posts (last 60 days):** — (—/week) · last post — days ago
- **Format mix:** 0% video · 0% image · 0% carousel · 0% link
- **Avg engagement rate:** —%
- **Best post:** — — —% ER
- **Worst post:** — — —% ER

### Completeness checks
_(no data)_

## Organic Audit — Instagram

- **Followers:** 289
- **Posts (last 60 days):** — (0.75/week)
- **Format mix:** 0% Reels · 0% image · 0% carousel
- **Avg engagement rate:** 0%
- **Reach (28d):** —
- **Profile views (28d):** —

---

## Paid Audit — Ad Account

- **Account status:** code=—
- **Account age:** — days
- **Total historical spend:** —
- **Current balance / payment method:** —
- **Campaigns lifetime:** — (— active)
- **Best CPA seen:** —
- **Best ROAS seen:** —

### Pixel Health

- **Pixel ID:** `—`
- **Status (account-side):** — (—)
- **Installed on website:** ✗ no
- **Events firing:** —
- **Missing events (recommended to add):** _(review Standard Events list)_


### Website & Tracking — carried from pre-audit (hope87)

> Public website-scrape signals from the prospect-stage pre-audit — the Graph API does not expose these. Not re-fetched.

- **Meta Pixel on site:** ✗ no
- **Conversion events on site:** ✗ no
- **Google Analytics 4:** ✗ no
- **Google Tag Manager:** ✗ no
- **Mobile responsive:** ✓ yes
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

1. **Grant the agency's Meta system user a role on the HOPE'87 Facebook Page** (Business Manager → Page → Page Roles/Partners) so the next audit run can measure real followers, cadence, and engagement instead of returning a permissions error.
2. **Install Meta Pixel + Conversions API on the hope87.at donation flow** (see `/capi-setup` once the pixel exists) — today every PayPal-donation click is unmeasured, which blocks any conversion-objective campaign.
3. **Run `/setup-accounts` to create the ad account and pixel**, then re-run `/audit` to lock a real baseline before any paid launch — the current 0/100 score reflects a data gap, not a true health measurement.

---

## Baseline Snapshot

This audit's metrics are saved as the immutable baseline in `baseline_snapshots` table. All future before/after reports compare against this row.

- **Snapshot ID:** _(set after baseline-snapshot.js)_
- **Saved at:** 2026-08-12T14:42:03.133Z
