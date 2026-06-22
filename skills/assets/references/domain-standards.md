# /assets — Domain Standards

Embedded expertise for the Digital Asset Manager: metric definitions, the media taxonomy, ranking rules, and worked good/bad examples. Read this when you need the meaning of a metric, the accepted enums, or how to judge a register payload. Self-contained — no other file required.

## Media-type taxonomy

`schemas/asset.js` defines `MEDIA_TYPES = ["image", "video", "carousel"]`. Any other value fails validation. `media_type` is lowercased on normalize, so `"Image"` and `"IMAGE"` both resolve to `image`.

| media_type | What it is | Which metrics are meaningful |
|---|---|---|
| `image` | Single static creative | `ctr`, `roas` (hook_rate/retention_3s are video concepts; leave null) |
| `video` | Single video/reel | `hook_rate`, `retention_3s`, `ctr`, `roas` |
| `carousel` | Multi-card creative (counts as one asset) | `ctr`, `roas` |

## Performance metric definitions

All metrics live under `metrics` and are **nullable until the asset has run**. The DAM stores numbers; it never computes them — they are measured downstream (e.g. `/analyze` from a `daily_metrics` rollup) and supplied via the `metrics` subcommand.

| Metric | Definition | Formula | Units / range |
|---|---|---|---|
| `impressions` | Times the asset was shown | counter | integer ≥ 0 (defaults to 0) |
| `hook_rate` | Share of impressions that watched the first 3s | `3s_video_views / impressions` | 0–1 (e.g. 0.32 = 32%) |
| `retention_3s` | Share still watching at 3s (a.k.a. 3-sec retention) | `viewers_at_3s / video_plays` | 0–1 |
| `ctr` | Click-through rate | `link_clicks / impressions` | 0–1 |
| `roas` | Return on ad spend | `revenue / spend` | multiple, e.g. 3.2 |

> Store rates as **decimals (0–1)**, not percentages, so ranking comparisons are consistent. A "32% hook rate" is stored as `0.32`.

### Benchmark orientation (not enforced by code, for judgement only)

These mirror the smOS global KPI orientation in the constitution; treat as soft guides, never hard gates here:

- `hook_rate` ≥ 0.30 is a strong scroll-stopper; < 0.15 signals a weak opener.
- `retention_3s` ≥ 0.25 is healthy for short-form video.
- `ctr` < 0.005 (0.5%) is the constitution's CTR pause orientation; ≥ 0.01 is good.
- `roas` ≥ 3.0 is the constitution's scale orientation; < 1.0 is the pause orientation.

## Ranking rules (`top`)

`topPerformers(slug, { by = "hook_rate", limit = 10 })`:

1. Drops any asset whose `metrics[by]` is `null`/missing (un-run assets never rank).
2. Sorts descending (winners first).
3. Returns at most `limit` (10).

`--by` accepts any metric key: `impressions`, `hook_rate`, `retention_3s`, `ctr`, `roas`. An unknown key simply yields an empty ranking (every value is null), not an error.

## Tags & angle

- `tags`: free-form array, normalized to an array even from a single string. Use for theme/format/season search (e.g. `["ugc","testimonial","summer"]`).
- `angle_id` (alias `angle`): the messaging angle the creative expresses (e.g. `PAIN`, `SOCIAL_PROOF`). Lets you find which angle's assets win.

## Good vs bad register examples

GOOD — video, hashed for dedupe, AI flagged and disclosed:
```json
{ "asset_id": "vid_ugc_pain_001", "media_type": "video",
  "uri": "https://cdn.example.com/a/vid_ugc_pain_001.mp4",
  "hash": "9f2c…", "angle_id": "PAIN", "tags": ["ugc","video"],
  "alt_text": "Customer describing the problem",
  "ai_generated": true, "ai_disclosed": true }
```

BAD — missing `uri`, missing disclosure:
```json
{ "asset_id": "img_x", "media_type": "image", "ai_generated": true }
```
Rejected with: `uri missing — an asset must point at real bytes` and `ai_generated asset is not marked ai_disclosed (Phase 3.2 disclosure)`.

BAD — invalid media_type:
```json
{ "asset_id": "x1", "media_type": "gif", "uri": "https://…/x.gif" }
```
Rejected: `media_type "gif" not in image/video/carousel`.

## Keeping current

Metric formulas and benchmark orientation track the smOS constitution's Global KPI table; if those thresholds change, update the benchmark list above. The taxonomy is driven by `MEDIA_TYPES` in `schemas/asset.js` — if a media type is added there, add a row to the taxonomy table.
