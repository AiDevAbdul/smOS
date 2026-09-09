# Listening — Domain Standards

Self-contained reference for the organic competitor-benchmark + social-listening
domain encoded in `/listening`. Embedded so the skill never has to rediscover
formulas or thresholds at runtime.

## 1. The organic-vs-ads split

| Surface | Owner skill | Source |
|---|---|---|
| Competitor **ads** (creatives, offers, spend signals) | `/research`, `/creative-intel` | Meta Ad Library (`ads_archive`) |
| Competitor **organic** (followers, growth, cadence, engagement, formats) | **`/listening`** | IG Business Discovery |
| Brand **tagged** mentions | **`/listening`** | IG `/tags` (tagged-only by construction) |
| Brand **untagged** mentions / keywords / hashtags | **`/listening`** | IG Hashtag Search, FB own-post comments, key-gated web index, optional 3rd-party export |
| **Share of voice**, **crisis detection** | **`/listening`** | Derived from the above + the per-client time series |

`/listening` is the organic complement. Never duplicate ads analysis here.

## 1b. The coverage discipline (E5)

Third-party listening tools imply full-web coverage. smOS has nothing like it, so every
number it produces is qualified:

1. **An unreached source is `null`, never `0`.** `0` means "we looked and found nothing".
   The snapshot schema now *rejects* a non-null count on a source whose status isn't
   `ok`/`partial`.
2. **Every total or share off a partial/truncated source is a FLOOR** and carries
   `is_floor: true` plus the `basis_platforms` it was computed over.
3. **Unreachable platforms are still listed** (TikTok, X, LinkedIn, YouTube, Reddit) so
   their absence cannot be read as silence.
4. **Missing data is removed from the denominator**, never scored as good news — the same
   rule `/crm health` follows.

## 1c. Tagged vs untagged

| | Definition | Why it matters |
|---|---|---|
| **Tagged** | The client's IG account was @-tagged (or the source is tagged-only) | Attributable by construction; the easy half, and the only half IG `/tags` can see |
| **Untagged** | Surfaced by a keyword / hashtag / web query | Where real reputation lives. Attributable **only** when a `brand_terms` entry appears in the text — otherwise it counts toward a competitor, not the client |

This is why `brand_terms` is the load-bearing watchlist field: with none, the client's own
share of voice is `null`, not 0.

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

**Classifying (G8):** the script itself never runs a model call — like the rest of
the engine (`video_scoring.js`, etc.), judgment stays with the agent running the
skill. To classify: after a run reports `N mention(s) still need a sentiment
judgment`, read each pending mention's text, decide `positive`/`neutral`/`negative`,
and write `{ "<mention.url>": "<verdict>", ... }` to
`clients/{slug}/listening_capture.json`'s `sentiment_judgments` key (or an array of
`{id, sentiment}` with `id` = the mention's `url`). Re-run `/listening` — the merge
via `scripts/lib/sentiment.js` is fail-closed (an unrecognized value collapses to
`null`) and never overwrites a sentiment already set.

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

## 5. Crisis detection (encoded in `scripts/lib/listening_depth.js`)

Rule-based, no model call. Three weighted signals, each scored **only when its own data
exists**; a missing signal leaves the denominator, it does not score zero.

| Signal | Weight | Score 1.0 | Score 0.5 | Data needed |
|---|---|---|---|---|
| `volume_spike` | 3 | ≥3× the rolling baseline mean (or ≥3 mentions against a flat-zero baseline) | ≥2× | current volume + a sufficient baseline |
| `negative_skew` | 3 | ≥50% of classified mentions negative | ≥30% | ≥5 mentions with a sentiment verdict |
| `velocity` | 2 | delta ≥ 2σ of the baseline | doubled vs the prior point | a comparable preceding point |

- **Volume** is the **brand-attributable** mention count, not every matched mention.
- **Baseline** = trailing `--baseline-window` (default 14) points, prior points only —
  the current capture is appended *after* detection so it cannot inflate its own baseline.
- **Minimum baseline: `MIN_BASELINE_POINTS` = 5.** Fewer ⇒ `severity: null`,
  `status: "insufficient_data"`. Crisis never fires off one datapoint.
- A **zero baseline yields no ratio** — undefined, not infinite.
- `score` = Σ(score × weight) / Σ(weight of scored signals).
  `confidence` = scored weight / total weight (8).

| `score` | `severity` |
|---|---|
| ≥ 0.75 | `critical` |
| ≥ 0.50 | `elevated` |
| > 0 | `watch` |
| 0 | `none` |

`severity_provisional: true` when `confidence < 0.5` — a hint, not a finding.
`requires_human: true` on `elevated`/`critical`: smOS surfaces evidence and **never**
auto-replies, auto-pauses, or auto-posts in response to a crisis signal.

## Keeping current

- Engagement/cadence bands are advisory benchmarks; revisit if IG norms shift.
- Crisis weights/bands are heuristics, not statistics — tune per client only with a
  recorded reason, and keep §5 and `listening_depth.js` in lockstep.
- If IG deprecates a Business Discovery field or `/tags`, update `api-reference.md`
  and the formula table here together.
- **Last verified:** 2026-06-22
