# Pre-Audit Report: Research Reference

> Research conducted: 2026-06-24. Use this as the design and content brief for the
> `/pre-audit` skill and `pre_audit_report.py` template. Update when benchmarks shift
> or new differentiators are identified.

---

## What This Document Is

Synthesised research from two parallel investigations:
1. **Content & Structure** — what sections should appear, what data populates them, and why each one closes deals.
2. **Design & Format** — visual system, layout, typography, colour psychology, and interaction patterns for a premium agency pitch report.

---

## Context

**Agency offering:** Facebook Ads management, Instagram Ads management, Social Media
Management (organic content + community management). No other services.

**Report purpose:** Pre-sale pitch artifact. Produced from public data only — no client
Meta API access. Goal: impress the prospect, demonstrate expertise, and close the deal.
Often the first substantive thing a prospect sees from the agency.

---

## Part 1: Content & Structure

### The 9-Section Report (sequence is load-bearing)

The order produces an emotional arc: **recognition → clarity → relief**. The prospect
sees themselves in the data, understands what is broken, and leaves believing the agency
can fix it.

| # | Section | Core data | Sales function |
|---|---|---|---|
| 1 | **Cover + Composite Score** | 0–100 gauge, business name, date | Anchors the conversation; the score is the hook before a word is read |
| 2 | **Score Breakdown** | Five dimension sub-scores | Explains *why* the score is what it is |
| 3 | **Profile & Brand Presence** | FB Page + IG profile public stats | "We already know your account" — builds credibility without access |
| 4 | **Organic Content Analysis** | Post frequency, format mix, ER vs benchmark | Sells the organic management retainer |
| 5 | **Paid Ads Analysis** | Ad Library: active/inactive count, run duration, formats | Sells ads management; run duration exposes whether ads are working |
| 6 | **Competitor Intelligence** | Named competitors + creative matrix | Highest-converting section — urgency without manufactured scarcity |
| 7 | **Wins & Gaps** | Three-tier classification | Converts problems into a services menu; mentally pre-prices the engagement |
| 8 | **Opportunity Sizing** | Industry benchmarks + prospect projections | Makes the decision feel financially rational, not a cost |
| 9 | **Recommendations + Next Steps** | Max 3 recs + 30/60/90 plan + CTA | Converts the document from analysis into a proposal |

---

### Section Detail

#### 1. Cover + Composite Score

The 0–100 composite score **must appear before any other content**. It is the single
highest-converting structural element in agency pitch reports. It anchors the entire
conversation — the prospect discusses the report in terms of the score ("our 38 vs.
their 78") not in terms of individual findings.

Score bands:
- 0–39: Critical
- 40–64: At Risk
- 65–84: Developing
- 85–100: Optimized

#### 2. Score Breakdown

Five equal dimensions (20% each). Equal weights replaced the earlier six-dimension model
(15/10/20/15/25/15) because the old model over-penalised pixel absence and under-weighted
organic. Equal weights produce a more honest mapping to actual channel health.

| Dimension | What it measures |
|---|---|
| Profile & Brand Presence /20 | FB/IG completeness, trust signals |
| Organic Content Quality /20 | Post frequency, format mix, ER |
| Paid Ads Activity /20 | Ad Library maturity bucket |
| Competitor Position /20 | Outspend gap, creative gap |
| Technical Foundation /20 | Pixel, GTM, GA4, conversion events |

#### 3. Profile & Brand Presence

All from public data:
- Facebook Page Transparency (page creation date, category, likes)
- Instagram public profile (followers, bio, handle, link-in-bio)
- Handle consistency across platforms (same name = brand coherence signal)

Signals "we already know your account" before they've given you access.

#### 4. Organic Content Analysis

**What to show:**
- Posts/week vs target (≥3/week is the industry standard)
- Engagement rate vs 0.55% carousel benchmark (Socialinsider 2025)
- Format mix (Reels vs Carousels vs Static vs Stories)
- Top-performing format identification

**Key insight to communicate:**
- Carousels = 0.55% ER → best for engagement, saves, DMs
- Reels = 0.32% ER but far greater reach → best for discovery/new followers
- These are different goals — frame accordingly, both should be present

**Sales angle:** Most SMBs post inconsistently, ignore format strategy, and don't know
their ER vs benchmark. Showing the benchmark gap is enough to justify organic management.

#### 5. Paid Ads Analysis

**Source:** Meta Ad Library (public, no token required).
As of January 2026, impression range buckets are available for ALL commercial advertisers.

**Key data points:**
- Active/inactive ad count (last 90 days)
- Run duration distribution — the best public performance proxy
  - Only 11.3% of ads survive past 60 days
  - If a prospect has ads surviving past 60d, they have above-average creative discipline
- Creative formats used (image vs video vs carousel)
- If they're not running ads: show how many named competitors are

**Sales angle:** Run duration exposes whether ads are actually performing. A prospect
running 20 ads but none surviving past 7 days is essentially burning money.

#### 6. Competitor Intelligence

**The highest-converting section.** Shows a side-by-side score (Prospect: 41 / Competitor: 78)
with named local competitors. Creates urgency without manufactured scarcity — the data
does the work.

**Standard competitor table columns:**
- Active ads (90d)
- New ads (14d) — pace indicator
- Average creative age — performance proxy
- Format mix — creative sophistication signal
- Creative Score — the differentiator (see below)

**Competitor Creative Matrix (smOS differentiator):**
No agency currently produces a scored creative matrix at the pre-sale stage. This is a
genuine market gap. Score each competitor's creative operation 0–10 on:

| Dimension | Scoring method |
|---|---|
| Hook strength | Count distinct creative angles in active ads |
| Visual strategy | Format diversity + brand consistency |
| CTA match | CTA vs funnel stage alignment (read ad copy bodies) |
| Psychological trigger | FOMO / social proof / authority / scarcity in copy |
| Run-duration proxy | avg_creative_age_days / 6, capped at 10 |

Composite = average of five. Shown in report as a single score with color coding.

#### 7. Wins & Gaps

**Three-tier classification** maps directly to a services conversation:

| Tier | Meaning | Services mapping |
|---|---|---|
| Quick Wins | Fix in days, high impact, low effort | Demonstrates immediate competence |
| Retainer Scope | Core deliverable of a paid engagement | Justifies the monthly fee |
| Roadmap | Worth doing after retainer is established | Creates long-term client retention |

**Rules:**
- Every gap is reframed as an opportunity with cost of inaction — never a criticism
- At minimum 3 wins + 3 gaps, each traceable to a captured data field
- Wins are mandatory — a 100% criticism report reads as a hard sell

#### 8. Opportunity Sizing

**Two methodologies:**

*Bottom-up (from budget):*
Budget → CPA at $38.19 avg → expected acquisitions/month → quarterly revenue projection

*Top-down (from revenue goal):*
Revenue goal → required ROAS (1.86× DTC avg) → required ad spend → gap to current spend

**Industry benchmarks (Meta 2025):**
- CPA: $38.19
- DTC ROAS: 1.86×
- CPL: $27.66 (vs Google $70.11 — 60% cheaper framing is powerful)
- Carousel ER: 0.55%
- Ad survival >60d: 11.3%

**The organic + paid flywheel framing** is the primary upsell for bundling both retainers:
organic content warms the audience → paid retargeting converts them → paid prospecting
feeds the organic community. Show this cycle explicitly.

#### 9. Recommendations + Next Steps

**Recommendations:** Max 3. More creates paralysis. Structure:
Problem → Evidence → Proposed action → Expected outcome

**30/60/90 plan:** Shows a concrete onboarding arc. Answers the implicit question
"what does working together actually look like?" before they have to ask.

**CTA:** One button, one ask. No multiple CTAs ("book a call OR download the report OR
schedule a demo") — multiple options dilute commitment. Pricing comes last, always
after the revenue gap has been established.

---

### Public Data Sources

All these are available without client API access:

| Source | What it provides |
|---|---|
| Facebook Page Transparency | Page creation date, category, ad activity, page likes |
| Meta Ad Library | All active/inactive ads, run duration, formats, impression ranges (since Jan 2026) |
| Instagram public profile | Follower count, post frequency, ER, bio quality |
| Facebook Pixel Helper (Chrome extension) | Pixel presence and basic firing |
| SimilarWeb / Semrush free tier | Website traffic estimate, traffic sources |
| Google search | Review count/rating, GMB presence, press mentions |

---

## Part 2: Design & Format Specification

### Emotional Arc

The layout is engineered to produce: **recognition → clarity → relief.**

The prospect sees themselves in the data (recognition), understands what is broken and
why (clarity), and leaves believing someone competent can fix it (relief). Every visual
decision serves this arc, not brand aesthetics.

### Color Palette

Semantic, not decorative. Two signal colors used only for their meaning:

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#1A1A24` | Near-black with blue-violet lean; chosen, not defaulted |
| `--ground` | `#F7F6F2` | Warm stone off-white; reads as paper, not a blank screen |
| `--signal` | `#C8402A` | Brick red; "flag this" — used only for genuine problems |
| `--resolve` | `#2A6B5C` | Deep teal-green; "we can fix this" — used only for wins/opportunities |
| `--rule` | `#E2E0D8` | Warm mid-tone; dividers, card borders, chart track |
| `--muted` | `#6B6860` | Secondary text, labels |
| `--amber` | `#D4860A` | Warning / developing — between signal and resolve |

**Why this palette works for pitch reports:**
- Signal red appears only for genuine problems, never as decoration. A client can scan
  and know where the problems are without reading a legend.
- Resolve green appears only for confirmed strengths and opportunities. It is the color
  of the agency's value proposition.
- The warm ground avoids clinical distance — relevant when the message is difficult news.
- Avoiding pure black and pure white makes the report feel crafted, not templated.

### Typography

| Role | Font | Why |
|---|---|---|
| Display headers | `DM Serif Display` | Editorial authority; high contrast at large scale |
| Body | `DM Sans` | Same design-family root; coheres without matching |
| Numbers / labels / scores | `JetBrains Mono` | Signals precision; tabular numerics stay aligned |

**Scale:** Display (32–42px) → Section headings (25px) → Body (15px) → Labels (9–11px mono)

No improvised sizes. Consistent scale = premium feel.

### Layout

**Single scroll, sticky left-rail navigation.** The rail is narrow (168px), carries section
labels and active-dot marker. The content column is constrained (~680px) so reading lines
stay at ~65 characters.

The rail collapses on mobile (< 720px). The report remains fully readable without it.

**Print:** The rail hides via `@media print`. Canvas elements render as bitmaps in
Playwright headless Chromium. Dark sections print with `print-color-adjust: exact`.

### Section Scroll Order

1. **Hero + overall score** — the gauge leads, not agency branding. Prospect sees their
   score before anything else.
2. **Score breakdown** — explains the score.
3. **Profile & Brand** — infrastructure before performance.
4. **Organic** — content strategy gap.
5. **Paid Ads** — ad operation assessment.
6. **Competitors** — urgency through comparison.
7. **Wins & Gaps** — optimism begins here; agency voice appears in first person.
8. **Opportunity** — makes the financial case.
9. **Recommendations** — the agency's thinking made visible.
10. **CTA** — dark background switches register; analysis is over; here is what to do.

This is deliberately not "data first" — it is **structured revelation**.

### Score Visualization

**Canvas-based radial arc gauge** (160×160px, animated on load):
- Arc spans 270° (0.75π to 2.25π) — open at the bottom
- Track: `--rule` color, 13px stroke, round caps
- Fill animates from 0 to final value over ~45 frames
- Color: signal red < 40, amber 40–64, resolve green ≥ 65
- Score number inside arc in JetBrains Mono bold; `/100` in DM Sans below

No letter grades, no traffic lights — the arc communicates position on a continuous scale
intuitively without a legend.

### Key Visualization Types per Section

| Section | Visualization | Rationale |
|---|---|---|
| Overall score | Large radial gauge, animated | Hero-level impact; leads with the verdict |
| Score breakdown | Table with inline 5px bar tracks | 5 elements in parallel — a table is right |
| Profile stats | 2-col stat cards with caption | Small dataset; cards give breathing room |
| Organic | Stat cards + format table | Number + context pairs |
| Paid | 4-card grid + tracking list | Multiple metrics best in card grid |
| Competitors | Table with color-coded Creative Score | Bar length communicates gap; score colors code quality |
| Wins & Gaps | 2-col cards with ✓/✗ bullet lists | Visual contrast does the emotional work |
| Opportunity | Benchmark table + projection cards | Benchmarks need a table; projections need side-by-side |
| Recommendations | Numbered cards (large dim numbers) | Sequence is load-bearing (ranked by impact) |
| CTA | Dark background, timeline + single button | Register change signals "analysis is over" |

### Data Density vs. Readability

**Rule:** one insight per visual element, labeled for a non-technical reader.

- The CAPI row says "~40% of conversions invisible" — not "server-side event match rate: 0%"
- The frequency card shows "1.2/wk" with "Target ≥ 3/week" directly beneath — no glossary
- Numbers that require interpretation always appear with a benchmark or target alongside them

### CTA Design

**Single register switch:** full `--ink` background signals the analysis is over.
Three timeline rows answer "what does working together look like?" concisely.
One CTA button (signal red). One ask. Sub-copy removes friction ("30 minutes · no commitment").

No multiple CTAs. Pitch documents that offer multiple next steps dilute commitment.

### PDF Export

- HTML is single-scroll with no JS-dependent layout — renders correctly in Playwright
  headless Chromium in DOM order
- `@media print` hides the sticky rail, removes shadows, adds `break-inside: avoid` to cards
- Canvas elements render as static bitmaps
- Dark sections use `print-color-adjust: exact` so they print with background colour

---

## Key Differentiators Built Into This Report

1. **Competitor Creative Matrix** — scored 0–10 on 5 dimensions at the pre-sale stage.
   No agency in current practice does this before a contract. It is a genuine market gap.

2. **Three-tier Wins/Gaps** (Quick Win / Retainer Scope / Roadmap) — maps directly to
   a services conversation and pre-prices the engagement mentally.

3. **Opportunity Sizing with benchmarks** — anchors the decision in financials, not
   in "your social media needs work."

4. **Structured emotional arc in layout** — the page is engineered to produce recognition,
   clarity, and relief in that order. Not just a data dump.

---

## Implementation Notes

- Template: `scripts/meta-ad-library/pre_audit_report.py`
- Skill: `skills/pre-audit/SKILL.md`
- Standards: `skills/pre-audit/references/domain-standards.md`
- Schema: `skills/pre-audit/references/io-contract.md`
- PDF: `scripts/render_pdf.py` (Playwright headless Chromium)

**New optional fields in `synthesis.json`** (backward compatible — template falls back
gracefully to `wins` / `gaps` / `opportunities` if tiers/recommendations absent):
- `wins_tiers.quick` / `wins_tiers.strategic` / `wins_tiers.longterm`
- `gaps_tiers.quick` / `gaps_tiers.strategic` / `gaps_tiers.longterm`
- `recommendations[]` with `problem`, `evidence`, `action`, `outcome`
- `opportunity_sizing.bottom_up{}` / `opportunity_sizing.top_down{}`
- `next_steps.day_30` / `.day_60` / `.day_90`

**New optional fields in `competitor_summary.json`** per competitor:
- `creative_matrix.hook_strength` (0–10)
- `creative_matrix.visual_strategy` (0–10)
- `creative_matrix.cta_match` (0–10)
- `creative_matrix.psychological_trigger` (0–10)
- `creative_matrix.run_duration_score` (0–10)

**New optional fields in `page_audit.json` → `instagram`:**
- `engagement_rate` (float, e.g. 0.55 for 0.55%)
- `format_mix` (dict of format → count)
- `survival_past_60d_pct` (float) — in `competitor_summary.self`
