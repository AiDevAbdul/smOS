# Listening — Domain Standards

Self-contained reference for the organic competitor-benchmark + social-listening
domain encoded in `/listening`. Embedded so the skill never has to rediscover
formulas or thresholds at runtime.

## 1. The organic-vs-ads split

| Surface | Owner skill | Source |
|---|---|---|
| Competitor **ads** (creatives, offers, spend signals) | `/research`, `/creative-intel` | Meta Ad Library (`ads_archive`) |
| Competitor **organic** (followers, growth, cadence, engagement, formats) | **`/listening`** | IG Business Discovery |
| Brand **mentions / keywords / sentiment** | **`/listening`** | IG `/tags`, optional 3rd-party export |

`/listening` is the organic complement. Never duplicate ads analysis here.

## 2. Benchmark formulas (encoded in `scripts/lib/organic_bench.js`)

Computed from a competitor's recent media (up to 20 posts via Business Discovery).

| Metric | Formula | Notes |
|---|---|---|
| `engagement_rate` (%) | `avg(like_count + comments_count) / followers * 100`, 2 dp | `null` when followers unknown/0 |
| `posts_per_week` | `media.length / weeks_spanned`, 1 dp; `weeks = (latest_ts - earliest_ts)/(7·86400000)` | `null` when <2 timestamped posts or zero span |
| `top_formats` | two most frequent `media_type` (uppercased), by count | e.g. `["IMAGE","REELS"]`; `[]` when no media |
| `follower_growth_30d` | NOT live-derivable from one snapshot | `null` unless supplied in capture; trend is computed downstream by stacking snapshots |

`benchmarkFromMedia([], n)` returns `{}` — an empty-media competitor yields a stub
(handle + platform only), not zeros.

## 3. Engagement-rate interpretation bands (IG, organic)

Reference bands for narrative only — the skill stores the raw number, it does not
gate on these. Use when summarizing a snapshot for the brief.

| Band | engagement_rate | Read |
|---|---|---|
| Low | < 1.0% | Audience may be inflated / disengaged |
| Healthy | 1.0% – 3.5% | Typical for established business accounts |
| Strong | 3.5% – 6.0% | Above-average resonance |
| Exceptional | > 6.0% | Verify (small follower base inflates the ratio) |

Smaller accounts naturally show higher rates; always pair the rate with `followers`.

## 4. Posting-cadence reference

| Cadence (posts/week) | Read |
|---|---|
| < 2 | Under-posting; low share-of-voice |
| 3 – 5 | Standard organic cadence |
| 7 – 14 | High cadence (often Reels-led) |
| > 14 | Aggressive; check for low-effort/duplicate content |

## 5. Sentiment taxonomy (mentions)

Only three values are ever stored in `mention.sentiment`:

| Value | When |
|---|---|
| `positive` | Praise, recommendation, satisfaction |
| `neutral` | Factual mention, question, tag with no clear valence |
| `negative` | Complaint, criticism, warning to others |
| `null` | Not classified (no NLP applied this run) |

Never invent a sentiment to fill the field — `null` is the honest default.

## 6. Honesty rules (load-bearing)

- A metric that cannot be retrieved is `null`. Never substitute `0` for "unknown".
  (`followers` is the one exception: the normalizer coerces missing followers to `0`
  because Business Discovery returns a real count or the handle stubs out.)
- A handle that errors becomes a stub `{handle, platform}` — the snapshot still
  validates as long as ≥1 competitor has a handle or ≥1 mention exists.
- Append-only: every run is a new row. Trends come from comparing snapshots over
  time, never from mutating an old one.

## 7. Good vs bad capture

**Good — measured competitor:**
```json
{ "handle": "rivalbrand", "platform": "instagram", "followers": 48200,
  "follower_growth_30d": null, "posts_per_week": 4.3,
  "engagement_rate": 2.81, "top_formats": ["REELS","IMAGE"] }
```
Followers + real metrics present; growth honestly `null` (not derivable from one pull).

**Good — honest stub (private/typo handle):**
```json
{ "handle": "rivalbrand", "platform": "instagram", "followers": 0,
  "follower_growth_30d": null, "posts_per_week": null,
  "engagement_rate": null, "top_formats": [] }
```

**Bad — invented numbers:**
```json
{ "handle": "rivalbrand", "followers": 50000, "engagement_rate": 3.0,
  "posts_per_week": 5, "follower_growth_30d": 1200 }
```
Round numbers with no API source and a fabricated 30d growth — forbidden.

## Keeping current

- Engagement/cadence bands are advisory benchmarks; revisit if IG norms shift.
- If IG deprecates a Business Discovery field or `/tags`, update `api-reference.md`
  and the formula table here together.
- **Last verified:** 2026-06-22
