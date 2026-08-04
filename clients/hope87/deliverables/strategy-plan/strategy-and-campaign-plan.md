# HOPE'87 — Strategy & Campaign Plan

**Prepared for internal agency scoping.** Grounded in `prospects/hope87/synthesis.json` (pre-audit score 26/100) and `clients/hope87/profile.json`. Where a figure is not sourced from those files it is marked **[RECOMMENDATION]** and is an estimate, not a fact.

---

## 0. Situation Summary (from source files)

- Score: **26/100**. Weakest dimensions: ad_maturity 15, pixel_tracking 15, outspend_gap_inverse 5, posting_consistency 25. Strongest: page_completeness 70.
- **0 ads ever run** in AT/DE. Competitor Islamic Relief Worldwide ran **104 ads in AT+DE in 90 days (~35/month)**, 76 of which (73%) were carousel format.
- **No Meta Pixel / GTM / GA4** anywhere on hope87.at (checked ~148KB homepage HTML, 67 external scripts). Every PayPal donation click is unmeasured today.
- Organic cadence has collapsed to **0.75 posts/week**, 11.6 days since last post, vs. a 3x/week maintained-account benchmark.
- Real organic equity exists: FB Page 2,696 likes, 18 talking-about; IG (@hope87.at) is a Nonprofit-categorized Business account, 289 followers, linked PayPal donation page.
- Org facts: est. 1987, active in 9 countries, programs = youth training / employment / livelihood-skills development, donor base = Pakistani diaspora in Austria + Germany, conversion event = Donation (PayPal today, moving to on-site flow with the Astro rebuild), currency EUR, timezone Europe/Vienna, voice = warm/trustworthy/community-rooted/humble-but-credible, CTA style = soft.
- Ad account, pixel, IG business ID are all TBD in `profile.json` — paid cannot launch until `/setup-accounts`-equivalent work is done (see §5).

---

## 1. Primary Donation Cause Framing

Do not sell "help the poor" generic-aid framing — the audit and profile both point to a specific, ownable asset: **decades-proven skills/livelihood outcomes** (profile `usp`: "tangible livelihood and skills-training outcomes donors can point to"). For a Pakistani-diaspora donor in AT/DE, the emotional hook is usually personal — they left Pakistan (or their parents did) for better opportunity; funding someone else's shot at the same is a direct, legible story.

**Flagship framing: "Sponsor a Training Seat"**
Position a single youth's place in a HOPE'87 training/employment program as the atomic, giveable unit — not a general fund. This gives the campaign a concrete price-point ask, a name/story to follow, and a before/after outcome (trained → employed). It also converts "skills development" (an abstract program category) into something a diaspora donor can literally sponsor, the way they already sponsor a relative's education or a mosque renovation back home.

- Angle A — **"Ek Seat, Ek Mustaqbil" (One Seat, One Future)**: bilingual EN/DE (Urdu-inflected creative) appeal asking diaspora donors to fund one training seat. Works as an evergreen always-on ad and as a Ramadan/Qurbani seasonal spike.
- Angle B — **"From Trainee to Employed"**: outcome-framed appeal built around the employment conversion, not just training attendance — speaks to a diaspora audience that is pragmatically outcome-oriented (they ask "did it actually work") more than pure-charity donors.
- Angle C — **"Build Where We're From"**: community/homeland-pride framing tying the 9-country footprint back to the diaspora's countries of origin/heritage, useful for top-of-funnel awareness content rather than direct-ask creative (softer CTA, matches the profile's `cta_style: soft`).

Angle A should be the flagship — it is the most concrete, most repeatable across seasonal moments, and most consistent with "storytelling over statistics" (profile `voice.tone`).

---

## 2. Donation Campaign Strategy (First 90 Days)

### Conversion event
Cannot run a conversion campaign until Pixel/CAPI exists (`gaps[0]`). Once installed, the conversion event should be **Donate** (matches `business.usp`/`conversion_event` field and the audit recommendation to "define a Donate conversion event"). Until the on-site donation flow ships (Astro rebuild), Donate will be a proxy event fired on PayPal-link click-out plus, if feasible, PayPal IPN/webhook-based server-side confirmation via CAPI so the event isn't purely a click-intent signal.

### Phased structure

**Days 1–30 — Foundation (per synthesis.json `next_steps.day_30`)**
- Install Meta Pixel + CAPI on the donation flow; define the Donate event.
- Do NOT launch a conversion campaign yet — Meta's delivery optimization needs signal it doesn't have. Launch the **first paid test as a Traffic/Landing-page-view or Link-click campaign** at a small daily budget to start collecting pixel data and validate the funnel, exactly as synthesis.json specifies: **"launch first $50/day AT/DE conversion test."**
- Organic in parallel: begin the cadence rebuild (§3) so paid isn't landing on a cold/dormant Page.

**Days 31–60 — Seasonal + iteration (per `next_steps.day_60`)**
- Layer in a moment-based appeal. Because this is a Muslim-diaspora donor base, the highest-leverage giving moments are **Ramadan (Sadaqah/Zakat-eligible framing where applicable), Qurbani/Eid al-Adha, and Eid al-Fitr** — check actual 2027 lunar calendar dates against the 90-day window when scheduling; these are the moments Islamic Relief Worldwide is almost certainly already capturing given their ad cadence.
- Shift budget toward whichever of Angle A/B (from §1) is outperforming on CTR/CPA once there's enough spend to compare (synthesis.json's own KPI-threshold logic: don't judge before minimum spend).
- Restore organic to 3x/week (audit target) — feeds retargeting audiences for paid.

**Days 61–90 — Full-funnel + benchmark (per `next_steps.day_90`)**
- Move qualifying adsets to the Donate conversion objective once pixel data volume supports it.
- Report performance explicitly against the Islamic Relief Worldwide ad-volume benchmark (35/month) — not to copy their spend, but because that's the stated competitive reference point in the audit.
- Retainer/scope review.

### Starting budget **[RECOMMENDATION]**
No `kpis.monthly_budget_low/high` is set in the client profile (all null) — there is no client-approved number yet. Based on the audit's own explicit "$50/day" first-test figure (synthesis.json `next_steps.day_30`), a defensible starting range to propose is:
- **Month 1: ~€1,200–€1,500/mo** (≈€50/day test level, matches the audit's own recommendation, stays under the €500/day single-day cap and the €200/day new-campaign auto-launch cap in the client's CLAUDE.md).
- **Months 2–3: ~€1,500–€2,500/mo [RECOMMENDATION]**, scaling only into what's proven, and gated by the client's Discord approval flow for any change above auto-execute thresholds.

This must be confirmed with the client — `kpis.monthly_budget_low/high` and `target_cpa`/`target_roas` are all currently null and should be filled before `/strategy-brief` is run formally.

---

## 3. Awareness & Trust-Building Strategy

The audit explicitly frames the core tension: **"real community trust but zero paid presence and zero tracking."** Diaspora donors are typically more skeptical of "where does my money actually go" than a general donor pool, precisely because they often have first-hand knowledge of on-the-ground conditions and have seen other NGOs mismanage funds. Trust content should do double duty: rebuild organic cadence AND pre-warm cold paid audiences.

Recommended content mix (feeds `/content-plan` cadence rebuild):
- **Impact stories, name-and-face format**: one trainee/program-graduate profile per week — ties directly to the "Sponsor a Training Seat" framing in §1 so a donor can later be shown "this is what your seat funded."
- **Transparency/accountability proof points**: 9-country footprint and 1987 founding date are underused trust assets — use them explicitly ("39 years, 9 countries" style proof) rather than generic mission statements. If HOPE'87 has annual reports, financial disclosures, or third-party certifications (this profile doesn't list any — confirm with client), those should become their own content pillar; nonprofit donors respond strongly to "here is the audited breakdown of how your donation is spent."
- **Community/testimonial content from the AT/DE diaspora itself**: local Austrian/German-Pakistani community members or partner mosques/associations vouching for HOPE'87 — third-party trust signals carry more weight with a skeptical diaspora audience than the org talking about itself.
- **Format split**: Reels for reach/discovery, carousels for engagement/saves and multi-fact storytelling (recommended by synthesis.json's own `recommendations[2].action`) — carousel is also the format the competitor over-indexes on (see §6), so HOPE'87 should have carousel competency regardless of whether it copies the cadence.
- **Cadence target: 3x/week**, up from the current 0.75x/week — the audit's stated benchmark for a "maintained account," and the direct fix for `gaps[2]`.

---

## 4. Diaspora Targeting Specifics (Meta)

Ad account/pixel do not exist yet (`accounts.ad_account_id: "TBD_no_ad_account_yet"`), so the below is the targeting plan to build once `/setup-accounts` + `/capi-setup` are complete.

**Geo & core targeting**
- Countries: Austria, Germany (per `audience.geo_targets`), age 25–55, all genders (per `audience` block) — this is the profile's existing audience definition, use as the base.
- Consider narrowing/splitting by city for launch efficiency (Vienna, Graz, Linz for AT; Berlin, Frankfurt, Munich, Cologne for DE tend to have the largest Pakistani-diaspora concentrations) — confirm with client which cities have active chapters/community ties, since this isn't in the source data.

**Interest stacking**
- Culture/heritage interests: Pakistan, Pakistani cuisine, Urdu-language media/pages, Pakistani news outlets available as Meta interests.
- Religious/community interests appropriate to a Muslim-majority diaspora audience: Islam, Ramadan, Islamic Relief and other Muslim-charity Pages (competitor/adjacent-audience overlap targeting), local mosque/community-association Pages where targetable.
- Diaspora-life interests: expat/diaspora community groups, Pakistani associations in Austria/Germany, remittance and diaspora-finance services (signal of diaspora identity + disposable income directed back "home").
- NGO-affinity interests: existing donors to comparable orgs (Islamic Relief Worldwide, Human Appeal, Muslim Aid-style charities) as an interest/behavior proxy, since HOPE'87 has no first-party donor list yet.

**Lookalikes (future state)**
- Cannot build yet — no pixel, no donor list. Once CAPI is live and a donor list exists (even a small first-party list of PayPal/email donors provided by the client), build a **1% Donor Lookalike (AT+DE)** as the first LAL, then a **website-engaged lookalike** off pixel traffic once volume supports it. Flag this explicitly as a Month 2–3 deliverable, not Day 1 — there's no seed audience today.

**Language / creative split**
- Run **EN + DE creative variants** as the baseline bilingual pair (matches the Astro rebuild's stated dual-language EN/DE site structure).
- Layer **Urdu-language or Urdu-inflected creative** (headline hooks, on-image text, captions) as a third variant specifically for the Pakistani-diaspora segment — this is a differentiator none of the base EN/DE targeting captures and directly answers "how do we speak diaspora-specific," which the generic EN/DE site rebuild does not solve on its own.
- Recommend testing all three language variants against the same audience early, since there's no prior AT/DE ad data (0 ads ever run) to predict which resonates best.

---

## 5. Audit Gap → Action Map

| Gap (from `synthesis.json.gaps`) | Action | Owner |
|---|---|---|
| **Gap 1:** No Meta Pixel/GTM/GA4 anywhere on hope87.at — every donation click unmeasured | Install Meta Pixel + server-side CAPI on the PayPal/donation handoff now (pre-rebuild), then re-implement in the Astro rebuild's on-site donation flow; define the `Donate` conversion event | **Agency** (technical install/CAPI config) + **Client** (site/dev access, confirming PayPal webhook or on-site flow timing with the Astro rebuild team) |
| **Gap 2:** 0 ads ever run in AT/DE vs. Islamic Relief Worldwide's ~35/month | Stand up ad account + pixel (`/setup-accounts` equivalent — currently all TBD in `accounts`), then launch the Day-30 $50/day AT/DE test per §2 | **Agency** (Meta account build, campaign structure, creative) + **Client** (business verification, payment method, ad account access grant — these are manual-only gates) |
| **Gap 3:** Organic cadence collapsed to 0.75x/week, 11.6-day gap since last post | Rebuild to 3x/week cadence mixing Reels + carousel, anchored on impact-story/trust content per §3 | **Agency** (content calendar, drafting, scheduling via `/content-plan` + `/publish`) + **Client** (`content_preferences.mode` is currently `ai_assisted`, so the client should confirm they want AI-assisted captions vs. reviewing raw source material/photos for authentic story content) |

---

## 6. Competitor-Informed Creative Direction (Islamic Relief Worldwide)

**What to learn, not copy:**
- **Cadence, not content**: 104 ads in 90 days (~35/month) in the exact same two countries signals that sustained, high-frequency paid presence is table stakes for this donor segment — not that HOPE'87 needs to match that volume immediately. Recommend building toward a sustainable cadence rather than front-loading spend before tracking/creative are proven (see phased budget in §2).
- **Carousel as primary format (73% of their ads, 76/104)**: carousel format suits multi-step donor storytelling — problem → program → outcome → ask — and multi-fact/proof-point content (see §3 transparency pillar). HOPE'87 should build carousel competency as a first-class format, not an afterthought, but fill it with **its own** program stories (training-seat sponsorships, employment outcomes) rather than replicating Islamic Relief's specific appeals or visual style.
- **Differentiate on identity, not format**: Islamic Relief Worldwide is a large international brand; HOPE'87's differentiator per its own USP is the **decades-long, hyper-local, culturally-specific trust relationship with the Pakistani diaspora specifically** (vs. a pan-Muslim/international-relief brand). Creative direction should lean into that specificity — HOPE'87 origin story (1987), direct community ties, named program outcomes — rather than competing on scale or generic humanitarian imagery.
- **Seasonal timing as a signal, not a script**: the competitor's ad volume in the exact AT/DE window strongly implies they are capturing Ramadan/Qurbani-adjacent giving moments (moment-based nonprofit appeals are typically ad-volume-heavy during these periods for Muslim-donor-facing NGOs). HOPE'87 should plan its own seasonal calendar around the same real calendar moments (§2) rather than reacting to or benchmarking against the competitor's specific creative.

---

## Open Items Requiring Client Input (not in source files)

- `kpis.target_cpa`, `target_roas`, `monthly_budget_low/high` — all null in `profile.json`; needed before `/strategy-brief` can set formal KPI thresholds.
- Whether HOPE'87 has any existing donor list (email/PayPal) for future lookalike seeding.
- Confirmation of specific AT/DE cities with active diaspora community chapters/partnerships.
- Availability of annual reports/financial transparency material for the trust-content pillar.
- Timeline of the Astro rebuild vs. the recommended immediate pixel/CAPI install (may require a temporary tracking solution on the current WordPress site).
