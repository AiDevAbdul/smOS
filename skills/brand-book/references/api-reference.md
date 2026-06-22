# Brand Book — Contract & Toolchain Reference

`/brand-book` has **no external API**. It is a deterministic, offline assembler. This file
documents the two contracts it actually depends on: the schema-stage validator (with its
load-bearing gate) and the PDF toolchain. Read this when you need exact validation behavior,
gate semantics, or the render pipeline. Self-contained.

---

## 1. Schema-stage contract — `schemas/brand_profile.js`

The skill calls `validate(profile, { stage: "guidelines" })` before assembling. The result
is `{ ok: boolean, errors: string[] }`. Assembly proceeds only when `ok === true`.

### What stage `guidelines` requires

The `guidelines` stage asserts **one** thing: the prior human gate is stamped.

```
needGate("visual.logo_approved_at", b.visual.logo_approved_at, "/brand-book")
```

If `visual.logo_approved_at` is not a non-empty string, validation fails with:

```
/brand-book requires visual.logo_approved_at to be set first (prior human gate not cleared)
```

The script exits **3** and prints the error list. There is no further required-field check
at the `guidelines` stage itself — earlier stages (`strategy`, `verbal`, `visual`) already
enforced their own required fields when those layers were written, and `normalize()` makes
every read safe by defaulting absent fields to `null`.

### The three load-bearing gates (context)

| Gate | Field | Stamped by | Status set |
|------|-------|-----------|-----------|
| 1 Positioning | `strategy.positioning_approved_at` | `/brand-strategy --approve` | `positioning_approved` |
| 2 Name | `verbal.name_approved_at` | `/brand-name --approve` | `named` |
| 3 Logo | `visual.logo_approved_at` | `/brand-visual --approve` | `visual_approved` |

Gates are stamped only via `stampGate(slug, gate)` in `scripts/lib/brand.js`, invoked only
on an explicit human `--approve`. `/brand-book` reads gate 3 and never writes any gate.

### `normalize()` vs `validate()`

- `normalize(raw)` — **lenient, never throws.** Coerces a raw/partial object into the full
  shape, defaulting missing fields to `null` or `[]`. `loadBrand` runs it on read.
- `validate(obj, { stage })` — **fail-closed.** Names every missing field and asserts the
  prior gate. Used here at stage `guidelines`.

---

## 2. Persistence contract — `scripts/lib/brand.js`

| Function | Behavior |
|----------|----------|
| `loadBrand(slug)` | Reads `clients/{slug}/brand_profile.json`, normalizes it; returns a draft skeleton if the file is absent (never throws) |
| `saveBrand(slug, patch, {stage})` | Deep-merges `patch` (arrays replace, objects merge), normalizes, optionally validates the stage (throws if invalid), writes back |
| `clientDir(slug)` | Absolute path to `clients/{slug}` |

`/brand-book` calls `saveBrand(slug, { guidelines: {...} })` **without** a stage (the merge
of output metadata must not re-trigger validation), so it cannot fail-closed on write.

---

## 3. PDF toolchain — `scripts/lib/md_to_html.js` + `render_pdf.py`

`writeHtmlAndPdf(mdPath, md, { title })` returns `{ htmlPath, pdfPath, pdfOk }`:

1. Writes `brand_book.html` next to `brand_book.md` using the shared Apple-design template
   (`mdToHtml`) — self-contained, print-ready, one visual language across all deliverables.
2. Shells out: `python3 render_pdf.py <html> --output <pdf>` (headless Chromium via
   Playwright).
3. **PDF failure is non-fatal** — `pdfOk` is `false`, HTML still ships, a one-line stderr
   warning is logged, and the skill reports "install playwright".

First-time setup: `pip install playwright && python -m playwright install chromium`.

The Markdown subset supported by `mdToHtml`: headings, bold/italic/`code`, links, lists,
tables, `---` rules, paragraphs. HTML is escaped so profile data cannot break the layout.

---

## Keeping current

- This skill makes **no network calls** — there is no API version, rate limit, or token to
  track. If a future version adds Drive upload of the PDF, document that endpoint here.
- If `schemas/brand_profile.js` adds a required field at the `guidelines` stage, reflect it
  in §1 above and in `io-contract.md`.
- Last verified: 2026-06-22.
