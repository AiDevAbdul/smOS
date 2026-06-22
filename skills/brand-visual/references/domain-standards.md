# brand-visual — Domain Standards

Self-contained visual-identity expertise: build the system in the right order, deliver the
right artifacts, and pass the contrast quality gate. Read this when designing; nothing here
needs runtime discovery.

## Dependency order (do NOT reorder)

```
moodboard / direction  →  logo suite  →  color + type (finalized AFTER logo locks)  →  imagery + iconography
```

- Skipping the moodboard step is the #1 cause of endless logo revisions. Get a human to pick ONE direction before drawing logos.
- Color and type are derived from the locked logo, not the reverse. Finalizing them early forces rework when the logo changes.
- Imagery style and iconography are the last layer — they inherit the logo + palette + type and are reused by `/brand-social` and `/creative`.

## The three load-bearing human gates (Phase 0)

The brand track is governed by three timestamps AI must never auto-clear. Each gates the
next stage in `schemas/brand_profile.js → validate(obj, {stage})` (fail-closed):

| Gate | Field | Set by | Blocks until set |
|------|-------|--------|------------------|
| 1. Positioning | `strategy.positioning_approved_at` | `/brand-strategy --approve` | `/brand-name` (stage `verbal`) |
| 2. Name | `verbal.name_approved_at` | `/brand-name --approve-name` | **`/brand-visual` (stage `visual`)** ← precondition for THIS skill |
| 3. Logo | `visual.logo_approved_at` | **`/brand-visual --approve-logo`** ← stamped by THIS skill | `/brand-book` (stage `guidelines`) + `/brand-social` (stage `social`) |

This skill **requires** gate 2 and **stamps** gate 3. The code enforces gate 2 even when
`--in` is supplied (exit 3) — `--in` only names the input file; it is never an approval or
bypass. The logo gate is operator-only: a `--approve-logo` flag passed by a human, never
auto-set by Claude.

## Logo suite (deliver the full set)

A logo is a *system*. The `visual.logo` object captures all variants:

| Variant | Field | Purpose | Notes |
|---------|-------|---------|-------|
| Primary lockup | `primary_url` | Default usage | **Required** for stage validation. Prefer a true vector (set `svg_url`). |
| Mark / icon | `mark_url` | Avatars, favicons, app icons | Must read at small size. |
| Wordmark | `wordmark_url` | Text-only contexts | |
| Monochrome | `mono_url` | Single-ink print, faxable, stamps | |
| White / reversed | `reverse_url` | On dark or photographic backgrounds | |
| Vector source | `svg_url` | Infinite scale, edits | Strongly preferred for the primary. |

Always capture usage rules:
- `clear_space` — minimum padding around the mark (express as a fraction of mark height, e.g. "0.5× cap height").
- `min_size` — smallest legible rendering (e.g. "24px digital / 12mm print").

## Color palette — 60-30-10 + WCAG AA

`visual.colors` = `{ primary, secondary, accent, neutrals[] }`, all HEX.

- **60-30-10 rule:** ~60% dominant (often a neutral or primary), 30% secondary, 10% accent for emphasis/CTAs. Keeps layouts balanced; the accent stays scarce so it actually draws the eye.
- **Neutrals:** ship a ramp (e.g. near-white, light gray, mid gray, near-black) for backgrounds, borders, and text.

### WCAG 2.1 AA contrast (exact — do not round)

| Text type | Min ratio |
|-----------|-----------|
| Normal text (< 18pt, or < 14pt bold) | **4.5 : 1** |
| Large text (≥ 18pt, or ≥ 14pt bold) | **3 : 1** |

Contrast ratio formula: `(L1 + 0.05) / (L2 + 0.05)`, where `L1` is the lighter relative
luminance and `L2` the darker. Relative luminance of an sRGB color:

```
For each channel c in {R, G, B} as a fraction 0..1:
  c_lin = c/12.92                      if c <= 0.03928
  c_lin = ((c + 0.055)/1.055) ** 2.4   otherwise
L = 0.2126*R_lin + 0.7152*G_lin + 0.0722*B_lin
```

Verify every text-on-background pairing the brand will actually use (primary on white,
white on primary, body neutral on background) against the table above.

## Typography

`visual.typography` = `{ heading, body, scale }`.

- **Heading + body** at minimum; a clear pairing with contrast (e.g. a distinctive display heading + a highly legible body). Avoid two fonts that read as near-duplicates.
- **Scale:** a modular type scale (e.g. 1.25 major-third ratio: 16 / 20 / 25 / 31 / 39 …) keeps hierarchy consistent across the brand book and social templates.

## AI-generated visuals

- If any logo/imagery uses GenAI, set `visual.ai_generated: true`. `/launch`'s `ai-disclosure` guard then carries `ai_disclosed` through to any ad built from these assets (Meta rejects undisclosed photorealistic AI since Mar 2026).
- Purely-AI logos generally **cannot be copyrighted** without meaningful human modification. Note this to the client. Trademark protection is still available — and clearance is still required (owned by `/brand-name`).

## Good vs bad examples

| Bad | Good |
|-----|------|
| Generate 8 logo concepts before any direction is chosen | Present 2–3 moodboard routes, human picks one, then draw logos for that route |
| Deliver only a primary PNG | Deliver primary + mark + wordmark + mono + reverse + SVG, with clear-space + min-size |
| Pick palette and fonts first, then design the logo to match | Lock the logo, then derive palette + type from it |
| Accent color used across 40% of the layout | Accent reserved for ~10% (CTAs, highlights); 60% dominant, 30% secondary |
| Body text at 3.8:1 on background ("looks fine") | Every pairing verified ≥ 4.5:1 (normal) / 3:1 (large) |
| Claude runs `--approve-logo` after persisting | `--approve-logo` run only after a human explicitly locks an option |
| AI-generated mark with `ai_generated` unset | `ai_generated: true` set, copyright caveat flagged to client |
