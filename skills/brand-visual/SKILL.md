---
name: brand-visual
description: Use this skill when a named brand needs its visual identity (typically via `/brand-visual {slug}`). Produces moodboard direction, logo suite, color palette, and typography system into brand_profile.json. AI first-drafts (moodboard → logo concepts → color/type); the human approves the logo — the gate that unlocks the brand book and social assets. Requires the name to be approved first.
---

# /brand-visual — Visual Identity (Phase 0 · step 3 of 5)

Delivered as a **system, not a logo**. Dependency order within visual: moodboard → logo → color + type (finalized after logo locks) → imagery/icons. The **logo selection is the human gate**.

## Precondition (fail-closed)

`brand_profile.json → verbal.name_approved_at` must be set. Otherwise halt: "Approve the name in `/brand-name` first." (Enforced at schema stage `visual`.)

## Required Context

- `clients/{slug}/brand_profile.json` — strategy (archetype/positioning) + verbal (name) drive the visual direction
- `clients/{slug}/client_profile.json` — any `assets.brand_colors` the client already has

## Workflow

1. **Moodboard / concept direction first** (skipping this causes endless logo revisions). Describe 2–3 directions; get the human to pick one before generating logos.
2. **Logo suite** for the chosen direction: primary lockup, mark/icon, wordmark, monochrome, white-reversed. Prefer a true vector (SVG) primary. Capture clear-space + min-size rules.
   - If using AI image generation, set `visual.ai_generated: true` so `/launch`'s ai-disclosure guard carries `ai_disclosed` through to any ad built from these assets.
3. **Present logo options for human approval** — this is the gate.
4. After the logo locks: finalize **color palette** (primary/secondary/accent + neutrals, HEX, 60-30-10, WCAG AA contrast) and **typography** (heading + body + scale).
5. Define **imagery style** + **iconography** (derived from the locked logo + color + type).

## Persisting

```
node skills/brand-visual/brand-visual.js {slug} --in visual.json
```
`visual.json` matches `schemas/brand_profile.js → visual` (moodboard_url, logo{primary_url,mark_url,wordmark_url,mono_url,reverse_url,svg_url,clear_space,min_size}, colors{primary,secondary,accent,neutrals[]}, typography{heading,body,scale}, imagery_style, iconography, ai_generated).

**Approval gate (human only):**
```
node skills/brand-visual/brand-visual.js {slug} --approve-logo
```
Sets `visual.logo_approved_at` + `status: visual_approved`. `/brand-book` and `/brand-social` refuse to run until this is set.

## Output

- `clients/{slug}/brand_profile.json` (visual layer + logo gate)
- Logo/asset files should be saved under `clients/{slug}/brand/` and referenced by URL/path.

## Safety

- AI-generated visuals: set `ai_generated: true`. Purely-AI logos generally can't be copyrighted without human modification — note this to the client; trademark is still available and clearance still required (see `/brand-name`).
- The logo gate is human-only — never auto-stamped.

## Token Efficiency

- Color + type are template-shaped from the archetype/direction, not blank-page generated.
- Imagery/iconography derive from the locked logo — produced once, reused by `/brand-social` and `/creative`.
