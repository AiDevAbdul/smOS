# HOPE'87 — 90-Day Roadmap & Weekly Actionable Plan

**Client:** HOPE'87 (hope87) · **Prepared:** 2026-07-31 · **Engagement start:** 2026-07-31 (Week 1 = week of Aug 3, 2026)
**Source docs:** `prospects/hope87/synthesis.json` (pre-audit score 26/100), `clients/hope87/profile.json`, `clients/hope87/CLAUDE.md`

## Grounding

Pre-audit found: no Meta Pixel/GTM/GA4 on hope87.at; 0 paid ads ever run in AT/DE vs. Islamic Relief Worldwide's ~35/month in the same countries; organic cadence collapsed to 0.75 posts/week (11.6-day gap); WordPress site has no bilingual (EN/DE) structure and donations route through an untracked PayPal link.

The client has since confirmed a wider scope than the pre-audit's three headline recommendations: a full website rebuild (WordPress → Astro, dual-language EN/DE, dedicated donation landing page), a ground-up visual rebrand of FB/IG, influencer partnerships with diaspora community orgs, and a standard paid-ads retainer — on top of the audit's own Pixel/CAPI, donation-campaign, and organic-cadence next steps.

**One deliberate resequencing vs. the audit's literal day-30 note:** the audit's `day_30` next step says "install Pixel + CAPI... launch first $50/day AT/DE conversion test." That assumes tracking can go live on the *existing* WordPress/PayPal setup. Because the confirmed scope replaces that setup entirely with an Astro donation landing page, installing the Pixel on the soon-to-be-replaced site would mean reinstalling it days later and losing early conversion data continuity. This plan instead: (a) runs a **pixel-independent awareness/engagement campaign** in Month 1 so paid distribution starts on schedule, and (b) installs Pixel + CAPI **once, on the new donation landing page** in Month 2, then launches the first conversion test immediately after — preserving the audit's spirit (paid presence fast, tracking before real spend) without building tracking twice.

---

## 1. 90-Day Roadmap

### Month 1 (Weeks 1–4): Foundation, Rebuild Kickoff, Pixel-Free Paid Test
**Goal:** Stop the organic bleed, get all five workstreams moving, and put HOPE'87's first-ever paid impression into AT/DE — without waiting on the website.

**Key deliverables**
- Website: discovery, sitemap, dual-language (EN/DE) IA, and wireframes for the Astro rebuild + donation landing page signed off.
- Content: visual rebrand kit v1 (colors/type/templates carried over from `/brand-visual`-style direction, since no locked brand kit exists yet), a 90-day content calendar, and Weeks 1–4 posts produced and published at ≥3x/week on FB+IG.
- Paid: bilingual (EN/DE, Urdu-inflected where natural) awareness/engagement campaign in AT/DE targeting Pakistani diaspora 25–55, built PAUSED, budget capped at €20–30/day, objective = Reach/Engagement (no pixel dependency, points to the existing PayPal donation flow).
- Influencer: longlist of 15–20 diaspora micro-influencers and community organizations in AT/DE, outreach begun.
- Organic: cadence restored and held at ≥3x/week for all 4 weeks.

**Dependencies / gates**
- Paid campaign this month is capped to **awareness/engagement objectives only** — no conversion objective, since Pixel/CAPI isn't installed yet and the donation flow is about to be replaced.
- Website wireframes need brand-voice and rebrand direction locked (from Content workstream) before Astro dev finalizes the donation landing page template — visual rebrand kickoff must start Week 1, not Week 4.
- Naming/guardrail defaults (PAUSED-on-create, ≤€200/day auto-launch cap) apply to the Week-1 awareness campaign per global CLAUDE.md.

### Month 2 (Weeks 5–8): Ship the Site, Install Tracking, First Conversion Campaign
**Goal:** Launch the new Astro site + donation landing page, get Pixel + CAPI verified firing on it, and convert the audit's day-30 recommendation into the first real conversion test — on the right tracking foundation.

**Key deliverables**
- Website: Astro site live (EN/DE), dedicated donation landing page live, old WordPress redirects in place.
- Paid: Meta Pixel + Conversions API installed on the new donation landing page, `Donate` conversion event defined and verified firing (test donations / Meta Events Manager Test Events), first $50/day AT/DE conversion campaign launched (Ramadan/Qurbani-style seasonal appeal creative, carousel-first format to match Islamic Relief's dominant 76/104-ad format), `capi-setup` guard cleared before spend increases.
- Content: full paid ad-creative package (bilingual carousel + single-image variants, hooks scored/linted per `/creative`), rebrand rollout across FB/IG profile, cover, highlight covers, and post templates.
- Influencer: 3–5 influencers/community orgs onboarded with signed content agreements; first co-branded organic posts.
- Organic: sustained 3x/week, reels-first per audit recommendation, now carrying the new rebrand look.

**Dependencies / gates**
- Pixel/CAPI install strictly requires the donation landing page to be live first — there is nothing to instrument on the old PayPal-only flow.
- Conversion-objective campaign strictly requires ≥3–5 days of verified Pixel/CAPI event firing before it launches (fail-closed: do not spend against unverified tracking).
- Social rebrand rollout requires the Month-1 rebrand kit to be finished and approved before go-live — do not push new templates mid-production.
- Influencer content requires the rebrand kit as well, so co-branded assets are on-brand from post #1.

### Month 3 (Weeks 9–13): Optimize, Scale, Full-Funnel Report
**Goal:** Iterate creative against real conversion data, scale what works, formalize the influencer program, and deliver the audit's day-90 full-funnel report + retainer review.

**Key deliverables**
- Paid: creative iteration on winning donation appeals (2–3 rounds), budget scaled ≤20% per qualifying adset per global auto-scale rule, format mix shifted toward carousel dominance, second seasonal-appeal concept tested if Month-2 concept plateaus.
- Content: beneficiary testimonial content from the skills-development/livelihood programs (the NGO's stated USP), a quarter-end recap reel.
- Influencer: attribution check (UTM'd traffic + any trackable donation lift from influencer posts), renew/expand decision for Month 4+.
- Organic: cadence audit against the 3x/week target, steady-state Month-4 calendar drafted.
- Reporting: `/before-after` vs. the original pre-audit baseline, full-funnel report benchmarked against Islamic Relief's ~35 ads/month pace, retainer review meeting with HOPE'87.

**Dependencies / gates**
- Scaling requires Month-2 conversion data to have cleared minimum-spend thresholds (CPA/ROAS gates per client CLAUDE.md KPI table) before any budget increase.
- The day-90 benchmark report requires the Month-1 baseline (`/audit` + `/before-after`) to exist as the comparison point — do not generate it without that baseline on file.

---

## 2. Week-by-Week Actionable Plan (Weeks 1–13)

Legend: **[Agency]** = smOS/agency-executed · **[Client]** = HOPE'87-executed · Workstream tag in brackets.

### Week 1 (Aug 3–7)
1. [Agency][Organic] Run `/audit` to capture the immutable baseline snapshot (Page, IG, ad-account state) before any changes are made.
2. [Agency][Website] Kick off Astro site discovery call; document current WordPress sitemap, page inventory, and PayPal donation flow to migrate.
3. [Agency][Content] Draft visual rebrand direction (colors, type, moodboard) for FB/IG; hold to client warm/trustworthy/community-rooted voice.
4. [Client][Website] Provide WordPress admin access, domain registrar access, and any existing brand assets (old logo files, program photos).
5. [Agency][Organic] Publish 1 post this week to begin closing the 11.6-day posting gap; schedule the next 2 for Week 2.

### Week 2 (Aug 10–14)
1. [Agency][Website] Deliver dual-language (EN/DE) sitemap + IA and donation-landing-page wireframe for client review.
2. [Agency][Content] Finalize rebrand kit v1 (profile picture, FB cover, IG highlight covers, 2 post templates).
3. [Agency][Organic] Publish 3 posts this week (cadence target reached); mix Reels + carousel per audit recommendation.
4. [Agency][Influencer] Build longlist of 15–20 Pakistani-diaspora micro-influencers / community orgs active in AT/DE.
5. [Client] Review + approve wireframes and rebrand kit v1 (sign-off needed before dev/production continues).

### Week 3 (Aug 17–21)
1. [Agency][Website] Begin Astro build against approved wireframes; stand up dual-language routing (EN/DE).
2. [Agency][Paid] Draft awareness/engagement campaign brief: `AWARE_DIASPORA25_202608` naming, AT/DE geo, age 25–55, bilingual creative, €20–30/day, built PAUSED.
3. [Agency][Content] Produce Week 3–4 organic post batch using rebrand kit v1; publish 3 posts.
4. [Agency][Influencer] Begin outreach to longlist (email/DM template introducing HOPE'87 + partnership ask).
5. [Client] Approve awareness campaign creative and geo/audience targeting before launch.

### Week 4 (Aug 24–28)
1. [Agency][Paid] Launch AT/DE awareness/engagement campaign (PAUSED→client-approved ACTIVE, ≤€30/day, no pixel dependency, links to existing PayPal flow).
2. [Agency][Website] Continue Astro build; implement donation-landing-page template (pixel/CAPI hooks stubbed in, not yet live).
3. [Agency][Organic] Publish 3 posts; monitor awareness campaign delivery (frequency, CTR) daily against KPI thresholds.
4. [Agency][Influencer] Confirm first round of influencer replies; shortlist 5–8 for formal partnership terms.
5. [Client] Confirm donation-page copy (mission language, program descriptions) for Astro build.

**Month 1 checkpoint:** baseline captured, cadence restored to 3x/week, rebrand kit live on socials, first-ever AT/DE paid impressions delivered, Astro site in active build, influencer shortlist forming.

### Week 5 (Sep 1–4, short week — public holiday Mon Sep 1 varies by market, plan around it)
1. [Agency][Website] Complete Astro site build; begin QA (bilingual copy accuracy, mobile responsiveness, donation-link handoff).
2. [Agency][Paid] Review Week 1–4 awareness campaign results; reallocate budget toward better-performing ad (EN vs. DE vs. bilingual creative).
3. [Agency][Organic] Publish 3 posts; start drafting Ramadan/Qurbani-style seasonal appeal concepts for Month 2 paid creative.
4. [Client] Final content review/sign-off on Astro site (EN + DE copy, donation landing page).

### Week 6 (Sep 7–11)
1. [Agency][Website] Deploy new Astro site + donation landing page to production; set up 301 redirects from old WordPress URLs.
2. [Agency][Paid] Install Meta Pixel + Conversions API on the live donation landing page; define `Donate` conversion event.
3. [Agency][Paid] Run Test Events in Meta Events Manager to verify Pixel + CAPI both fire correctly on a test donation.
4. [Agency][Influencer] Finalize partnership terms + content agreement with first 3–5 confirmed influencers/orgs.
5. [Client] Complete a real test donation on the new flow to confirm end-to-end tracking with the agency.

### Week 7 (Sep 14–18)
1. [Agency][Paid] Confirm 3–5+ consecutive days of clean `Donate` event data in Events Manager before spending against it (fail-closed gate).
2. [Agency][Paid] Build first conversion campaign `LEADS_DIASPORA_202609` (or `CONV_` per finalized objective), Ramadan/Qurbani-style bilingual carousel creative, $50/day AT/DE, PAUSED pending approval.
3. [Agency][Content] Produce carousel ad set (format-matched to Islamic Relief's dominant 76/104-ad carousel pattern) plus 2 single-image variants.
4. [Agency][Organic] Publish 3 posts featuring the new site/donation page launch.
5. [Client] Approve first conversion campaign creative + budget before go-live.

### Week 8 (Sep 21–25)
1. [Agency][Paid] Launch first $50/day AT/DE conversion campaign (client-approved, ACTIVE).
2. [Agency][Influencer] Publish first co-branded content with onboarded influencers (rebrand-kit-consistent visuals).
3. [Agency][Organic] Publish 3 posts; monitor conversion campaign daily (CPA, ROAS, frequency) against client KPI table.
4. [Agency][Website] Post-launch site QA pass — check page-load speed, form/donation submission edge cases, EN/DE language toggle.
5. [Client] Confirm donation receipt/thank-you flow is working correctly on 2–3 live test transactions.

**Month 2 checkpoint:** new bilingual Astro site + donation landing page live, Pixel/CAPI verified firing, first-ever conversion campaign running in AT/DE, rebrand fully rolled out across FB/IG, first influencer partnerships active.

### Week 9 (Sep 28–Oct 2)
1. [Agency][Paid] Pull first full week of conversion-campaign data; compare CPA/ROAS against client CLAUDE.md thresholds (pause if CPA > 3x target after €50 spend or ROAS < 1.0 after €100).
2. [Agency][Content] Draft creative iteration round 2 (new hook variants) based on Week 8 performance signal.
3. [Agency][Organic] Publish 3 posts; begin collecting beneficiary testimonial footage/photos from skills-development programs.
4. [Agency][Influencer] Track UTM'd referral traffic from influencer posts to date.

### Week 10 (Oct 5–9)
1. [Agency][Paid] Launch creative iteration round 2 on the conversion campaign; retire underperforming ad variants (below 0.5% CTR after €30 spend).
2. [Agency][Paid] If any adset clears the 3.0+ ROAS-for-3-consecutive-days scale threshold, auto-scale budget ≤20% per global auto-execute rule.
3. [Agency][Content] Edit first beneficiary testimonial piece (video or carousel) for late-Q3 posting.
4. [Client] Review and approve testimonial content for public use (consent from featured beneficiaries).

### Week 11 (Oct 12–16)
1. [Agency][Paid] Test second seasonal-appeal concept if Month-2 concept has plateaued (frequency > 4.0 in 7-day window).
2. [Agency][Organic] Publish 3 posts including the approved testimonial content.
3. [Agency][Influencer] Mid-point attribution check: compile referral traffic + any trackable donation lift by influencer.
4. [Agency][Website] Minor site fixes/polish based on 6 weeks of live analytics (bounce points, donation-flow drop-off).

### Week 12 (Oct 19–23)
1. [Agency][Paid] Consolidate spend toward winning adsets/creative; pause any that fail KPI thresholds.
2. [Agency][Organic] Cadence audit — confirm 3x/week held across the full quarter; draft Month-4 steady-state calendar.
3. [Agency][Influencer] Finalize renew/expand decision for Month 4+ based on attribution data.
4. [Agency] Run `/before-after` against the Month-1 baseline snapshot.

### Week 13 (Oct 26–30)
1. [Agency] Produce full-funnel day-90 report: paid performance, organic cadence recovery, site/tracking milestones, influencer results — benchmarked against Islamic Relief's ~35 ads/month AT/DE pace.
2. [Agency] Compile quarter-end recap reel (organic) summarizing program impact stories.
3. [Agency] Prepare retainer review deck (Month 4+ scope, budget recommendation, next seasonal-appeal calendar).
4. [Client] Attend retainer review meeting; confirm Month 4+ scope and budget.

**Month 3 checkpoint:** creative iterated against real data, budgets scaled on qualifying winners only, influencer program measured and renewed/adjusted, full day-90 report delivered, retainer reviewed.

---

## 3. Dependency / Critical-Path Note

The riskiest sequencing risks in this plan, ranked by blast radius:

1. **Website delay cascades into every tracking- and conversion-dependent workstream.** Pixel/CAPI installation (Week 6), the first-ever conversion campaign (Week 7–8), and the entire Month 3 optimize/scale phase all sit downstream of the Astro site + donation landing page shipping in Week 6. If the rebuild slips past Week 6, the Month-1 awareness-only paid test cannot be upgraded to conversion objective, the audit's day-30/day-60 recommendations both slide by the same amount, and the day-90 report will lack sufficient conversion-campaign data to benchmark meaningfully against Islamic Relief. **Mitigation:** website scope is locked to a fixed page set (home, donate landing, 2–3 program pages, EN/DE) before Week 3 build start; no scope additions accepted mid-build without pushing the Pixel-install date in writing to the client.

2. **Verified-tracking gate being skipped under pressure to "hit day-30."** Because Month 1 intentionally runs pixel-free awareness ads to stay on the audit's original timeline, there's a real temptation to declare the conversion campaign "live" as soon as the site ships, without waiting for 3–5 days of clean Test Events data. Spending against unverified Donate events would replicate the exact failure mode the pre-audit flagged (measuring nothing) — just one campaign later. **Mitigation:** the Week 7 gate ("confirm 3-5+ consecutive days of clean event data before spend") is a hard fail-closed checkpoint in this plan, not a suggestion — the `capi-setup` guard and Meta Events Manager Test Events output are the sign-off artifact, not a verbal confirmation.

3. **Rebrand kit and Astro donation-page copy racing each other in Weeks 1–2.** The donation landing page wireframe (Week 2) and the visual rebrand kit (Week 2) are both due the same week and both gate downstream work (site build, social rollout, influencer co-branded content, ad creative). If either slips, it's tempting to let Astro dev proceed with placeholder branding "to save time" — but that produces a donation page that has to be re-skinned once the rebrand is approved, wasting dev hours and risking a visually inconsistent launch. **Mitigation:** rebrand direction (not full kit) is locked as a Week 1 deliverable specifically so Astro dev has real colors/type before Week 3 build start, even though the full applied kit (highlight covers, templates) isn't due until Week 2.
