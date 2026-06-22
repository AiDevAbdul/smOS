# pre-audit — Domain Standards

Embedded expertise for scoring an unsigned prospect from public data. Read this when
computing the score, classifying advertiser maturity, or writing wins/gaps/opportunities.
Self-contained — no other file needed to apply these rules.

## Weighted 0–100 Health Score

Six dimensions; weights sum to 100. Each dimension is scored 0–1, multiplied by its
weight, summed, rounded to an integer.

| Dimension | Weight | Source pass | Scored from |
|---|---|---|---|
| Page completeness | 15% | FB+IG page audit | profile pic, bio/about, category, verified badge, link present |
| Posting consistency | 10% | IG/FB timestamps | posts/week vs **target 3/week** (≥3 = 1.0; linear below) |
| Ad maturity | 20% | Ad Library self-check | one of the three buckets below |
| Outspend gap (inverse) | 15% | Competitor scan | closer to top competitor spend = higher; `1 / max(outspend_ratio, 1)` capped |
| Pixel + tracking | 25% | Website surface | Pixel firing > GTM/Google Tag > GA4 > conversion events > responsive viewport |
| Niche playbook alignment | 15% | Niche sweep vs self | using category hooks/CTAs/formats? (skipped → score as unknown, redistribute or flag) |

Tracking is the **heaviest** weight (25%) because a missing pixel on an advertiser is the
single strongest sales angle: they are spending blind.

When a dimension's source is `unverified` (blocked fetch, no niche file), score it as
*unknown* — surface it as a gap in the report rather than silently assigning 0, which would
unfairly tank an otherwise healthy prospect.

## Posting-consistency formula

```
posts_per_week = len(recent_timestamps) / max(span_days / 7, 1)
recency_days   = (audit_date - max(timestamps)) / 86400   # audit_date, NEVER a hardcoded epoch
score          = min(posts_per_week / 3.0, 1.0)
```

A hardcoded "now" makes recency negative on back-dated runs — always pass the audit's
current date.

## Outspend ratio

```
outspend_ratio = max(competitor_monthly_spend) / max(prospect_monthly_spend, 1)
```

This is the headline number: "they're outspending you 8:1." `max(..., 1)` prevents a
divide-by-zero when the prospect runs no ads (greenfield).

## Advertiser-maturity buckets (Ad Maturity dimension)

| Bucket | Signal | Sales posture | Score band |
|---|---|---|---|
| **Never run ads** (greenfield) | 0 ads ever in Ad Library | Easiest win — you build from scratch | low maturity, high opportunity |
| **Running but losing** | Active ads, no conversion objective / poor format mix / no pixel | You replace the incumbent | mid |
| **Running competently** | Active conversion ads, varied formats, pixel firing | Hardest sell — need a precise gap pitch | high maturity, lower opportunity headroom |

## Synthesis rules — wins / gaps / opportunities

Always produce exactly **three** of each.

- **Top 3 wins** — what they already do right. Mandatory for credibility; a report that is
  100% criticism reads as a hard sell and gets ignored. Examples: "Verified Page",
  "Posting 4×/week consistently", "GA4 correctly installed".
- **Top 3 gaps** — highest-impact missing pieces, ordered by severity. Examples: "No Meta
  Pixel — every ad dollar is unmeasured", "0 active ads while 3 competitors run 40+",
  "Bio has no link / CTA".
- **Top 3 opportunities** — concrete actions ordered by impact-per-dollar, each with a
  `title`, `impact`, and `effort`. Examples: "Install pixel + CAPI (high impact / low
  effort)", "Launch a $50/day conversion test against competitor angles".

## Good vs Bad examples

**Good gap (specific, sourced, actionable):**
> "No Meta Pixel detected on the homepage (`fbq(` absent) while you run 6 active ads — you
> cannot optimize for purchases or build retargeting audiences. Competitors average 4.5:1
> outspend with full tracking."

**Bad gap (vague, unsourced, fabricated):**
> "Your social media could be better and you should post more often." (No source, no number,
> not actionable — and "post more" may be false if posting was `unverified`.)

**Good win:** "Instagram is a verified Business account with a linked website and a clear
category — trust signals are already in place."

**Bad win:** "Nice logo." (Subjective, not derived from any captured signal.)

## Quality bar

Every claim in the report must trace to a captured field in `page_audit.json`,
`competitor_summary.json`, or the tracking surface. If a field is `unverified`, the report
says so explicitly. No number appears in the HTML that is not in the input JSON.
