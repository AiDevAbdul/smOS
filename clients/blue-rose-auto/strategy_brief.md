# Strategy Brief — Blue Rose Auto

**Prepared:** 2026-06-18 · **Engagement month:** 2026-06 · **Status:** Awaiting approval in thread

---

## TL;DR

Run two parallel objectives — **AWARE** (own the brand-recall layer that local auto competitors skip) and **LEADS** (form/quote conversions) — across four adsets that map to the four customer clusters Blue Rose's site already speaks to. Lead with the two genuine differentiators: **30+ years / ASE-certified** and **Tesla-capable**. Avoid the discount-driven race the rest of the local category is stuck in.

---

## Positioning

> Blue Rose isn't the cheapest shop. It's the one your car will leave better than it arrived — whether that's a brake job or a $3,500 ceramic coat. 30+ years of hands-on work, ASE-certified technicians, Tesla-capable, premium materials. The shop the locals send the work they can't (or won't) take on themselves.

Three voice pillars: **craftsmanship**, **competence**, **calm**. No urgency tricks. No "lowest prices." No miracle language.

---

## Campaign architecture (month 1)

| Campaign | Objective | Daily budget | Adsets | Status at create |
|---|---|---|---|---|
| `AWARE_BROADGEO_202606` | OUTCOME_AWARENESS | $25/day | 1 (broad geo, no interest layer) | PAUSED |
| `CONV_LUXCOS_202606` | OUTCOME_LEADS | $40/day | 1 (luxury / cosmetic owners) | PAUSED |
| `CONV_TESLAEV_202606` | OUTCOME_LEADS | $20/day | 1 (Tesla + EV owners) | PAUSED |
| `CONV_MECHBROAD_202606` | OUTCOME_LEADS | $30/day | 1 (mechanical / repair broad) | PAUSED |

Total daily: **$115/day → ~$3,450/mo** at the high end of the planning assumption.
Lower-bound start: **$50/day → ~$1,500/mo**, by halving each adset budget.

CBO at campaign level is *not* used in month 1 — ABO (ad-set budget) gives cleaner per-cluster CPA reads while we're learning. Switch to CBO in month 2 once each adset has 30+ conversions.

---

## Audience strategy (summary)

Full detail in `audience_map.json`. Headline:

- **Cold prospecting:** 3 interest clusters (luxury cosmetic, Tesla/EV, mechanical broad) + 1 broad-geo awareness adset
- **Retargeting (month 2 onward, once pixel ramps):** RT_PIX_30D, RT_IG_ENG_365D, RT_VIDEO_75PCT_30D
- **Lookalikes (month 2 onward, once customer list is uploaded):** LAL_CUSTOMER_LIST_1PCT / 3PCT / 5PCT
- **Exclusions:** RT_FORM_SUBMIT_180D from all cold; EXC_EMPLOYEES from everything

---

## Creative strategy

Four hook families, mapped to the four adsets:

| Adset | Format | Hook family | Angle |
|---|---|---|---|
| AWARE broad | 15–30s reel | Trust / Legacy | "30+ years of work, one shop in Springfield" |
| LUXCOS | Carousel before/after | Transformation | "This Porsche came in. Watch what 14 hours of ceramic looks like." |
| TESLAEV | 15–30s reel | Whitespace / Specialist | "Your Tesla deserves better than the dealer wait" |
| MECHBROAD | Single image + benefit list | Trust / Practical | "ASE-certified. 30+ years. Most shops send us their hard jobs." |

Variants per adset: 5 hooks × (3 primary text + 3 headlines + 3 CTAs). Detail in `ad_copy.json` (next pass).

---

## KPI targets (locked from intake)

- **AWARE:** CPM < $15 · freq 7d 1.5–3.0 · cost per ad-recall lift TBD (Meta brand study not available at this budget)
- **LEADS:** CPA $35 (3× pause threshold $105 after $50 spend) · link CTR > 1.0% · ROAS proxy > 1.5
- **Hard pause rules:** see `clients/blue-rose-auto/CLAUDE.md`

---

## Optimizer behavior

- Daily 08:00 PT — `/analyze` then `/scale`
- Auto-pause ad once spend ≥ $50 AND CPA > $105
- Auto-pause ad once link CTR < 0.5% after $30 spend
- Auto-scale adset budget +20% if ROAS proxy > 1.5 for 3 consecutive days AND new budget ≤ $200/day (small-shop budget hygiene)
- Anything above $200/day single increase → Slack approval (this thread for now)

---

## Month-by-month roadmap

**Month 1 (2026-06):**
- Launch the 4 PAUSED campaigns the moment Meta access lands
- Activate after pixel + page IDs confirmed, customer list uploaded, approval reply in thread
- Optimizer runs daily; first `/report` after week 1

**Month 2 (2026-07):**
- Layer retargeting (RT_PIX_30D, RT_IG_ENG_365D, RT_VIDEO_75PCT_30D)
- Layer 1% / 3% / 5% lookalikes from uploaded customer list
- Begin CBO test on best-performing campaign
- First `/monthly-review` + refreshed `/before-after` vs locked baseline

**Month 3 (2026-08):**
- Promote winners; kill or refresh ads flagged `expired` by /monthly-review
- Add fleet-manager adset (`INT_FLEET`) if budget supports a 4th LEADS adset

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Pixel not firing → LEADS campaign blocked at launch by pixel-check hook | High | Verify Pixel + CAPI before approving /launch |
| Frequency spike on Tesla/EV adset (small audience) | High | Cap daily at $20–$30 month 1; freq pause threshold 3.5 |
| Discount-driven competitor copycat | Medium | Voice locked to craftsmanship — don't match price wars |
| Springfield/Eugene geo too small for AWARE freq cap | Medium | Watch frequency_7d in week 1; tighten budget if needed |
| Client cannot supply photo/video assets in time | High | Reel from technician + bay phone-shot is fine month 1; upgrade in month 2 |

---

## Blockers (from /audit)

Until these land, /launch produces artifacts only — no MCP create calls fire:

- `facebook_page_id`
- `instagram_business_id`
- `ad_account_id`
- `pixel_id`
- Confirmed monthly budget (default planning assumption: $1,500–$3,000/mo)
- Approvals channel (this thread is the interim default)

---

## Approval

Reply `approve` in thread to lock the brief and move to `/creative`. Reply `reject <reason>` to revise.

Per the global `/strategy-brief` skill, a 24-hour silence ping re-asks; a second silence halts the workflow.
