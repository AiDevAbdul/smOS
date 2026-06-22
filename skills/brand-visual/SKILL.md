---
name: brand-visual
description: Use this skill to build a named brand's visual identity — moodboard direction, logo suite, color palette, and typography — and persist it into brand_profile.json behind the human logo-approval gate. This skill should be used when a brand whose name is already approved needs its visual system designed (typically via `/brand-visual {slug}`), as Phase 0 step 3 of 5 (after `/brand-name`, before `/brand-book`). AI first-drafts moodboard → logo concepts → color/type; the human approves the logo, which unlocks the brand book and social assets.
---

# /brand-visual — Visual Identity (Phase 0 · step 3 of 5)

Deliver a visual **system, not a logo**. This skill produces moodboard direction, a full logo suite, a color palette, and a typography system, then persists them into `clients/{slug}/brand_profile.json`. The logo selection is a load-bearing human gate that unlocks `/brand-book` and `/brand-social`.

## What This Skill Does

- Direct 2–3 moodboard/concept routes and get the human to pick one before any logo is drawn.
- Design a logo suite for the chosen route: primary lockup, mark/icon, wordmark, monochrome, white-reversed, plus clear-space and min-size rules (prefer a true vector SVG primary).
- Finalize the color palette (primary/secondary/accent + neutrals, HEX, 60-30-10, WCAG AA contrast) and typography (heading + body + scale) *after* the logo locks.
- Define imagery style and iconography derived from the locked logo + color + type.
- Persist the visual layer via `brand-visual.js --in visual.json` (fail-closed schema validation).
- Stamp the human logo gate via `brand-visual.js --approve-logo` (explicit operator action only).

## What This Skill Does NOT Do

- Does NOT create or screen the brand name — owned by `/brand-name` (its `name_approved_at` gate is a hard precondition here).
- Does NOT set positioning/archetype — owned by `/brand-strategy`.
- Does NOT assemble brand guidelines HTML/PDF — owned by `/brand-book` (runs after the logo gate).
- Does NOT produce profile pictures, covers, highlight covers, or bios — owned by `/brand-social`.
- Does NOT write ad creative — owned by `/creative`.
- Does NOT generate the actual image files — Claude produces assets; this skill records their URLs/paths and validates the contract.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/brand.js` (load/merge/save/stampGate), `schemas/brand_profile.js` (the `visual` stage contract + 3-gate model) |
| **Conversation** | Direction preferences, existing brand colors, AI-generation decisions already stated |
| **Skill References** | Logo-suite taxonomy, palette/contrast formulas, type-scale rules in `references/` (see table below) |
| **Client Profile** | `clients/{slug}/brand_profile.json` (`strategy.archetype`/`positioning`, `verbal.name`) + `clients/{slug}/client_profile.json` (`assets.brand_colors` if any) + per-client `CLAUDE.md` overrides |

## Clarifications

> Before asking: check the conversation, `brand_profile.json`, and the client profile.
> Only ask for what cannot be determined. Domain knowledge (palette ratios, contrast
> thresholds, logo-suite taxonomy) is embedded in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. Which moodboard direction does the human pick? (Logos are drawn only for the chosen route.)
3. Logo approval: which option does the human lock? (Triggers `--approve-logo` — operator only.)

**Optional (ask only if relevant):**
4. Are any logo/color assets AI-generated? (If yes, set `ai_generated: true`.)
5. Existing brand colors to honor from `client_profile.json`?

## Workflow

1. Verify the precondition: `brand_profile.json → verbal.name_approved_at` is set. If not, halt — the name must be approved in `/brand-name` first.
2. Present 2–3 moodboard/concept directions tied to the archetype/positioning; get the human to pick one (skipping this causes endless logo revisions).
3. Design the logo suite for the chosen direction (primary, mark, wordmark, mono, reverse, SVG) with clear-space + min-size. Save asset files under `clients/{slug}/brand/`.
4. Present logo options for human approval — this is the gate. Do not self-approve.
5. After the logo locks: finalize color palette (60-30-10, WCAG AA) and typography (heading/body/scale).
6. Define imagery style + iconography from the locked logo/color/type.
7. Write `visual.json` (shape: `references/io-contract.md`) and persist: `node skills/brand-visual/brand-visual.js {slug} --in visual.json`.
8. On human logo approval only: `node skills/brand-visual/brand-visual.js {slug} --approve-logo`.

## Input / Output Specification

**Inputs:** `{slug}` (arg 0, required); `--in visual.json` (path to the visual layer) OR `--approve-logo`. `--in` supplies the input path ONLY — it never bypasses the name gate.
**Outputs:** `clients/{slug}/brand_profile.json` (merged `visual` layer; `status: visual_approved` after gate). Logo/asset files under `clients/{slug}/brand/`. JSON summary to stdout.
(Full schemas, example payloads, and exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Moodboard direction, logo concepts, palette HEX values, font choices, imagery style | Logo-suite taxonomy (primary/mark/wordmark/mono/reverse) |
| Archetype/positioning that drives direction | 60-30-10 palette ratio; WCAG AA 4.5:1 / 3:1 contrast thresholds |
| Whether assets are AI-generated (`ai_generated`) | Dependency order: moodboard → logo → color/type → imagery |
| Existing brand colors to honor | The three load-bearing human gates (positioning, name, logo) and fail-closed exit codes |

## Domain Standards

### Must Follow
- [ ] Confirm `verbal.name_approved_at` is set before persisting (the code enforces this; exit 3 otherwise).
- [ ] Get the moodboard direction chosen by a human before drawing logos.
- [ ] Deliver the full logo suite (primary, mark, wordmark, mono, reverse) with clear-space + min-size; prefer SVG primary.
- [ ] Finalize color + type only after the logo locks.
- [ ] Verify color pairings meet WCAG AA (4.5:1 normal, 3:1 large) — see `references/domain-standards.md`.
- [ ] Set `ai_generated: true` whenever any visual uses GenAI imagery.
- [ ] Stamp the logo gate via `--approve-logo` ONLY on explicit human approval.

### Must Avoid
- Auto-stamping the logo gate, or treating `--in` as approval.
- Generating logos before a direction is chosen.
- Finalizing palette/type before the logo locks.
- Hardcoding a per-client token or palette in code — values live in `visual.json`/the profile.
- Claiming AI-only logos are copyrightable (they generally are not without human modification).

### Output Checklist (verify before delivery)
- [ ] `visual.json` validates against the `visual` stage (logo.primary_url, colors.primary, typography.heading all present).
- [ ] All five logo variants + clear-space + min-size captured.
- [ ] Palette has primary/secondary/accent + neutrals; pairings pass WCAG AA.
- [ ] `ai_generated` reflects reality.
- [ ] Logo gate stamped only after human approval; `status: visual_approved`.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` arg | Exit 1 with usage message — never guess the client |
| `verbal.name_approved_at` not set | Exit 3: "Name not approved. Run /brand-name and --approve-name." Fail-closed even with `--in` present |
| Neither `--in` nor `--approve-logo` given | Exit 1: "Provide --in visual.json or --approve-logo" |
| `--in` path does not exist | Exit 2: "Input not found: <path>" |
| `--approve-logo` but `visual.logo.primary_url` empty | Exit 3: persist `--in visual.json` first |
| `visual.json` fails stage validation | `saveBrand` throws (fail-closed), naming every missing field — fix the input, do not bypass |
| Missing client data (direction, colors) | Halt and ask for the specific field — do not guess |

## Dependencies & Security

- **Reuses:** `scripts/lib/brand.js` (`loadBrand`, `saveBrand`, `stampGate`), `schemas/brand_profile.js` (`normalize`/`validate`, `STAGES`, `ARCHETYPES`).
- **Runtime:** Node.js (ES modules); no network calls, no external API. Filesystem only.
- **External APIs:** none. (Visual specs / contrast references are cited below for human use, not fetched at runtime.)
- **Secrets:** none required. No tokens read or logged; never embed credentials in `visual.json`.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| WCAG 2.1 SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | Canonical 4.5:1 / 3:1 AA contrast rule for palette pairings |
| Meta Ads Guide (image/video specs) | https://www.facebook.com/business/ads-guide | Placement creative dimensions logos must fit |
| Meta Business Help Center | https://www.facebook.com/business/help | Authoritative fallback for profile/cover guidance |
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | Why `ai_generated` must be set for GenAI visuals |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Designing the system: logo-suite taxonomy, 60-30-10 ratio, WCAG AA contrast formula + thresholds, type-scale rules, good/bad examples, the three-gate model |
| `references/io-contract.md` | Writing `visual.json` or reading output: full `visual` JSON schema, example payloads, CLI flags, exit codes, edge cases |
