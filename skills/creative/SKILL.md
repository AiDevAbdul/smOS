---
name: creative
description: Use this skill when the user asks to write ad copy, generate creative variants, or produce a creative package from an approved strategy brief (typically via `/creative {slug}`). Generates hooks, primary text, headlines, CTAs, scored variants, and a design brief — checked against client voice and restricted words; outputs `ad_copy.json`.
---

# /creative — Ad Copy Package

## Required Context

- `clients/{slug}/client_profile.json` — for `voice`, `audience`, `business`, `assets`
- `clients/{slug}/strategy_brief.json` — must exist AND have an approved row in Supabase `strategy_briefs`
- Supabase connector — to verify approval and write `ad_copy` row

Halt if the strategy brief is missing OR its Supabase row is not `status: 'approved'`.

## Workflow

### Per angle in `strategy_brief.creative_angles` (expect 3)

1. **5 hook options.** Each hook ≤ 60 chars, written in `voice.tone`, leading with the angle's archetype (pain / aspiration / authority etc.). No engagement bait.
2. **For each hook, expand:**
   - 3 primary text variants (≤ 125 chars before truncation, ≤ 500 chars total)
   - 3 headline variants (≤ 40 chars)
   - 3 CTA variants drawn from valid Meta CTA enums (e.g. `SHOP_NOW`, `LEARN_MORE`, `SIGN_UP`, `GET_OFFER`)
3. **Score each variant 0–10** on:
   - `clarity` — would a stranger understand the offer in 3s?
   - `specificity` — concrete numbers, names, outcomes vs vague claims
   - `emotional_trigger` — strength of pull on the named pain/aspiration
   - `cta_strength` — does the CTA match the funnel stage and the body
   Overall = average of the four.
4. **Top pick per angle:** flag the highest-overall hook + best-scoring primary/headline/CTA combo as `top_pick: true`.
5. **Restricted-words check.** For every variant, scan against `voice.restricted_words` (case-insensitive, whole-word). Any hit → set `compliant: false` + list the offending words; do not auto-rewrite, surface for review.
6. **Design brief per angle:**
   - Required sizes: 1080×1080 (feed), 1080×1920 (story/reels), 1200×628 (link)
   - Copy placement zones (safe areas for each size)
   - Visual direction: 2–3 sentence prompt referencing `assets.brand_colors`, `assets.formats_available`, and the angle's hook archetype
   - Format recommendation inherited from `strategy_brief.creative_angles[i].format`

### Persistence

1. Write `clients/{slug}/ad_copy.json`:
   ```json
   {
     "generated_at": "...",
     "brief_id": "<supabase strategy_briefs.id>",
     "angles": [
       {
         "name": "...",
         "hook_archetype": "...",
         "format": "image|video|carousel",
         "hooks": [
           {
             "text": "...",
             "primary_text": [{ "text": "...", "scores": {...}, "overall": 0, "compliant": true }],
             "headlines": [{ "text": "...", "scores": {...}, "overall": 0, "compliant": true }],
             "ctas": [{ "type": "SHOP_NOW", "scores": {...}, "overall": 0 }],
             "top_pick": false
           }
         ],
         "design_brief": {
           "sizes": ["1080x1080", "1080x1920", "1200x628"],
           "copy_zones": "...",
           "visual_direction": "..."
         }
       }
     ]
   }
   ```
2. Insert row in Supabase `ad_copy`: `client_id`, `brief_id`, `copy` (full JSON), `created_at`.
3. Print: `Copy ready — N angles · M hooks · K variants · top picks flagged. Run /launch next.`

## Output

- `clients/{slug}/ad_copy.json`
- Row in `ad_copy` table

## Token Efficiency

- Read the strategy brief once; never re-derive its angles
- Generate copy in a single structured pass — don't loop per-variant with separate LLM calls
- Restricted-word and length checks run locally, not via a model
