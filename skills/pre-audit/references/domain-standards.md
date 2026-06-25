# pre-audit — Domain Standards

Embedded expertise for scoring an unsigned prospect from public data. Read this when
computing the score, classifying advertiser maturity, or writing wins/gaps/opportunities.
Self-contained — no other file needed to apply these rules.

---

## Weighted 0–100 Health Score

Five equally-weighted dimensions (20% each). Each dimension is scored 0–100, multiplied
by its weight (0.20), summed, rounded to an integer.

| # | Dimension | Weight | Source pass | Scored from |
|---|---|---|---|---|
| 1 | **Profile & Brand Presence** | 20% | FB Page + IG profile | profile pic present, bio/about filled, category set, verified badge, external link present, handle consistency across platforms |
| 2 | **Organic Content Quality** | 20% | IG/FB post timestamps + format mix | posts/week vs target ≥3/week; format diversity (Reels + Carousels + static); engagement rate vs benchmark |
| 3 | **Paid Ads Activity** | 20% | Meta Ad Library self-check | one of the three maturity buckets below; creative age distribution; survival-past-60d rate |
| 4 | **Competitor Position** | 20% | Competitor scan | outspend gap; creative score gap; share of voice in Ad Library |
| 5 | **Technical Foundation** | 20% | Website tracking surface | Pixel firing > GTM/Google Tag > GA4 > conversion events > responsive viewport |

> **Why equal weights?** The six-dimension weighted model over-penalised pixel absence
> (25%) while under-weighting organic presence. Equal weights produce a score that
> maps more honestly to actual channel health and avoids a single miss tanking an
> otherwise strong prospect.

When a dimension's source is `unverified` (blocked fetch, no niche file), score it as
*unknown* — surface it as a gap rather than silently assigning 0.

---

## Posting-Consistency Formula

```
posts_per_week = len(recent_timestamps) / max(span_days / 7, 1)
recency_days   = (audit_date - max(timestamps)) / 86400
score          = min(posts_per_week / 3.0, 1.0) * 100
```

Target is ≥ 3 posts/week (industry standard for maintained accounts). A hardcoded
"now" makes recency negative on back-dated runs — always pass the audit date.

### Organic content benchmarks (Socialinsider 2025)

| Format | Engagement Rate | Best for |
|---|---|---|
| Carousel | 0.55% | Engagement / saves / DMs |
| Reels | 0.32% | Reach / new-follower discovery |
| Static image | 0.27% | Feed aesthetics / branded moments |
| Stories | 0.06% | Retention / DMs |

Frame Carousels as the engagement driver and Reels as the reach/discovery driver —
they serve different goals and both should be present in a mature content mix.

---

## Outspend Ratio

```
outspend_ratio = max(competitor_monthly_spend) / max(prospect_monthly_spend, 1)
```

The headline number: "they're outspending you 8:1." `max(..., 1)` prevents a
divide-by-zero when the prospect runs no ads (greenfield).

---

## Advertiser-Maturity Buckets (Paid Ads dimension)

| Bucket | Signal | Sales posture | Score band |
|---|---|---|---|
| **Never run ads** (greenfield) | 0 ads ever in Ad Library | Easiest close — you build from scratch with no incumbent | 0–30 |
| **Running but losing** | Active ads, no conversion objective / poor format mix / no pixel / creative age < 14d | Replace the incumbent with a structured approach | 31–60 |
| **Running competently** | Active conversion ads, varied formats, pixel firing, ads surviving > 60d | Hardest sell — pitch must identify a precise gap, not generic improvement | 61–100 |

**Ad survival benchmark:** only 11.3% of ads survive past 60 days. Any prospect
with survival > 11.3% already has above-average creative discipline.

---

## Competitor Creative Matrix

Score each competitor's creative operation across five dimensions (each 0–10).
Average = Composite Creative Score. Surfaced in the competitor table in the report.

| Dimension | 0 = weak | 5 = average | 10 = strong | How to score |
|---|---|---|---|---|
| **Hook strength** | No clear hook; generic opener | Single hook, not tested | Multiple hook variants, pattern-interrupt present | Count distinct creative angles in active ads |
| **Visual strategy** | Stock photos only | Some branded visuals | Consistent branded system + UGC + motion | Format diversity + brand consistency scan |
| **CTA match** | No CTA / mismatched | Generic "Learn more" | CTA matches funnel stage (awareness vs conversion) | Read ad copy bodies in Ad Library |
| **Psychological trigger** | No trigger | Single trigger (FOMO or social proof) | Multiple triggers per ad, matched to audience | Ad copy analysis |
| **Run-duration score** | Avg age < 7d | Avg age 14–30d | Avg age > 60d (survival proxy) | `avg_creative_age_days / 6` capped at 10 |

> **Why this differentiates smOS pre-audits:** No agency currently produces a
> scored competitor creative matrix at the pre-sale stage (before any contract).
> Including this makes the report a genuinely novel artifact that prospects have
> not seen from other vendors.

---

## Synthesis Rules — Wins / Gaps / Opportunities

### Three-tier classification

Classify every win and gap into one of three tiers:

| Tier | Key | Meaning | Timeframe |
|---|---|---|---|
| Quick Win | `quick` | Can be fixed in days, high impact, low effort | Week 1–2 |
| Retainer Scope | `strategic` | Core deliverable of a paid engagement | Month 1–3 |
| Roadmap | `longterm` | Worth doing after the retainer is established | Month 3+ |

This maps directly to a services conversation: Quick Wins demonstrate competence,
Retainer Scope items justify the monthly fee, Roadmap items retain the client.

**Always produce at minimum 3 total wins and 3 total gaps.** More is acceptable if
the data supports them — but every item must trace to a captured field.

### Wins

What the prospect already does right. Mandatory for credibility — a report that is
100% criticism reads as a hard sell and gets ignored.

**Good win:** "Instagram is a verified Business account with a linked website and a
clear category — trust signals are already in place."

**Bad win:** "Nice logo." (Subjective, not derived from any captured signal.)

### Gaps

Highest-impact missing pieces, ordered by severity. Every gap should state:
1. What is missing (specific)
2. What the evidence is (the captured field)
3. The cost of inaction (what they're losing right now)

**Good gap:** "No Meta Pixel detected on the homepage (`fbq(` absent) while you run
6 active ads — every ad dollar is spent without measurement. Competitors average a
4.5:1 outspend advantage AND have full tracking."

**Bad gap:** "Your social media could be better." (No source, no number, not actionable.)

### Opportunities / Recommendations

Max 3. Ordered by impact-per-dollar. Each must have:
- `problem` — the headline issue
- `evidence` — the data point that proves it
- `action` — the specific proposed service or intervention
- `outcome` — the expected result with a benchmark or range

### Opportunity Sizing

Two methodologies — include both when prospect data is available:

**Bottom-up (from budget):**
Given monthly ad budget → estimate CPA at industry average ($38.19) → derive
expected acquisitions per month → extrapolate to quarterly revenue.

**Top-down (from revenue goal):**
Given revenue goal → work backward using target ROAS (1.86× DTC average) →
derive required ad spend → gap to current spend.

### Industry benchmarks (Meta, 2025)

| Metric | Value | Notes |
|---|---|---|
| Avg CPA | $38.19 | Cross-vertical average |
| DTC ROAS | 1.86× | Direct-to-consumer average |
| CPL | $27.66 | 60% cheaper than Google Ads ($70.11) |
| Carousel ER | 0.55% | Best engagement-rate format on Instagram |
| Ad survival > 60d | 11.3% | Only 11.3% of ads run past 60 days |

---

## Quality Bar

Every claim in the report must trace to a captured field in `page_audit.json`,
`competitor_summary.json`, or the tracking surface. If a field is `unverified`,
the report says so explicitly. No number appears in the HTML that is not in the
input JSON.

**Honesty guard (H1):** never present a category-level benchmark as if it were a
measured competitor figure. If competitor URLs could not be resolved, label the
outspend ratio "Category benchmark" in both the JSON and the rendered report.
