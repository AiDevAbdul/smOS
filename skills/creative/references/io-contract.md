# /creative — I/O Contract

Full JSON schemas, example payloads, and edge-case handling for the two artifacts
`creative.js` reads/writes. The canonical machine schema lives in `schemas/ad_copy.js`
(`normalize` / `validate` / `selectTopCopy`); this file documents it for humans.

## The join key: `angle_id`

`angle_id` is the single contract between `/strategy-brief`, `/creative`, and `/launch`.
It is derived by `angleId(name)` — uppercase, non-alphanumerics → `_`, trimmed
(e.g. `"Pain / Problem"` → `PAIN_PROBLEM`). It must survive **brief → draft → ad_copy.json
unchanged**; `/launch`'s `selectTopCopy` matches on it (exact `angle_id`, then exact name,
then loose name-contains). Drift here is what previously produced `copy_used: null` for ads.

## Input: `strategy_brief.json` (read)

Relevant fields only:

```json
{
  "status": "approved",
  "creative_angles": [
    { "angle_id": "PAIN", "name": "Pain", "hook": "Problem-led question", "format": "reels_15_30s", "direction": "..." }
  ]
}
```

`getAngles` accepts `creative_angles` or `angles`. `angleName` falls back across
`archetype | name | angle | label`. `angleFormat` falls back to `brief.default_format`
then `"reels_15_30s"`.

## Output A: `ad_copy_draft.json` (skeleton writes; Claude fills)

```json
{
  "client_slug": "acme",
  "generated_at": "2026-06-22T00:00:00.000Z",
  "brief_ref": "strategy_brief.json",
  "instructions": "Fill each hook with 5 hook strings...",
  "voice": { "tone": "...", "restricted_words": ["cheap", "guaranteed"] },
  "audience": { "pain_points": ["..."] },
  "angles": [
    {
      "angle_id": "PAIN",
      "name": "Pain",
      "hook_archetype": "Problem-led question",
      "format": "reels_15_30s",
      "direction": "...",
      "hooks": [
        { "text": "", "primary_text": ["", "", ""], "headlines": ["", "", ""], "ctas": ["", "", ""] }
      ]
    }
  ]
}
```

Claude fills `text` (5 hooks per angle) and each hook's 3 `primary_text`, 3 `headlines`,
3 `ctas`. Leave structure intact.

## Output B: `ad_copy.json` (lint writes; `/launch` consumes)

```json
{
  "client_slug": "acme",
  "generated_at": "2026-06-22T00:00:00.000Z",
  "brief_ref": "strategy_brief.json",
  "voice_check": { "restricted_words_screened": ["cheap", "guaranteed"] },
  "scoring_rubric": "clarity / specificity / emotional_trigger / cta_strength on 0-10 each; composite is the average",
  "limits": { "hook": 60, "primary_text": 500, "primary_text_truncate": 125, "headline": 40, "description": 30 },
  "valid_ctas": ["SHOP_NOW", "..."],
  "angles": [
    {
      "angle_id": "PAIN",
      "name": "Pain",
      "hook_archetype": "Problem-led question",
      "format": "reels_15_30s",
      "direction": "...",
      "hooks": [
        {
          "hook": { "text": "...", "length": 41, "limit": 60, "over_limit": false,
                    "compliant": true, "restricted_hits": [],
                    "scores": { "clarity": 7, "specificity": 8, "emotional_trigger": 7, "cta_strength": 7, "overall": 7.3 } },
          "primary_text": [ { "text": "...", "length": 90, "limit": 500, "over_limit": false, "compliant": true, "restricted_hits": [], "scores": { } } ],
          "headlines": [ { "text": "...", "scores": { } } ],
          "ctas": [ { "type": "SHOP_NOW", "valid": true, "scores": { } } ],
          "best_combo": { "primary": "...", "headline": "...", "cta": "SHOP_NOW", "overall": 7.1 },
          "top_pick": true
        }
      ],
      "design_brief": {
        "sizes": ["1080x1080", "1080x1920", "1200x628"],
        "copy_zones": "Center-safe for 1:1; bottom-third for 9:16; left-third for 1.91:1 (CTA bug area).",
        "visual_direction": "Lead with the Problem-led question. ..."
      }
    }
  ],
  "summary": { "total_variants": 60, "non_compliant": 0, "over_limit": 0, "issues": [] }
}
```

### Validation gate (`schemas/ad_copy.js` → `validate`)

Fail-closed; `assertValid` throws before write if any of these fail:

- `angles` is a non-empty array.
- Each angle has a non-empty `angle_id` and `name`.
- Each angle has usable copy: at least one `primary_text` with text, or at least one hook.

`normalize` is lenient on the way in — it flattens the nested lint shape, coerces variants
(bare string or `{text, score|scores}`) to `{ text, score: { composite } }`, and coerces
CTAs (`string` or `{type|value}`) — so `/launch` always sees one canonical shape.

## Supabase row (written by the agent, not the script)

After a clean lint, insert into `ad_copy`: `client_id`, `brief_id`
(`strategy_briefs.id`), `copy` (full `ad_copy.json`), `created_at`.

## Edge cases

| Case | Behavior |
|------|----------|
| Empty variant string | Scores all-zero; not counted as compliant failure unless over limit |
| CTA not in enum | `valid: false`, score 0, added to `summary.issues` |
| Restricted word hit | `compliant: false`, words in `restricted_hits`, listed in `issues` — not rewritten |
| Brief has no angles | `ad_copy.json` would have empty `angles` → `validate` fails, nothing written |
| Variant as bare string in draft | `normalize` coerces to `{ text, score:{composite:null} }` |
| Duplicate top scores | First hook with max `best_combo.overall` wins `top_pick` |
| `angle_id` absent | Re-derived from `name` via `angleId()` — keep names stable so it stays consistent |

**Verification date:** see the single canonical **Last verified** line in `../SKILL.md`
(Documentation & References). This file does not carry its own date.
