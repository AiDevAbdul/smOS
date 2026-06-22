---
name: brand-book
description: Use this skill to assemble a complete brand guidelines document (HTML + PDF) from a locked brand_profile.json — strategy summary, logo system, color, typography, imagery, voice & tone, AI-disclosure rules, and governance. This skill should be used when a brand's strategy, name, and visual identity are all approved and the client needs the governance document (typically via `/brand-book {slug}`). It is a deterministic assembler (no generation) and halts fail-closed unless the logo gate is stamped.
---

# /brand-book — Brand Guidelines (Phase 0 · step 4 of 5)

Assemble the locked strategy + verbal + visual layers of `brand_profile.json` into the
brand governance document. This is a **deterministic assembler, not a generator** — it
formats decisions already approved upstream and never invents a brand value. Ships HTML
(interactive) + PDF (shareable) in the same design language as every smOS report.

## What This Skill Does

- Load and validate `clients/{slug}/brand_profile.json` at schema stage `guidelines`.
- Format eight standard sections from existing data: brand strategy, logo system, color
  palette, typography, imagery & iconography, voice & tone + messaging house,
  AI-content disclosure, and governance.
- Render `brand_book.md` → `brand_book.html` → `brand_book.pdf` via the shared
  `writeHtmlAndPdf` helper.
- Record `guidelines.doc_url` / `pdf_url` / `version` / `generated_at` back into the profile.

## What This Skill Does NOT Do

- Does **not** create or decide brand strategy → `/brand-strategy`.
- Does **not** generate or screen the brand name → `/brand-name`.
- Does **not** design the logo, palette, or type → `/brand-visual`.
- Does **not** produce social profile assets, covers, or bios → `/brand-social`.
- Does **not** stamp any human-approval gate — gates are stamped only by the originating
  skill on an explicit `--approve` flag.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/brand.js` (load/save/merge), `schemas/brand_profile.js` (stage validator + gates), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`) |
| **Conversation** | Which `{slug}`; any explicit re-render request after a visual change |
| **Skill References** | Section taxonomy, ratios, and contrast rules in `references/` (see table below) |
| **Client Profile** | `clients/{slug}/brand_profile.json` — the single source for all three locked layers |

## Clarifications

> Before asking: check the conversation, `brand_profile.json`, and the upstream gate
> timestamps. Only ask for what cannot be determined. Section content and ordering are
> embedded in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?

**Optional (ask only if relevant):**
2. Re-render an existing book after a `/brand-visual` change, or first generation?

## Workflow

1. Run `node skills/brand-book/brand-book.js {slug}`.
2. The script loads the profile via `loadBrand(slug)` and validates stage `guidelines`.
3. If `visual.logo_approved_at` is unset, validation fails — halt and tell the user to
   approve the logo in `/brand-visual` first.
4. On success it assembles the eight Markdown sections, renders HTML + PDF, and merges the
   `guidelines` metadata back into `brand_profile.json`.
5. Report the HTML/PDF paths and the next step (`/brand-social`) from the script's JSON.

## Input / Output Specification

**Inputs:** CLI arg `{slug}`; reads `clients/{slug}/brand_profile.json`.
**Outputs:** `clients/{slug}/brand_book.md` + `.html` + `.pdf`, and an updated
`brand_profile.json → guidelines` block. The script prints a JSON summary to stdout
(`slug`, `html`, `pdf`, `status`, `next`).
(Full schemas and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Strategy text, name, logo URLs, palette HEX, fonts, voice traits, AI-generated flag | The eight-section order + headings, 60-30-10 ratio, WCAG AA contrast targets, governance/naming rules, fail-closed logo gate |
| Whether AI imagery is used (drives the disclosure copy) | Which disclosure paragraph renders for each branch |
| Version date (`YYYY-MM-DD` at run time) | Document template + Apple design tokens (shared `md_to_html`) |

## Domain Standards

### Must Follow
- [ ] Validate stage `guidelines` before assembling — the logo gate is load-bearing.
- [ ] Format only approved data; omit a field cleanly when absent (never placeholder text).
- [ ] State the 60-30-10 color ratio and WCAG AA contrast (4.5:1 body, 3:1 large) verbatim.
- [ ] Render the AI-disclosure section matching `visual.ai_generated` (true vs false branch).
- [ ] Ship both HTML and PDF; write the `guidelines` metadata back to the profile.

### Must Avoid
- Inventing or paraphrasing strategy/voice values to fill a section.
- Stamping or bypassing the logo gate.
- Per-client custom renderers — use the shared `writeHtmlAndPdf` helper only.

### Output Checklist (verify before delivery)
- [ ] All eight sections present (or cleanly omitted lines for absent optional fields).
- [ ] `brand_book.html` exists; `.pdf` exists or a clear "install playwright" note is shown.
- [ ] `brand_profile.json → guidelines.doc_url/version/generated_at` updated.
- [ ] Stdout JSON reports `next: "/brand-social"`.

## Error Handling

| Scenario | Action |
|----------|--------|
| No `{slug}` arg | Exit 1, print usage `brand-book.js <slug>` — never guess |
| `visual.logo_approved_at` unset | Exit 3, list the failed gate; route user to `/brand-visual --approve` |
| Other required field missing | Exit 3, name each missing field from the validator — never fabricate |
| PDF render fails (no Playwright) | Non-fatal: HTML still ships; stdout notes "install playwright" |
| Profile file missing | `loadBrand` returns a draft skeleton; validation then halts naming missing fields |

## Dependencies & Security

- **Reuses:** `scripts/lib/brand.js` (`loadBrand`, `saveBrand`, `clientDir`),
  `schemas/brand_profile.js` (`validate`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`).
- **External APIs:** none. PDF conversion shells out to `render_pdf.py` (headless Chromium
  via Playwright) — first-time setup `pip install playwright && python -m playwright install chromium`.
- **Secrets:** none read or written; no tokens, no network calls. All I/O is local files.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Understanding WCAG SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | The 4.5:1 / 3:1 AA contrast targets cited in the color section |
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | Canonical AI-content disclosure rule for the disclosure section |
| Labeling AI-Generated Content (announcement) | https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/ | Effective dates / label-vs-remove approach behind the smOS `ai-disclosure` guard |
| IG/FB profile, cover & story spec dimensions | https://www.facebook.com/business/ads-guide | Asset sizing referenced when handing off to `/brand-social` |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Section taxonomy, 60-30-10 ratio, WCAG AA thresholds, governance/naming rules, good vs bad examples |
| `references/api-reference.md` | The schema-stage contract + gate semantics this skill depends on (no external API; documents the validator and PDF toolchain) |
| `references/io-contract.md` | Full `brand_profile.json` schema, the `guidelines` output block, stdout JSON, and edge cases |
