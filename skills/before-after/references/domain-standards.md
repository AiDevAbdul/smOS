# before-after — Domain Standards

Embedded expertise for the before/after deliverable: formulas, direction rules, taxonomies, and worked good/bad examples. Readable standalone — no other file required.

## 1. The comparison metrics (10 rows)

| Row | Baseline field | Current source | Good direction |
|-----|----------------|----------------|----------------|
| Facebook followers | `facebook.followers` | Page `fan_count` | up |
| Instagram followers | `instagram.followers` | IG `followers_count` | up |
| Avg engagement rate (%) | `facebook.engagement_rate_30d` | FB 30d eng/impressions | up |
| Posts per week | `facebook.posts_per_week_30d` | FB posts/(30/7) | up |
| Content quality score (/10) | `creative_quality.score_out_of_10` | `/audit-creative` re-run (else "—") | up |
| Page completeness (%) | `facebook.page_completeness_pct` | 9-field checklist | up |
| Monthly ad spend ($) | `paid.monthly_ad_spend` | Account insights `spend` | context (more spend = more activity) |
| Cost per lead ($) | `paid.cost_per_lead` | spend/leads | **down (inverted)** |
| ROAS | `paid.roas` | `purchase_roas` or revenue/spend | up |
| Pixel events / mo | `paid.pixel_events_per_month` | `{pixel}/stats` summed | up |

## 2. Formulas (exact — do not round differently)

- **Change:** `change = current - baseline`, rounded to 2 dp.
- **Percent:** `pct = (change / baseline) × 100`, rounded to 1 dp.
- **Baseline = 0:** report `direction = "new"`, `pct = null`, render `↑ new (<current>)` when current > 0; `—` when current is also 0.
- **Null guard:** if baseline OR current is `null`, the metric is `direction:"new"`, arrow `—`, color `neutral` — render "—". Never coerce null to 0.
- **FB engagement rate:** `Σ(reactions+comments+shares) / Σ(post_impressions) × 100` over last-30d posts.
- **IG engagement rate:** mean over media of `(likes+comments)/reach × 100`.
- **Posts/week:** `posts_30d / (30/7)`, 1 dp.
- **Page completeness:** count of present fields among `{name, about, category, website, phone, emails, location, picture, cover}` ÷ 9 × 100.

## 3. Direction & color taxonomy

| `direction` | Meaning | `color` when good-direction | `color` when wrong-direction |
|-------------|---------|------------------------------|------------------------------|
| `up` | current > baseline | green | red |
| `down` | current < baseline | green (if inverted-good) | red |
| `flat` | no change | neutral | neutral |
| `new` | baseline 0/null | green (if current>0) | neutral |

**Inverted-good metrics** (lower is better): `cost_per_lead`. The JS passes `{invertGood:true}` for CPL. Extend this set for CPA, CPM, frequency if those rows are ever added — never treat a cost drop as red.

Arrow glyphs: `↑` up, `↓` down, `—` flat/new/missing.

## 4. Headline rules

Two sentences max, generated from real deltas:

> In {days} days since the {baseline_date} baseline, {client} grew Facebook followers by +X%, lifted engagement +Y%, drove ${spend}/mo in measurable ad performance at $Z CPL.

- Include a clause only when its delta exists (`pct != null` for followers/engagement; `spend > 0` for paid).
- Append the CPL clause only when `cost_per_lead` is non-null.
- **Fallback** (no wins computable): "{client} is collecting baseline data — full comparison available next cycle."

## 5. Good vs bad

**Good** — CPL fell from $42 to $28:
`Cost per lead | $42.00 | $28.00 | ↓ -14 (-33.3%)` rendered **green** (inverted-good).

**Bad** — same drop shown red because inverted-good was ignored. CPL going down is a win; red signals failure to the client. Always pass `invertGood` for cost metrics.

**Good** — IG had 0 followers at baseline:
`Instagram followers | 0 | 1,240 | ↑ new (1240)` — direction "new", no fake percent.

**Bad** — computing `(1240-0)/0 × 100` → Infinity/NaN leaking into the report. Guard baseline 0 first.

**Bad** — baseline missing the pixel, current shows 8,400 events, report claims "+8400 (+∞%)". Correct: render "new" or "—" with the note "pixel not connected at baseline".

## 6. Immutability doctrine

The baseline is the single source of "before". If it looks stale, the fix is **re-run `/audit`** to capture and lock a fresh one — never overwrite or hand-edit `baseline_snapshot.json` from this skill. `/before-after` validates `immutable_locked_at` is set and refuses (exit 4) otherwise, so the "before" can never be retroactively flattered.
