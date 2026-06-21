---
name: brand-book
description: Use this skill when a brand's strategy, name, and visual identity are locked and the client needs the brand guidelines document (typically via `/brand-book {slug}`). Auto-assembles a complete brand book (HTML + PDF) from brand_profile.json — strategy, logo system, color, typography, voice, and usage rules. Requires the logo to be approved first.
---

# /brand-book — Brand Guidelines (Phase 0 · step 4 of 5)

Codifies the locked strategy + verbal + visual layers into the governance document. This is a **deterministic assembler**, not a generator — it never invents brand decisions, it formats the ones already approved. Ships HTML + PDF like every other client deliverable.

## Precondition (fail-closed)

`brand_profile.json → visual.logo_approved_at` must be set. Otherwise halt: "Approve the logo in `/brand-visual` first." (Enforced at schema stage `guidelines`.)

## Required Context

- `clients/{slug}/brand_profile.json` — all three locked layers

## Workflow

1. Load and validate the brand profile at stage `guidelines`.
2. Assemble the standard brand-book sections from the data:
   - Brand strategy summary (purpose, mission, vision, values, positioning, archetype)
   - Logo system (variants) + usage/misuse (clear space, min size)
   - Color palette (HEX, 60-30-10, contrast pairings)
   - Typography (heading/body, scale)
   - Imagery & iconography direction
   - Voice & tone (traits, do/don't, spectrums) + messaging house
   - **AI-content disclosure rules** (modern section — references the smOS `ai-disclosure` guard)
   - Governance (file naming, ™/® usage, approval workflow)
3. Render HTML + PDF via the shared `writeHtmlAndPdf` helper (same design language as all reports).
4. Record `guidelines.doc_url`/`pdf_url`/`version`/`generated_at` back into the profile.

## Persisting / Running

```
node skills/brand-book/brand-book.js {slug}
```
Writes `clients/{slug}/brand_book.md` + `.html` + `.pdf`, and updates `brand_profile.json → guidelines`.

## Output

- `clients/{slug}/brand_book.html` (interactive) + `brand_book.pdf` (shareable)
- `brand_profile.json → guidelines` metadata

## Safety

- Pure assembler: if a required field is missing, validation halts with the field name — it never fabricates a value to fill the page.

## Token Efficiency

- Zero LLM in the body — 100% template fill from `brand_profile.json`.
- First-time PDF setup: `pip install playwright && python -m playwright install chromium`.
