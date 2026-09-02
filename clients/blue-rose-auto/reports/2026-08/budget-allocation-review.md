# August Budget & Performance Review — Blue Rose Auto Care & Repair Services

**Window:** 2026-08-01 → 2026-08-31 · Target mix: 10% Awareness/Engagement · 20% Creative Testing · 70% Lead Generation

## Executive Summary

August was the month the account moved from testing into real lead generation. Spend
scaled **4.9x** month-over-month ($580 → $2,830) while blended cost-per-lead fell **36%**
($72.54 → $46.39) on the audited lead count. The account produced **61 CRM-audited leads**
for **$2,829.61** in spend, and — even though the budget split was never mechanically
enforced — actual spend landed almost exactly on the agreed 10/20/70 target: **8.6%
awareness/engagement, 19.4% creative testing, 72.0% lead generation.**

Two things need your attention this month, not just next month's plan:

1. **~$443 (16% of spend)** sat in awareness campaigns and the Marketplace placement with
   zero leads back — the same efficiency gap as always, and still the biggest lever.
2. **We cross-checked Meta's reported leads against the CRM and found an overclaim.**
   Meta's dashboard says 73 leads; the CRM's own first-party tracking can only confirm 61
   of them. The gap is entirely inside one campaign — see Section 2.

> **Read the ROAS figures with care.** Meta is reporting a *configured* lead value
> (~$174/lead) as "revenue," not actual booked ticket revenue — every ROAS number in the
> underlying data is modeled, not cash. Lead volume and cost-per-lead are the real
> scoreboard until closed-ticket revenue is fed back into the pixel (see Recommendation 8).

## 1. How Much We Spent, How Much We Got

| Metric | August (audited) | July | Change |
|---|---|---|---|
| Spend | $2,829.61 | $580.29 | +388% |
| Leads (CRM-audited) | 61 | 8 | +663% |
| Blended cost/lead | $46.39 | $72.54 | **−36%** |
| Impressions | 209,864 | 196,844 | +6.6% |
| Link CTR | 0.57% | 0.10% | +0.46pp |
| CPM | $12.95 | $2.95 | +339% |
| Frequency | 2.72 | 1.38 | +1.34 |

Lead mix (audited): 51 on-Meta lead-form submissions + 10 CRM-confirmed website leads
(Ceramic Pro's confirmed contacts) = 61. Meta's own dashboard reports 73 (see Section 2 for
why we don't use that number as the headline).

**Against targets:** audited cost/lead of $46.39 is 33% over the $35 target — worse than
last week's read, because the correction below removed 12 leads that were never real. The
final 7 days of August still ran cheaper on a Meta-reported basis ($20.53), though that
figure hasn't been through the same CRM audit yet — treat it as directionally encouraging,
not confirmed. Link CTR (0.57%) is still under the 1% target. Frequency (2.72) has headroom
below the 3.5 saturation ceiling for this 30-mile Springfield/Eugene radius.

## 2. Lead Source Audit — What We Found Cross-Checking the CRM

You asked whether all reported leads are really from Facebook. They aren't all confirmed,
and one campaign's numbers don't hold up. Here's the full reconciliation, pulled directly
from the August CRM export (`august-crm.csv`) and Meta's raw insights API.

**Account-wide, deduplicating GHL's habit of logging one submission into two pipelines,
August had 135 unique real people across every ad-attributed pipeline:**

| Source (per the CRM's own tracking) | Unique people |
|---|---|
| Facebook — confirmed (native Lead Ads integration, tagged `facebook`) | 58 |
| Google — confirmed (`gclid` present, or logged in the dedicated Google pipelines) | 20 |
| No attribution data captured at all | 56 |
| Other (referral) | 1 |

The 56 with no data aren't proof of anything either way — this account has a **documented
pixel/GHL tracking gap** (`pixel-ghl-diagnostic.md`, flagged 2026-08-04): iframe-embedded
GHL forms often fail to fire pixel events with attribution intact. So most of that 56 is
an unresolved tracking hole, not evidence against Meta.

**One campaign we *can* fully resolve: `Ceramic Pro`.** Meta's dashboard claims 16 leads
(4 on-Meta form + 12 "website" leads via pixel match). Tracing every CRM row tagged to that
campaign turns up exactly **4 unique contacts** — Ralph Halvorsen, Steve Hubbard, Joe Knapp,
Bill True — each logged into two pipelines for the same submission. That matches Meta Ads
Manager's own "Results" column (4) exactly. The other 12 "website leads" Meta's pixel
credited to this campaign have **no corresponding CRM record** — not "wrong platform," just
not found. Most likely cause: the same 1-day view-through attribution window that let Meta
claim credit without a click, layered on the known tracking gap.

**What this changes:** we corrected Ceramic Pro to its 4 CRM-confirmed leads. We have not
re-audited the two core lead-generation campaigns (`CONV_COSM_202607`,
`CONV_COSM_202607_LeadsForm`) line-by-line — the bulk of their volume (41 of 51 leads) is
already the more reliable on-Meta form type, and campaign-level CRM tags were only present
on about half of the confirmed-Facebook contacts, so a clean per-campaign audit isn't
possible from this export alone. Auditing those two next is Recommendation 1 below.

**Also worth knowing:** Google Ads ran 20 confirmed leads of its own in August, through
separate campaigns and separate spend — those are not part of this Meta budget or this
report's numbers, but they're a reminder that a lead crossing both platforms' attribution
windows can get double-counted if nobody reconciles it. This report's 61 does not include
any Google-sourced lead.

## 3. Where the Budget Actually Went vs. the 10/20/70 Target

Bucketed by campaign objective and role (Meta campaign-level spend, August, audited leads):

| Bucket | Target % | Actual $ | Actual % | Δ vs Target | Leads (audited) | Blended cost/lead |
|---|---|---|---|---|---|---|
| **Awareness / Engagement** | 10% | $242.00 | 8.6% | −1.4pp | 0 | — |
| **Creative Testing** | 20% | $549.25 | 19.4% | −0.6pp | 10 | $54.93 |
| **Lead Generation (core)** | 70% | $2,038.36 | 72.0% | +2.0pp | 51 | $39.97 |
| **Total** | 100% | $2,829.61 | 100% | — | 61 | $46.39 |

**Bucket definitions:**
- *Awareness/Engagement* — `AWARE_COSM_202607`, `AWARE_BROAD_202607`
- *Creative Testing* — `Ceramic Pro` (corrected to 4 audited leads), `Comercial Wraps`,
  `New Leads Campaign`, `PPF - Transformation UGC Content`
- *Lead Generation (core)* — `CONV_COSM_202607`, `CONV_COSM_202607_LeadsForm` (Meta's
  reported figures, pending the same line-by-line audit)

**Read:** the mix discipline is still good — the budget split held within 2 points of plan
without anyone forcing it. But the audit moves Creative Testing from "best bucket in the
account" to the **weakest**: $54.93/lead once Ceramic Pro's overclaim is removed, worse
than the awareness bucket would look if it had produced anything at all. That reverses last
week's read, where Ceramic Pro looked like the standout.

## 4. Where the Leads Came From

Two ad sets carried the month on Meta's own reporting: **PPF Broad Audience – Leads
From_web** ($1,004.91 → 21 leads @ $47.85) and **PPF Broad Audience – Leads From** ($771.08
→ 27 leads, 18 form + 9 website, @ $28.56). Together that's $1,776 — 63% of total spend —
producing the large majority of lead-generation-bucket volume. These have not yet been
individually CRM-audited; treat their reported numbers as likely-accurate but not yet
proven the way Ceramic Pro now is.

Against that, **$242 across eight awareness ad sets produced zero leads** (0.06–0.53%
CTR), and **$201.16 into the Marketplace placement produced zero attributed
conversions** at a 0.09% CTR — the single worst placement in the account. Combined, that's
**~$443, or 16% of August spend, with nothing to show for it.**

| Placement | Spend | CTR | CPM | CPA |
|---|---|---|---|---|
| facebook/feed | $1,234.77 | 2.57% | $17.83 | $41.16 |
| facebook/facebook_reels | $777.71 | 1.43% | $20.66 | $77.77 |
| facebook/facebook_notification | $141.82 | 5.39% | $78.75 | $35.46 |
| instagram/feed | $96.25 | 1.49% | $23.46 | $32.08 |
| instagram/instagram_reels | $85.52 | 0.97% | $19.27 | $85.52 |
| facebook/facebook_stories | $69.15 | 3.87% | $66.94 | — |
| facebook/facebook_reels_overlay | $20.85 | 0.95% | $9.86 | $20.85 |
| **facebook/marketplace** | **$201.16** | **0.09%** | — | **no conversions** |

**Creative fatigue:** 7 of 12 tracked ads are declining or expired (0% of peak CTR).
The best-performing creative all month was the **PPF Transformation UGC content at a
4.28% CTR** — more of that format is the highest-leverage creative move for September.

## 5. SWOT Analysis

### Strengths
- The core lead-gen engine is real and mostly proven: the two core PPF campaigns delivered
  51 leads (41 of them on-Meta form leads, the hard-to-fake kind) at $39.97 blended.
- Efficiency still improved while scaling — cost/lead fell 36% as spend rose 4.9x, even
  after removing 12 phantom leads. That's the opposite of the usual scaling penalty.
- Budget discipline: actual spend landed within ~2 points of the agreed 10/20/70 split
  without manual enforcement.
- Frequency (2.72) sits comfortably below the 3.5 fatigue ceiling — room to grow spend in
  this audience before saturation.
- A clear creative winner is identified (UGC transformation content, 4.28% CTR) and is
  repeatable.
- We now have a working audit method (CRM cross-check by campaign tag) to keep Meta's
  reporting honest going forward.

### Weaknesses
- Awareness/Engagement spend produced zero measurable leads all month.
- Link CTR (0.57%) remains under the 1% target account-wide.
- ROAS is not real — it's a modeled $174/lead value, so true profitability is unknown.
- 16% of August spend ($443) sat in campaigns/placements with no return.
- **Meta's own dashboard overstated leads by at least 12 (16%) in one campaign alone** —
  view-through "website leads" that don't correspond to any CRM record. The two core
  campaigns haven't been checked the same way yet, so the true account-wide overclaim
  could be larger.
- One ad set (`Get Pampered – Leads From 2`) ran at $123.10 CPA — 3.5x target, past the
  $105 pause threshold.
- Majority of tracked creatives (7 of 12) are past peak performance.
- A known GHL/pixel tracking gap leaves 56 real CRM contacts with no attribution data at
  all, which is what let the Ceramic Pro overclaim go undetected until this audit.

### Opportunities
- Reclaim the ~$443 sitting in dead weight and redeploy it into the two proven PPF
  campaigns.
- Fix the pixel/GHL tracking gap once — it resolves this month's audit question
  permanently and protects every future report from the same overclaim risk.
- Feed closed-ticket revenue back into Meta's tracking — turns modeled ROAS into a
  real profit number and unlocks profit-based (not just cost-per-lead) scaling decisions.
- Produce more UGC-style transformation content — the account's best-performing format,
  currently under-supplied relative to how well it performs.
- Local market (30-mile radius) is not yet saturated — frequency headroom supports
  further scaling before diminishing returns set in.

### Threats
- The 30-mile Springfield/Eugene radius is a hard ceiling — as spend grows, frequency
  will climb faster than in a national account, and efficiency gains from August won't
  repeat indefinitely.
- CPM rose 339% month-over-month ($2.95 → $12.95) — cost to reach the audience is
  climbing, likely from more competitive bidding into the same local pool.
- Trusting platform-reported leads without a CRM cross-check risks scaling budget into a
  campaign that looks efficient purely because of an attribution artifact — as almost
  happened with Ceramic Pro this month.
- Google Ads is running concurrently in the same market; without consistent UTM/gclid
  hygiene, leads can be claimed by both platforms and double-counted in a blended report.
- Reliance on two campaigns for the majority of leads means any fatigue or Meta delivery
  throttle on either one has an outsized impact on total lead flow.

## 6. September Recommendations

1. **Audit the two core lead-generation campaigns the same way we audited Ceramic Pro.**
   They're likely mostly clean (41 of 51 leads are on-Meta form leads), but 10 are
   pixel-matched website leads that deserve the same CRM trace before September's budget
   call leans on them. *Owner: analytics · Budget Δ: $0.*
2. **Fix the GHL/pixel tracking gap** (`pixel-ghl-diagnostic.md`) so future website leads
   carry reliable UTM/click data instead of falling into the "no attribution" bucket. This
   is what let the Ceramic Pro overclaim go unnoticed for a month. *Owner: human/dev ·
   Budget Δ: $0.*
3. **Hold the 10/20/70 split — don't rebalance, reallocate within it.** The mix itself is
   working; the fix is cutting dead weight and bad data inside each bucket.
4. **Cut the awareness campaigns — reclaim ~$242/mo.** `AWARE_COSM_202607` and
   `AWARE_BROAD_202607` produced zero leads across the month at 0.06–0.53% CTR. If
   awareness spend continues, run it as remarketing to warm audiences, not a cold
   objective. *Budget Δ: −$242/mo.*
5. **Exclude the Marketplace placement — reclaim ~$201/mo.** 0.09% CTR, zero attributed
   leads, worst surface in the account by an order of magnitude.
6. **Redeploy the reclaimed ~$443 into the two proven PPF campaigns**, stepping up in
   ≤20% weekly increments and re-checking frequency against the 3.5 ceiling each week.
7. **Pause `Get Pampered – Leads From 2`** ($123.10 CPA, past the pause threshold) and
   `Ceramic Pro` in its current form pending the tracking fix — 4 confirmed leads at
   $37.33 is unremarkable, not a standout, so there's no efficiency case to scale it as-is.
8. **Wire real ticket revenue into Meta's conversion tracking.** Confirm server-side lead
   events are deduplicated, then feed closed-ticket values back so September can be judged
   on real profit, not a flat modeled $174/lead assumption.
9. **Refresh the 7 declining/expired creatives**, prioritizing more of the UGC
   transformation format — the account's highest-CTR content all month.

**Net effect if executed:** ~$443/mo of underperforming spend redirected into confirmed
lead generation, plus a tracking fix that keeps every future report honest without an
after-the-fact audit — with no increase to the committed monthly budget.

---
*Prepared by smOS for Blue Rose Auto Care & Repair Services · sources: `data/performance_analysis.json`
(campaign metrics), `reports/2026-08/monthly-review.raw.json` (daily trend, fatigue, placement, adset
data), `reports/2026-08/august-crm.csv` (GHL CRM export, lead source reconciliation), Meta Graph API
v25.0 raw insights (attribution-window breakdown).*
