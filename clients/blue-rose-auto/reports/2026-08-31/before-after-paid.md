# Before / After (Paid) — Blue Rose Auto Care & Repair Services

**Baseline captured:** 2026-08-04
**Current snapshot:** 2026-08-31
**Engagement length:** 27 days
**Scope:** Paid media only — organic excluded (pages_read_user_content not granted (code 10))

---

## Headline

In 27 days since the 2026-08-04 baseline, Blue Rose Auto Care & Repair Services total ad investment moved from $731.40 to $3,311.81 (+352.8%); the account is now delivering $2,715.71 of measured spend per 30 days against 66 leads at a $41.15 cost per lead. Baseline recorded no attributed performance, so the delivery metrics below are first measurements rather than regressions.

---

## Account trajectory

Metrics with a baseline on both sides. These are true before/after comparisons.

| Metric | Baseline | Current | Change |
|---|---|---|---|
| Lifetime ad spend | $731.40 | $3,311.81 | ↑ +2580.41 (+352.8%) |
| Avg daily spend | $27.41 | $61.36 | ↑ +33.95 (+123.9%) |
| Campaigns (total) | 4 | 9 | ↑ +5 (+125%) |
| Campaigns (active) | 2 | 5 | ↑ +3 (+150%) |
| Naming compliance | 0% | 44.4% | ↑ +44.4pp (from 0) |
| Zombie campaigns | 0 | 0 | — no change |
| Custom audiences | 3 | 3 | — 0 (0%) |
| Broken audiences | 0 | 0 | — no change |

---

## Performance now measurable

The baseline recorded no delivery or conversion metrics — the account was
27 days old with no attributed results yet. These are
first measurements, not regressions.

| Metric (trailing 30d) | Baseline | Current | Status |
|---|---|---|---|
| Ad spend | _not measured_ | $2,715.71 | first measurement |
| Impressions | _not measured_ | 209,714 | first measurement |
| Reach | _not measured_ | 77,123 | first measurement |
| Frequency | _not measured_ | 2.72 | first measurement |
| Link clicks | _not measured_ | 2,729 | first measurement |
| CTR | _not measured_ | 1.3% | first measurement |
| CPM | _not measured_ | $12.95 | first measurement |
| CPC | _not measured_ | $1.00 | first measurement |
| Leads — on-Meta forms | _not measured_ | 48 | first measurement |
| Leads — website pixel | _not measured_ | 18 | first measurement |
| Leads — all sources | _not measured_ | 66 | first measurement |
| Cost per lead — on-Meta forms | _not measured_ | $56.58 | — |
| Cost per lead — website pixel | _not measured_ | $150.87 | — |
| Cost per lead — blended | _not measured_ | $41.15 | first measurement |
| ROAS | _not measured_ | — (no purchase events) | — |

> **Reading the lead rows.** Meta reports three different lead counts and they are
> not interchangeable. Ads Manager's **Results** column shows only each campaign's
> own optimization event — for a `LEAD_GENERATION` / on-ad-form campaign that is
> the on-Meta form count, *not* the all-sources total. Quote the row that matches
> the campaign's objective when discussing a single campaign; the blended figure
> is only meaningful account-wide. Note also that the two per-source cost-per-lead rows divide **total** account
> spend by that one lead type, so each is an upper bound, not the true cost of that
> funnel — only the blended row is a clean spend-over-leads figure.

---

## Pixel

**Not comparable.** The baseline was captured on pixel `2183558222437003`; the account now reports on pixel `1798280031363662`. These are different datasets, so no delta is shown — the current figure is a fresh count on the new pixel.

| Metric | Baseline | Current | Change |
|---|---|---|---|
| Pixel events / 30d | _not measured_ | 79 | n/a — different pixel |

---

## Where the change came from

- **Paid:** Spend concentrated into two lead campaigns. `CONV_COSM_202607_LeadsForm` ($1,048.65, 21 leads, 2.28% CTR, $49.94/lead) and `CONV_COSM_202607` ($904.22, 29 leads, 2.65% CTR, $47.59/lead) took 72% of 30-day spend and produced 50 of the 66 leads — and they are also the two most efficient campaigns in the account. The newer small-budget campaigns are all more expensive per lead: `New Leads Campaign` $49.06, `Ceramic Pro` $60.95, `Comercial Wraps` $73.94, `PPF - Transformation UGC Content` $104.86. The two awareness campaigns (`AWARE_COSM_202607`, `AWARE_BROAD_202607`) absorbed $241 at 0.12–0.17% CTR and returned zero leads; they are buying cheap impressions ($1.97–$2.51 CPM) and nothing else. Blended CPL of $41.14 sits above the $35 target but inside the $105 pause threshold, and frequency at 2.72 is under the tightened 3.5 cap for this geo.
- **Creative:** 28 ads have run in the window, but delivery is concentrated in two: `PPF Broad Audience_ web_form` ($962, 2.25% CTR) and `New Leads ad` ($728, 2.61% CTR). The highest-CTR asset, `PPF - Transformation UGC Content` at 4.28%, was paused after $104 having produced one lead — strong hook, weak conversion. Five branded posters were produced since the baseline (`LEADS_CERAMIC_GLOSS`, `LEADS_CERAMIC_PROTECT`, `LEADS_MECH_TRUST` 4x5 + 9x16, `AWARE_LEGACY` 1x1 + 4x5). No creative-quality score is available in this report — that requires a `/audit-creative` re-run.
- **Optimization:** Naming compliance moved 0% → 44.4% (4 of 9 campaigns), with five still off-convention (`CONV_COSM_202607_LeadsForm`, `Comercial Wraps`, `New Leads Campaign`, `Ceramic Pro`, `PPF - Transformation UGC Content`). Four campaigns were paused during the window rather than deleted, per policy, and there are zero zombie and zero broken audiences. The 2026-08-31 analysis scored account Opportunity at 0 — no reclaimable or scalable spend detected — and raised three flags: an attribution anomaly on `PPF Broad Audience_ web_form` (121 clicks, $203.71, no attributed revenue — pixel gap suspected), a spend spike on `New Leads Ad` (7-day daily spend 4.3× the 30-day average), and a SCALE_WATCH on `New Leads Ad Set` held back because 10 conversions is under the 15-conversion significance floor.

---

## Not covered by this report

**Organic (Facebook + Instagram) is excluded entirely.** The 2026-08-04 baseline recorded `avg_engagement_rate: null` because the app lacks `pages_read_user_content`; that is still true today (verified against `/{page}/posts`, error code 10), so re-running `/audit` cannot fill it. Instagram was `blocked` at baseline (API 100) and has no anchor either. **Content quality score is excluded** — it needs a `/audit-creative` re-run. **Pixel events are shown but not compared**: the baseline was captured on the legacy Ducker Creative pixel `2183558222437003`, while the account now reports on client pixel `1798280031363662`. Note `profile.json` still carries `pixel_installed: false` even though the new pixel logged events in the window — worth reconciling. **ROAS is unavailable**, not zero: this account optimizes for leads and fires no purchase events, so no revenue is attributed.

**One reconciliation item.** `Ceramic Pro` reports 8 website-pixel leads in this window despite its adset using an on-ad instant form with the Page (not a pixel) as its promoted object. Those pixel leads are attributed to the campaign but did not come through its own form, so they should not be read as campaign results. This is consistent with the attribution anomaly `/analyze` already flagged on this account and warrants a `/capi-setup` check before any per-campaign CPL is quoted to the client.

---

_Generated by smOS · 2026-08-31T14:28:14.828Z_
