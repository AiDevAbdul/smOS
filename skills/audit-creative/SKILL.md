---
name: audit-creative
description: Use this skill when the user asks to review or score a client's creative quality (typically via `/audit-creative {slug}` or as a follow-on to `/audit`). Scores the last 20–30 organic posts and ad creatives using Claude vision across visual quality, brand consistency, CTA presence, text density, and messaging clarity; appends scores to the audit report.
---

# /audit-creative — Creative Quality Audit

## Required Context

- `clients/{slug}/client_profile.json` — for brand voice rules
- `clients/{slug}/audit_report.md` — to append the creative section
- The creative list from `/audit` (cached in Supabase `reports.summary_json.creatives`) — do NOT re-fetch from Meta

## Workflow

### Step 1 — Collect creatives

If `/audit` cached creatives, read them. Otherwise call:
- `get_page_creatives({page_id, limit: 30})` for organic posts
- `list_ad_creatives({ad_account_id, limit: 30})` for ad creatives

Build a unified list. For each item:
```json
{
  "asset_id": "...",
  "type": "organic | ad",
  "format": "image | video | carousel",
  "image_url": "...",
  "copy": "...",
  "created_at": "..."
}
```

Filter out: status-only posts (no image), video assets where only thumbnail is available (score thumbnail with format=video), and items older than 90 days.

### Step 2 — Batched vision scoring

**Critical:** batch in groups of 5–8 images per vision call. Larger batches degrade per-image attention.

For each batch, send Claude vision a single message with all batch image URLs + this rubric:

```
For each image, score on:
1. visual_quality (1-10): composition, clarity, lighting, production value
2. brand_consistency (1-10): does it match the client's brand colors/fonts? (brand colors: {{BRAND_COLORS}})
3. cta_present (true/false): is there a clear call-to-action visible on the image?
4. text_density_pct (0-100): estimated % of image area covered by overlaid text
5. messaging_clarity (1-10): is the value prop legible at thumbnail size?
6. notes (string, <140 chars): one-line observation

Restricted words to flag if visible in copy: {{RESTRICTED_WORDS}}
Return JSON array, one object per image, in the same order as provided.
```

Pass URLs as image content blocks — don't download. Meta CDN URLs are signed and accessible.

### Step 3 — Aggregate

Compute per-format averages:
- Avg visual quality (image vs video vs carousel)
- Avg brand consistency
- % with CTA
- % within text-density best practice (<20%)
- Avg messaging clarity

Identify:
- Top 3 best creatives (highest weighted score)
- Top 3 worst creatives (need replacement)
- Restricted-word violations (block-list)
- Brand consistency outliers (>2 std dev below mean)

### Step 4 — Append to audit report

Generate a markdown section and replace the `{{CREATIVE_AUDIT_SECTION}}` slot in `audit_report.md`:

```markdown
### Creative Audit

**Assets scored:** {{N}} ({{ORGANIC_N}} organic, {{AD_N}} ads)
**Overall creative health score:** {{SCORE}}/10

| Dimension | Image avg | Video avg | Carousel avg |
|---|---|---|---|
| Visual quality | ... | ... | ... |
| Brand consistency | ... | ... | ... |
| CTA presence | ...% | ...% | ...% |
| Text density compliant | ...% | ...% | ...% |
| Messaging clarity | ... | ... | ... |

**Top 3 best performers** (for replicating angles in Phase 4):
1. [link] — {{NOTES}}
2. ...

**Top 3 worst performers** (deprioritize / replace):
1. [link] — {{NOTES}}
2. ...

**Brand voice violations:** {{VIOLATIONS_LIST}}
```

### Step 5 — Persist

Update `reports` row: append `creative_audit` block to `summary_json`. Update `baseline_snapshots.content_quality_score` with the overall creative health score.

## Output

- Updated `clients/{slug}/audit_report.md` with creative section filled in
- Updated `reports` row and `baseline_snapshots.content_quality_score`

## Token Cost

Estimated ~30 images × 1.6k tokens per image = ~50k input tokens spread across 5–6 batches. Each batch returns ~2k output tokens. Total: ~60k tokens. Acceptable for once-per-client audit; not for repeated runs.

## Error Handling

- If an image URL 404s → score as null, note "unreachable" in the asset row
- If a batch fails parsing → retry once with `respond ONLY with valid JSON, no prose`. If still bad, skip the batch and continue
- If no creatives are found at all → output a stub section noting "no creatives to audit yet" and recommend the client post content first
