# Creative Audit — Domain Standards

Embedded expertise for `/audit-creative`. The scoring rubric, thresholds, and formulas here
are the CONSTANT half of the skill — they are encoded in `audit-creative.js` and the vision
prompt it builds. Read this to score creatives consistently and to interpret aggregates.

## 1. Scoring Rubric (the six dimensions)

Claude vision scores **each image** on exactly these fields. Return one object per image,
in input order, as a JSON array.

| Field | Type | Range | Meaning |
|-------|------|-------|---------|
| `visual_quality` | number | 1–10 | Composition, clarity, lighting, production value |
| `brand_consistency` | number | 1–10 | Match to the client's brand colors / fonts (colors injected into the prompt) |
| `cta_present` | boolean | — | Is a clear call-to-action visible **on the image**? |
| `text_density_pct` | number | 0–100 | Estimated % of image area covered by overlaid text |
| `messaging_clarity` | number | 1–10 | Is the value prop legible at thumbnail size? |
| `notes` | string | <140 chars | One-line observation |

Scoring guidance for the 1–10 dimensions:

- **1–3** unusable / off-brand / illegible — flag for replacement.
- **4–6** acceptable but unremarkable — the bulk of typical SMB content.
- **7–8** strong, on-brand, scroll-stopping.
- **9–10** reserve for genuinely excellent, professional-grade assets.

Avoid central-tendency bias: do not score everything 5–7. Spread the distribution so
top-3 / bottom-3 ranking is meaningful.

## 2. Thresholds (constants in the script)

| Constant | Value | Why |
|----------|-------|-----|
| `MAX_AGE_DAYS` | 90 | Older creatives are not representative of current output; ad creatives with `created_at = null` are always kept |
| `BATCH_SIZE` | 6 | Images per vision call; larger batches degrade per-image attention |
| `TEXT_DENSITY_BEST` | 20 (%) | Industry text-density best practice — feeds `text_density_compliant_pct` and the weighted bonus |

Text-density rationale: Meta retired the hard 20%-text rejection, but heavy text still
suppresses delivery and reads as low-quality. `< 20%` remains the compliance bar.

## 3. Format classification

The script labels each asset before scoring:

- **carousel** — first attachment has `subattachments` (organic) or `link_data.child_attachments` (ad).
- **video** — attachment type `video_inline`, or `video_id`/`source` present (organic), or `object_story_spec.video_data` (ad). Score the **thumbnail**, keep `format = video`.
- **image** — `full_picture` / attachment media image (organic) or `image_url`/`thumbnail_url` (ad).
- **unknown** — none of the above; only assets with an `image_url` survive the filter, so unknowns without an image are dropped.

Status-only posts (no `image_url`) are excluded entirely.

## 4. Formulas (computed in `aggregate`, not by vision)

**Per-asset weighted score** (`weightedScore`), used only for top-3 / bottom-3 ranking:

```
w = (visual_quality + brand_consistency + messaging_clarity) / 3
    + (cta_present        ? 0.5 : 0)
    + (text_density_pct < 20 ? 0.5 : 0)
```

Assets with `visual_quality == null` get `w = -1` (sink to the bottom, never picked as "best").

**Overall creative-health score** (0–10, one decimal):

```
overall = round( (avg(visual_quality) + avg(brand_consistency) + avg(messaging_clarity)) / 3 , 1)
```

CTA and text-density do **not** feed the overall score — they are reported as percentages only.

**Per-format aggregates** (per image / video / carousel):

- `visual_quality`, `brand_consistency`, `messaging_clarity` — mean of numeric scores, 1 decimal.
- `cta_present_pct` — % of assets with `cta_present === true`.
- `text_density_compliant_pct` — % with `text_density_pct < 20`.
- `count` — assets of that format that were scored.

Empty sets return `null` (rendered as `—`), never `0` — absence is not a zero score.

## 5. Restricted-word checking (pre-vision, in the script)

`checkRestricted` lowercases the copy and word-boundary-matches each entry of
`voice.restricted_words` ∪ `voice.avoid` (regex-escaped). Hits land in
`assets[].restricted_word_hits` and surface as **brand voice violations** in the report.
This is a copy-text check, independent of the vision pass — it runs even if vision fails.

## 6. Good vs bad — worked examples

**Good (score ~8.5, top-3 candidate)**
```json
{ "visual_quality": 9, "brand_consistency": 8, "cta_present": true,
  "text_density_pct": 12, "messaging_clarity": 8,
  "notes": "Clean product hero, brand teal dominant, single 'Shop now' CTA" }
```
weighted = (9+8+8)/3 + 0.5 + 0.5 = 9.33.

**Bad (score ~3.7, bottom-3 / replace)**
```json
{ "visual_quality": 4, "brand_consistency": 3, "cta_present": false,
  "text_density_pct": 55, "messaging_clarity": 4,
  "notes": "Cluttered, off-brand stock photo, wall of overlaid text" }
```
weighted = (4+3+4)/3 = 3.67 (no bonuses).

**Edge — unreachable image**
```json
{ "visual_quality": null, "brand_consistency": null, "cta_present": null,
  "text_density_pct": null, "messaging_clarity": null, "notes": "unreachable" }
```
weighted = -1; excluded from averages, never a top pick.

## Keeping current

If Meta changes creative best practice (e.g. a new text-density guideline) or the agency
adds a scoring dimension, update `audit-creative.js` (the constants and `buildVisionPrompt`)
**and** this file together so the rubric and the code never drift. Re-verify the cited
Meta Ads Guide URL and stamp a new "Last verified" date in `SKILL.md`.
