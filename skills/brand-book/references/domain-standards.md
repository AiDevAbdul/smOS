# Brand Book — Domain Standards

Embedded expertise for assembling a brand guidelines document from a locked
`brand_profile.json`. Read this when you need the section taxonomy, the exact ratios and
thresholds to print, the governance rules, or good/bad output examples. Self-contained.

---

## 1. The eight-section taxonomy (fixed order)

A brand book is a governance document, not a deck. smOS always emits these eight sections
in this order. The order mirrors how decisions were locked upstream (strategy → verbal →
visual) followed by usage rules.

| # | Section | Sourced from | Notes |
|---|---------|--------------|-------|
| 1 | Brand Strategy | `strategy.*` | Purpose, mission, vision, positioning, archetype(s), value prop, differentiation, essence, promise, values, messaging pillars |
| 2 | Logo System | `visual.logo.*` | Primary, mark/icon, wordmark, monochrome, reversed, SVG, clear space, minimum size |
| 3 | Color Palette | `visual.colors.*` | Primary / secondary / accent / neutrals + ratio + contrast rule |
| 4 | Typography | `visual.typography.*` | Heading, body, scale |
| 5 | Imagery & Iconography | `visual.imagery_style`, `visual.iconography` | Direction, not assets |
| 6 | Voice & Tone | `verbal.voice.*`, `verbal.messaging_house.*`, `verbal.tagline`, `verbal.boilerplate` | Traits, do/don't, spectrums, messaging house (roof/walls/foundation) |
| 7 | AI-Content Disclosure | `visual.ai_generated` | Branch on the flag (see §4) |
| 8 | Governance | constant + `client_slug` | Naming, ™/®, approval gates, asset location |

**Rule:** an absent optional field is omitted cleanly (no line emitted) — never filled with
"TBD", "N/A", or invented copy. Required fields are enforced by the schema validator before
assembly even begins (see `api-reference.md`).

---

## 2. Color ratio + contrast (print these exactly)

- **60-30-10 usage ratio:** 60% primary, 30% secondary, 10% accent. This is the standard
  proportional balance for brand color application across surfaces.
- **WCAG 2.x AA contrast:** **4.5:1** for normal body text, **3:1** for large text
  (≥18pt, or ≥14pt bold). These thresholds are exact — never round them. They govern any
  text-on-brand-color pairing the client will use.

These two values are CONSTANT and must appear verbatim in the Color section regardless of
the client's actual palette.

---

## 3. The 12 brand archetypes (validation taxonomy)

`strategy.archetype.primary` must be one of (lowercased): innocent, everyman, hero,
outlaw, explorer, creator, ruler, magician, lover, caregiver, jester, sage. The schema
rejects anything else. The book prints `primary + secondary` when both are present.

---

## 4. AI-content disclosure branch

Branch on `visual.ai_generated`:

- **`true`** — the brand's visuals include AI-generated imagery. The section states that any
  ad built from these assets MUST set `ai_disclosed: true` (Meta policy, enforced since
  Mar 2026; the smOS `ai-disclosure` guard fail-closed blocks undisclosed AI creatives).
  It also notes that purely-AI logos generally cannot be copyrighted without human
  modification, though the mark remains trademarkable (clearance still required).
- **`false`** — visuals are human-authored. The section instructs that if AI imagery is
  introduced later, set `visual.ai_generated: true` so the disclosure carries through to ads.

Never omit this section — one of the two branches always renders.

---

## 5. Governance rules (constant)

- **File naming:** `{slug}_{asset}_{variant}_{version}` (e.g. `acme_logo_mono_v2`).
- **Trademark:** use ™ / ® per the legal status of the mark.
- **Change control:** logo, color, and name changes require the same human-approval gate as
  their originating skill — `/brand-book` never re-approves them.
- **Asset location:** brand assets live in `clients/{slug}/brand/`.

---

## 6. Good vs bad examples

**Good — Color section (palette present, accent absent):**
```
## 3 · Color Palette
- **Primary:** #0A2540
- **Secondary:** #635BFF
**Neutrals**
- #FFFFFF
- #1A1A1A
Usage ratio **60-30-10** (primary / secondary / accent). Maintain WCAG AA contrast (4.5:1 body, 3:1 large text).
```
Accent line is simply absent — no placeholder.

**Bad — invented placeholders:**
```
- **Accent:** TBD — pick something that pops
- **Primary:** (designer to confirm)
```
The assembler must never write this. If `colors.primary` were truly missing, the schema
validator halts at the `guidelines` stage and names the field instead of rendering.

**Good — AI disclosure, `ai_generated: false`:**
> Brand visuals are human-authored. If AI imagery is introduced later, set
> `visual.ai_generated: true` so the smOS `ai-disclosure` guard carries the disclosure
> through to ads.

**Bad — gate bypass:**
Re-rendering the book after editing `brand_profile.json` to stamp `logo_approved_at`
yourself. The logo gate is stamped only by `/brand-visual --approve` by a human operator.

---

## Keeping current

- Color ratio and the eight-section order are stable agency conventions — change only if the
  agency's house style changes.
- WCAG thresholds: re-confirm against the W3C Understanding doc (see SKILL.md references).
- AI-disclosure language: re-confirm against Meta's policy page if the labeling rules change.
- Last verified: 2026-06-22.
