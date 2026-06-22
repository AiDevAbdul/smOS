# Proposal — API & Integration Reference

`/proposal` has **no external HTTP API of its own**. Its "API surface" is three in-repo
contracts it calls directly — the **`md_to_html`/`render_pdf` renderer**, the **service
catalog**, and the **`crm-store` + deal state machine** — plus a best-effort Supabase
mirror. Read this when you need exact function signatures, the renderer's Markdown subset,
the deal state machine, or how `/proposal` hands off to sibling skills. Self-contained.

---

## 1. The renderer this skill calls — `scripts/lib/md_to_html.js`

`/proposal` writes Markdown, then converts it via the shared helper. This is the skill's
own primary tech (not a downstream sibling's).

```js
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";
const { htmlPath, pdfPath, pdfOk } = writeHtmlAndPdf(mdPath, md, { title });
```

- **`writeHtmlAndPdf(mdPath, md, meta)`** → `{ htmlPath, pdfPath, pdfOk }`. Writes
  `<name>.html` next to `<name>.md`, then shells out to `python3 render_pdf.py <html>
  --output <pdf>`. **PDF failure is non-fatal** (`pdfOk:false`, HTML still written).
- **Markdown subset supported** (dependency-free parser): ATX headings `#`–`######`,
  `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, `-`/`*`/`+` and `1.` lists,
  `|`-tables with a `---` separator row, `---` horizontal rules, paragraphs. HTML is
  escaped (`& < >`) so data cannot break layout. Anything outside this subset renders as
  a literal paragraph — keep the template within the subset.
- **`mdToHtml(md, { title, subtitle })`** → a full self-contained HTML document with the
  Apple-flavored design tokens (gradient header, `#1d1d1f` text, `@page { size: Letter;
  margin: 14mm }`). Same visual language as the pre-audit template.

### PDF engine — `scripts/render_pdf.py`

Headless Chromium via Playwright Python (`page.pdf()`), Letter page. First-time setup:
`pip install playwright && python -m playwright install chromium`. If Playwright is
absent the spawn fails, `pdfOk` is false, and the skill links the HTML instead.
Page-size / margin behavior: https://playwright.dev/python/docs/api/class-page#page-pdf

---

## 2. The pricing source this skill reads — `config/services.json`

Loaded by `loadCatalog()`; the **only** source of prices, packages, and terms. Shape and
full schema are in `io-contract.md`. The script never invents a number — to change
pricing, edit the catalog. Required invariant: non-empty `packages[]` (else throw,
fail-closed). The agency block (`name`/`tagline`/`email`) and `terms` block are printed
verbatim into the document.

---

## 3. Where /proposal sits in the pipeline

```
/pre-audit  → prospect audited, findings in prospects/{slug}/synthesis.json
   │           (CRM deal typically at stage `audited`)
   ▼
/proposal  → THIS SKILL: price from catalog, render HTML+PDF,
   │           advance deal to `proposed`, set links.proposal
   ▼
/contract  → on acceptance: service agreement + e-sign, set links.contract,
   │           advance to `won` (won requires links.proposal — set here)
   ▼
/intake + /billing → onboard the client, issue the first Stripe invoice
```

`/crm` owns interactive pipeline management (add/move/list/forecast). `/proposal`,
`/contract`, and `/billing` are non-interactive writers that patch one deal each via the
shared `scripts/lib/crm-store.js`.

---

## 4. The crm-store contract — `scripts/lib/crm-store.js`

`/proposal` uses exactly two functions:

- **`getDeal(slug)`** → normalized deal object or `null`. Reads `crm/pipeline.json` (a
  JSON array), normalizes each row through `schemas/deal.js`.
- **`upsertDeal(slug, patch)`** → merges `patch` into the existing deal (or **creates** a
  bare deal `{ slug, company_name: slug }` if none exists), validates via
  `dealSchema.validate`, writes `pipeline.json`, and best-effort mirrors to the Supabase
  `deals` table. Returns the saved deal. **Throws** if validation fails.

Merge semantics: `links` and `deal` are shallow-merged (existing keys preserved);
`activities` must be supplied as the full new array (the script spreads prior activities
and appends one). `crm-store` is the *only* place that touches `pipeline.json` + the
Supabase mirror — do not write the file directly from the skill.

---

## 5. Deal state machine — `schemas/deal.js`

```
STAGES = lead → contacted → audited → proposed → negotiating → won → lost → churned

TRANSITIONS:
  lead        → contacted, audited, proposed, lost
  contacted   → audited, proposed, negotiating, lost
  audited     → proposed, negotiating, lost
  proposed    → negotiating, won, lost
  negotiating → won, lost
  won         → churned
  lost        → contacted        (re-engage)
  churned     → contacted        (win back)

STAGE_PROBABILITY: lead 10, contacted 20, audited 35, proposed 55,
                   negotiating 75, won 100, lost/churned 0
```

- `isValidTransition(from, to)` → boolean (`from === to` is allowed, idempotent).
  `/proposal` calls it as `isValidTransition(current, "proposed")`; if false and
  `current !== "proposed"`, the stage is left unchanged and only `links.proposal` is set.
- Validation rule that makes the proposal link load-bearing: **a `won` deal must carry
  `links.proposal`** — so `/proposal` setting the link even on later stages is what later
  lets `/contract` mark the deal `won`.

---

## 6. Handoff files

| Direction | File / field | Meaning |
|-----------|--------------|---------|
| In (optional) | `prospects/{slug}/synthesis.json` / `page_audit.json` | `/pre-audit` findings (wins/gaps) |
| In | `crm/pipeline.json` deal row | company name, retainer estimate, current stage |
| In | `config/services.json` | package + pricing catalog |
| Out | `proposals/{slug}/proposal.{md,html,pdf}` | the deliverable |
| Out | deal `links.proposal` | PDF path (or HTML if PDF skipped) |
| Out | deal `stage` | `proposed` (when transition valid) |
| Out | deal `activities[]` | appended `proposal` activity |

---

## 7. Supabase mirror (best-effort)

`upsertDeal` mirrors to the Supabase `deals` table via `scripts/lib/supabase.js`
`upsert("deals", {...}, "slug")`, but only if `supabaseConfigured()` is true. Failure is
swallowed — `crm/pipeline.json` is the authoritative source. Credentials come from env
via `loadEnv()`; never hardcode.

---

## Keeping current

- Renderer changes (Markdown subset, design tokens) live in `scripts/lib/md_to_html.js` —
  this skill consumes them, never duplicates them.
- If `STAGES`/`TRANSITIONS` change in `schemas/deal.js`, update §5 here and the matrix in
  `domain-standards.md`.
- Downstream skills (`/contract`, `/intake`, `/billing`) own their own contracts — do not
  duplicate them; link by `links.contract` / `links.client_profile`.
- Re-verify the Playwright + downstream doc URLs against `skills/references-shared.md`.

**Last verified:** 2026-06-22
