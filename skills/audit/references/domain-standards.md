# /audit — Domain Standards

The embedded expertise the audit encodes: scoring weights, taxonomies, formulas, thresholds, and worked good/bad examples. Read this when you need to explain a score, set a benchmark, or judge whether an audit result looks right. All of this is implemented in `skills/audit/audit.js` — this file is the human-readable spec.

## Health score — weights & formula

`computeHealthScore(data)` returns `round(Σ component × weight)`, 0–100.

| Component | Weight | Source value | Mapping |
|-----------|--------|--------------|---------|
| Page completeness | 15% | `organic.facebook.page_completeness` | already 0–100 |
| Pixel health | 20% | `paid.pixel_health` | `full`=100, `partial`=60, `none`=0 |
| Audience health | 15% | `healthy / total × 100` | 0 if no audiences |
| Naming compliance | 10% | `paid.naming_compliance_pct` | already 0–100 |
| Posting consistency | 10% | `posts_per_week / 3 × 100`, capped 100 | target = 3 posts/week |
| Engagement rate | 15% | `avg_engagement_rate / 3 × 100`, capped 100 | 3% ER = 100 |
| Financial health | 15% | `account_status` | `1` (ACTIVE)=100, else 50 |

Skipped passes contribute their default (e.g. no paid → pixel/audience/naming/financial degrade), which correctly pulls down the score for an unmanaged or first-time-advertiser account.

## Page completeness (0–100)

Nine equally-weighted boolean checks: name, about, category, website, phone, email, address (`location`), profile picture (`picture.data.url`), cover photo (`cover.source`). Score = `set / 9 × 100`. The per-field ✓/✗ table is rendered into the report.

## Naming compliance

Regex: `^[A-Z]+_[A-Z0-9]+_\d{6}$` — matches `[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM]` (e.g. `CONV_LAL1PCT_202506`). Compliance % = matching campaigns / total campaigns. This is the SAME pattern the `naming-check` guard enforces at create-time; the audit measures historical debt.

## Pixel-health taxonomy (`classifyPixelHealth`)

| Class | Condition |
|-------|-----------|
| `none` | No stats, error, skipped, or zero events with count > 0 |
| `partial` | PageView firing but no conversion event (or conversion-only) |
| `full` | Both a PageView AND a conversion event (`Purchase`/`Lead`/`Subscribe`/`CompleteRegistration`) firing |

## Audience-health taxonomy

A custom audience is **healthy** iff `operation_status.code === 200`. Anything else (e.g. 433 = "too small to be used") is **broken/stale**. Up to 10 problem audiences are listed by `name (description)`.

## Zombie campaigns

`effective_status === "ACTIVE"` AND (no insights OR `impressions === 0`) over the lifetime window — running but not delivering. Burns budget review attention; surface the count.

## Format-mix detection

**Facebook** buckets each post by `attachments[0].media_type` (fallback `status_type`): video, carousel (`album`), image (`photo`), link, status, other. **Instagram** buckets by `media_product_type` (fallback `media_type`): reel, carousel, video, image. Output is % of posts per format.

## Engagement-rate formulas

- **Facebook ER** = `(reactions + comments + shares) / impressions`, summed across posts → account-level %.
- **Instagram ER** = mean per-post `(likes + comments) / reach`. (Reach, not impressions — IG `impressions` is deprecated; see `api-reference.md`.)
- **Benchmark:** 3% ER scores 100 on the health component. Sub-1% is weak, 1–2% typical, >3% strong for FB/IG organic.

## Windows

- FB posts: last **60 days** (`posts_per_week` divides by 60/7).
- FB page insights: last **90 days** (follower delta = `page_fan_adds − page_fan_removes`).
- IG media: last **60 days**; IG insights: last **28 days**.
- Pixel stats: last **7 days**.
- Campaigns: `date_preset: lifetime`; best CPA/ROAS only counted when `spend > $50` (significance floor).

## Baseline locking

The snapshot locks (`immutable_locked_at` set) ONLY when FB returned without error AND `avg_engagement_rate` is finite — i.e. real engagement was captured. An unlocked snapshot makes `/before-after` refuse to run. An existing `baseline_snapshot.json` is NEVER overwritten — re-running audit with real Meta access is the only way to upgrade an unlocked baseline, and it must be done by deleting nothing (delete is an absolute block; instead capture a fresh client or fix access).

## Good vs bad audit output

**Good:** "Health 72/100. Win: 4.1% FB ER beats the 3% benchmark. Issue: pixel `partial` — PageView fires but no Purchase event (20% weight lost). Next: install Purchase event via `/capi-setup`." — every claim traces to a raw field.

**Bad:** "Health looks decent, engagement is probably fine, consider improving the pixel." — vague, ungrounded, no numbers, invents sentiment. Reject.

**Bad:** Reporting paid metrics for a `--no-paid` run, or quoting an IG ER when IG was skipped. Always reflect which passes actually ran.
