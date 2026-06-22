# Brand Book — I/O Contract

Full input/output schema for `/brand-book`, with example payloads and edge-case handling.
Read this when you need the exact shape of `brand_profile.json` fields the assembler reads,
the `guidelines` output block it writes, the stdout JSON, or how edge cases behave.
Self-contained.

---

## Input — `clients/{slug}/brand_profile.json`

The assembler reads three locked layers plus the slug. Only the fields below are consumed;
all are normalized to `null`/`[]` if absent (see `api-reference.md`).

```jsonc
{
  "client_slug": "acme",
  "status": "visual_approved",            // draft|positioning_approved|named|visual_approved|complete

  "strategy": {
    "purpose": "Make X effortless",
    "mission": "...", "vision": "...",
    "values": ["honest", "fast"],          // array
    "archetype": { "primary": "sage", "secondary": "creator" },  // primary ∈ 12 archetypes
    "value_proposition": "...",
    "differentiation": "...",
    "positioning_statement": "For founders who...",  // required upstream (strategy stage)
    "messaging_pillars": ["...", "..."],
    "essence": "...", "promise": "...",
    "positioning_approved_at": "2026-06-01T..."       // GATE 1
  },

  "verbal": {
    "name": "Acme",                        // required upstream (verbal stage)
    "tagline": "...",
    "voice": { "traits": ["..."], "do": ["..."], "dont": ["..."], "spectrums": null },
    "messaging_house": { "roof": "...", "walls": ["..."], "foundation": ["..."] },
    "boilerplate": "...",
    "name_approved_at": "2026-06-05T..."   // GATE 2
  },

  "visual": {
    "logo": {
      "primary_url": "https://.../logo.png",   // required upstream (visual stage)
      "mark_url": "...", "wordmark_url": "...", "mono_url": "...",
      "reverse_url": "...", "svg_url": "...",
      "clear_space": "1x cap height", "min_size": "24px"
    },
    "colors": { "primary": "#0A2540", "secondary": "#635BFF", "accent": null, "neutrals": ["#FFF"] },
    "typography": { "heading": "Inter", "body": "Inter", "scale": "1.250 major third" },
    "imagery_style": "...", "iconography": "...",
    "ai_generated": false,                 // drives the disclosure branch
    "logo_approved_at": "2026-06-10T..."   // GATE 3 — the ONLY gate this skill checks
  }
}
```

---

## Output 1 — files in `clients/{slug}/`

- `brand_book.md` — the assembled Markdown.
- `brand_book.html` — self-contained, print-ready (shared `mdToHtml` template).
- `brand_book.pdf` — present when Playwright is installed; otherwise skipped (non-fatal).

## Output 2 — merged into `brand_profile.json → guidelines`

```json
{
  "guidelines": {
    "doc_url": "/abs/path/clients/acme/brand_book.html",
    "pdf_url":  "/abs/path/clients/acme/brand_book.pdf",   // null if PDF render skipped
    "version":  "2026-06-22",                              // run-date YYYY-MM-DD
    "generated_at": "2026-06-22T14:03:00.000Z"            // ISO timestamp
  }
}
```

Written via `saveBrand(slug, { guidelines })` with **no stage** — the merge never
re-triggers validation, so recording output cannot fail-closed.

## Output 3 — stdout JSON summary

```json
{
  "slug": "acme",
  "html": "/abs/path/clients/acme/brand_book.html",
  "pdf":  "/abs/path/clients/acme/brand_book.pdf",   // or "(PDF render skipped — install playwright)"
  "status": "visual_approved",
  "next": "/brand-social"
}
```

---

## Edge cases

| Case | Behavior |
|------|----------|
| `slug` arg missing | Print `Usage: brand-book.js <slug>`, exit **1** |
| `logo_approved_at` unset | Validator fails; print error list, exit **3**; route to `/brand-visual --approve` |
| `brand_profile.json` absent | `loadBrand` returns a draft skeleton; `guidelines` validation then fails on the missing logo gate → exit 3 |
| Optional field absent (e.g. `colors.accent`, `mark_url`) | Its line is omitted from the book — no placeholder text |
| `voice.do` / `voice.dont` empty | Those sub-blocks are skipped; section still renders |
| `messaging_house.roof` absent | Whole messaging-house block skipped |
| `ai_generated` true vs false | Renders the matching disclosure paragraph (see `domain-standards.md` §4) |
| Playwright not installed | `pdf_url: null`, stdout `pdf: "(PDF render skipped — install playwright)"`, HTML still written |
| Re-run after a `/brand-visual` change | Overwrites the three files and bumps `version`/`generated_at` to the new run date |

---

## Keeping current

- If `schemas/brand_profile.js` adds fields the book should render, add them to the Input
  block above and to the section taxonomy in `domain-standards.md`.
- The `guidelines` output keys are consumed by `/portal` and client deliverables — keep them
  stable.
- Last verified: 2026-06-22.
