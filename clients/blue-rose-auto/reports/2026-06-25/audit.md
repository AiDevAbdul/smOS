# Audit Report — Blue Rose Auto Care & Repair Services
**Audit date:** 2026-06-25
**Facebook Page:** `1709708972688957` (BlueRoseAuto) · **Ad Account:** `act_1999616770762846` · **Pixel:** `2183558222437003` · **Currency:** USD · **Timezone:** America/Los_Angeles
**Audit type:** Pre-launch (infra exists, zero spend) — organic + account-readiness

---

## Executive Summary

- **Overall health score:** 35/100
  - The score is held down by **zero paid history, no audiences, and a dormant Page** — all expected for a pre-launch account. The good news: **the paid infrastructure largely exists** (active ad account + installed pixel), so the gap to launch is small.

- **Top 3 wins to surface to client:**
  1. **Paid infra is mostly in place:** an **active ad account** (`act_1999616770762846`, USD, correct PT timezone) and an **installed pixel** ("Blue Rose Auto's Pixel") already exist — the heavy `/setup-accounts` lifting is done.
  2. **Real audience already built:** 1,764 Page followers with no paid acquisition — a warm base to retarget and build lookalikes from on day one.
  3. **Strong native-video habit:** of the last 100 posts, **96% are video**, averaging ~165 views each (~9% of follower base) — exactly the format Meta rewards.

- **Top 3 issues blocking results:**
  1. **Pixel fired once at setup (2026-05-20) and has been silent since** — no events in the last ~36 days. It looks installed but is **not tracking live site traffic**, which blocks reliable Lead/Schedule conversion optimization. Must be verified before any conversion campaign.
  2. **The Page has gone dormant** — last post **2026-04-03 (83 days ago)**, zero posts in the last 30 days. The content engine that built 1,764 followers has stalled.
  3. **Instagram is not linked to the Page** (`instagram_business_account: none`) — blocks IG ad placements, IG insights, and the unified inbox even though `@blueroseauto` exists. **No custom audiences exist yet**, and **no payment method is confirmed** on the ad account (funding source not returned).

- **Top 3 next steps:**
  1. Run **`/capi-setup`** — verify the existing pixel fires Lead + Schedule on the live site; re-install / add CAPI if it's gone silent. *Single biggest unblocker.*
  2. **Confirm a payment method** is attached to `act_1999616770762846` and **link `@blueroseauto`** to the Page (both UI steps in `/setup-accounts`).
  3. **Restart organic cadence + build seed audiences** — resume 1–2 video posts/week and create the first Custom Audience (Page engagers + future pixel traffic) to seed lookalikes.

---

## Organic Audit — Facebook Page

- **Page name:** Blue Rose Auto Care & Repair Services
- **Category:** Auto Detailing Service
- **Followers / fans:** 1,764
  - _90-day follower delta: not available — Meta deprecated `page_fans` / `page_fan_adds` / `page_fan_removes` insight metrics (removed 2024–2025). Available engagement/view metrics return ~0 over the last 30 days, consistent with the posting dormancy below._
- **Page completeness:** ~75/100 — core fields present (address, phone `+1 541-337-9844`, email `treston@blueroseauto.com`, website, category, location). **Gap:** the "About" text is a generic "Call us today to learn more!" — no USP, no "30+ years / ASE-certified / Tesla-capable" proof points.
- **Posts pulled:** 100 (range 2025-12-31 → 2026-04-03)
  - **Cadence while active:** ~7.5 posts/week (Dec–Apr) — very high.
  - **Cadence now:** **0/week for the last 30 days; 1 in the last 90.** Most recent post 83 days ago.
- **Format mix (last 100 posts):** **96% video · 4% photo · 0% carousel · 0% link**
- **Video performance (last 20):** ~60–430 views each, avg ~165 views (~9% of follower base) — healthy organic reach for the audience size.
- **Best content:** top videos hit 300–430 views.

> ⚠️ **Permission limitation:** per-post reactions/comments/shares and message bodies require the review-gated `pages_read_user_content` permission, which the smOS app does not currently hold. Engagement-rate-by-format and best/worst-post-by-ER could not be computed. Full insights also need `read_insights` Advanced Access. See "Access & Permissions" below.

### Completeness checks
- ✅ Name, category, address, city/state/zip, phone, email, website, geo-coordinates
- ⚠️ About / description — generic placeholder, no USP or proof points
- ❔ Hours, services list, CTA button — not verifiable via current API scope (recommend manual UI check)

## Organic Audit — Instagram

- **Status:** **Skipped — IG not linked to the Page.** `@blueroseauto` exists publicly, but no Instagram professional account is connected to the Facebook Page at the Graph level (`instagram_business_account: none`), so IG insights, media, and follower data cannot be pulled via API.
- **Action:** link `@blueroseauto` (as a Professional/Business account) to the Page in `/setup-accounts`. Until then, IG paid placements and the unified inbox are also blocked.

---

## Paid Audit — Ad Account

- **Ad account:** `act_1999616770762846` — "Blue Rose Auto Care and Repair Services"
- **Status:** **Active** (account_status 1, disable_reason 0) ✅
- **Currency / timezone:** USD / America/Los_Angeles ✅ (matches profile)
- **Created:** 2026-05-19
- **Total historical spend:** **$0** — first-time advertiser, no campaigns ever run
- **Balance:** $0
- **Payment method:** **not confirmed** — `funding_source_details` returned empty. Verify a card/funding source is attached before launch.
- Campaigns: **0** · Best CPA: **n/a** · Best ROAS: **n/a**

### Pixel Health — CAPI diagnostic (2026-06-25)
- **Pixel ID:** `2183558222437003` ("Blue Rose Auto's Pixel"), created 2026-05-20 00:47, `is_unavailable: false`
- **Last fired:** 2026-05-20 00:50 — **3 minutes after creation.** That is the setup-wizard test fire, not real traffic.
- **Recent event stats:** **empty** (zero events since).
- **🔴 ROOT CAUSE: the pixel base code is NOT installed on `blueroseauto.com`.** A live fetch of the homepage finds no `fbq(`, no `fbevents.js`, no `connect.facebook.net`, and no reference to `2183558222437003`. The pixel was created but never deployed to the website.
- **Advanced matching:** `enable_automatic_matching: false` (off — should be on for better match rates).
- **CAPI (server-side events):** none configured.
- **Verdict:** *not functional.* Conversion campaigns (Lead/Schedule) **cannot** be optimized until the pixel is installed and verified firing.

**Fix (manual, since `/capi-setup` skill isn't installed in this build):**
1. Install the pixel base code on every page of `blueroseauto.com` (site-wide `<head>`), or via Google Tag Manager.
2. Add **standard events**: `Lead` on quote-form submit, `Schedule` on Book-Now completion, `PageView` site-wide.
3. Turn on **Automatic Advanced Matching** in Events Manager.
4. (Recommended) Add the **Conversions API** for iOS/ad-blocker resilience.
5. Verify in Events Manager **Test Events** that all fire, then confirm `last_fired_time` advances and stats populate.

### Audiences
- **Custom audiences:** 0. The 1,764 Page engagers + future pixel traffic are the seed for the first Custom + Lookalike audiences. Build these before/at launch.

### Account Structure Health
- **Naming convention compliance:** n/a (no campaigns yet)
- **Zombie campaigns:** n/a (none)
- **Frequency issues:** n/a (no delivery)

---

## Access & Permissions (engine readiness)

| Asset | Resolved? | Token access? | Notes |
|---|---|---|---|
| Facebook Page | ✅ `1709708972688957` | ✅ Page token (user: Abdul Wahab) | Insights/posts limited by app permissions below |
| Instagram | ❌ not linked | — | Link `@blueroseauto` to Page in `/setup-accounts` |
| Ad Account | ✅ `act_1999616770762846` | ✅ active, USD | Payment method not confirmed |
| Pixel / Dataset | ✅ `2183558222437003` | ✅ installed | Silent since 2026-05-20 — verify in `/capi-setup` |

**App-level permission gaps (affect audit depth, fix via Meta App Review → Advanced Access):**
- `pages_read_user_content` — needed for per-post engagement + message content
- `read_insights` — needed for full Page Insights history

---

## Creative Audit
(Populated by `/audit-creative` — separate section appended below.)

_Run `/audit-creative` to score the existing video library (20+ Reels/clips already on the Page) — this is high-value since 96% of content is video and it's the strongest organic asset._

---

## Recommended Next Steps (ordered)

1. **`/capi-setup`** — the pixel exists but has been silent since 2026-05-20. Verify it fires Lead + Schedule on the live site (and add CAPI). *Single biggest unblocker — conversion campaigns can't run reliably until this is green.*
2. **Confirm a payment method** on `act_1999616770762846` (no funding source detected) and **link `@blueroseauto`** to the Page — both UI steps via `/setup-accounts`.
3. **Build seed audiences** — first Custom Audience (Page engagers + pixel traffic) → Lookalikes, ready for launch day.
4. **Resume organic posting** — restart the 1–2 video posts/week cadence to re-warm the 1,764-follower base and rebuild the retargeting pool.
5. **Fix the Page "About"** — replace the generic "Call us today!" with the USP ("30+ years · ASE-certified · Tesla-capable · precision craftsmanship").
6. **(Optional) App Review** — pursue `pages_read_user_content` + `read_insights` Advanced Access so future audits/reports can read full organic engagement.
7. Then the planning artifacts already built (strategy brief, audience map, ad copy, launch plan) move toward `/launch` — pending confirmed budget + approvals channel.

---

## Baseline Snapshot

This audit's organic metrics (1,764 followers, 96% video format mix, last-post 2026-04-03, ~165 avg video views) are the immutable "before" baseline. All future before/after reports compare against this row.

- **Snapshot scope:** organic-only (no paid baseline — none exists yet)
- **Saved at:** 2026-06-25
