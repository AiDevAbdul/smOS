---
name: proposal
description: Use this skill to generate a branded client proposal (HTML + PDF) for an audited prospect, price it from the agency service catalog, and advance the prospect's CRM deal to `proposed`. This skill should be used when the user wants to pitch, propose, or send pricing to a prospect — typically via `/proposal {slug}` — turning a `/pre-audit` finding into a sales-ready document. Phase 5 Agency-OS skill; the bridge from audited prospect to signed client.
---

# /proposal — Client Proposal Generator (Phase 5 · Agency OS)

<!-- KEEP LEAN (<200 lines). Heavy domain knowledge, full schemas, examples → references/. -->

Turn an audited prospect into a sales-ready proposal and move the deal forward. Pricing
comes from the **service catalog** (`config/services.json`); the situation comes from
**`/pre-audit`** output; the result links straight into the **CRM** deal record so the
deal can later be marked `won`.

The proposal is the **opportunity-led Phase-2 document — the sibling of the `/pre-audit`
report**. It is built as **structured HTML on the shared smOS design system** (canonical
`ds-hero` + `ds-*` components + a proposal-specific stylesheet built on `--ds-*` tokens),
then rendered to PDF. A Markdown twin is also written for portability (email paste), but
the HTML is the primary deliverable — do **not** render the client proposal through the
generic `mdToHtml` path (that produced a duplicate `<h1>`, literal `_italics_`, an empty
hero, and an unstyled body). Template exemplar: `templates/proposal-report.html`.

## What This Skill Does

- Load the agency service catalog and select a recommended package: explicit `--package`, else the tier whose `monthly_retainer` is closest to the deal's stored retainer, else `growth` (else the first package).
- Pull the prospect's `/pre-audit` findings to ground the document, and derive a **Phase-1 snapshot** (`extractSnapshot`: score, upside = 100 − score, follower count, competitor-outspend ratio) so Phase 2 quotes Phase 1 verbatim — same numbers, no contradiction.
- Render a structured, opportunity-led HTML proposal (hero → continuity recall band → wins/gaps → tiered pricing → ROI band → how-we-work → 30/60/90 roadmap → terms → accept + signature block) directly on the design system, plus a Markdown twin, plus PDF.
- Present pricing as a **"start here → step up" tier pair** (`pickTierPair`): the recommended tier is featured, paired with the tier below it (entry) when one exists — so greenfield prospects see a channel-proving entry point before scaling.
- Advance the CRM deal to `proposed` (only if the deal state machine allows from the current stage) and set `links.proposal`.
- Emit a JSON summary to stdout (slug, company, package, monthly price, file paths, CRM result).

## What This Skill Does NOT Do

- **Does not invent pricing.** Tiers/terms live in `config/services.json` — edit the catalog, not the script.
- **Does not run the prospect audit** — that is `/pre-audit` (owns `prospects/{slug}/synthesis.json`).
- **Does not manage the pipeline interactively** (add/move/list/forecast deals) — that is `/crm`.
- **Does not produce the legal agreement or e-sign** — that is `/contract` (sets `links.contract`, marks `won`).
- **Does not issue invoices** — that is `/billing` (Stripe).
- **Does not force an out-of-order stage jump** — an invalid transition leaves the stage unchanged; only the proposal link is set.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable).
**On a cold start, read `references/domain-standards.md` before the first run** — it carries
the package taxonomy, selection precedence, and stage-transition rules this skill assumes.

| Source | Gather |
|--------|--------|
| **Codebase** | `config/services.json` (catalog), `scripts/lib/crm-store.js` (`getDeal`/`upsertDeal`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`), `schemas/deal.js` (stages + `isValidTransition`) |
| **Conversation** | Which `{slug}`; any package the user already named; whether to skip CRM |
| **Skill References** | Package taxonomy + transition rules from `references/` (read `domain-standards.md` before first run) |
| **CRM Deal** | `crm/pipeline.json` row for `{slug}` (`company_name`, `deal.monthly_retainer`, `stage`) — auto-created if absent |
| **Pre-audit** | `prospects/{slug}/synthesis.json` or `page_audit.json` (optional findings) |

## Clarifications

> Before asking: check the conversation, the CRM deal, and the prospect's `/pre-audit` output.
> Only ask for what cannot be determined. Package/pricing knowledge is embedded in
> `config/services.json` + `references/` — never ask the user to recite catalog pricing.

**Required (must resolve before running):**
1. Which prospect `{slug}` is this proposal for?

**Optional (ask only if relevant):**
2. Force a specific package tier instead of the inferred one? (`--package starter|growth|scale`)
3. Generate the document only, without touching the CRM pipeline? (`--no-crm`)

## Workflow

1. Resolve `{slug}` from the user's request.
2. Run `node skills/proposal/proposal.js {slug} [--package <id>] [--no-crm]`.
3. The script loads the catalog, reads the deal (`getDeal`), picks the package + tier pair, loads `/pre-audit` findings and derives the Phase-1 snapshot, builds the structured HTML (`buildProposalHtml`) + Markdown twin, and writes `proposal.md` + `.html` + `.pdf` (PDF via `scripts/render_pdf.py`).
4. Unless `--no-crm`, it advances the deal to `proposed` (if the transition is valid) and sets `links.proposal` to the PDF (or HTML if PDF was skipped).
5. Relay the JSON summary: package chosen, monthly price, artifact paths, CRM stage change, and the next step (`/contract`, then `/intake` + `/billing`).

## Input / Output Specification

**Inputs:** positional `{slug}`; flags `--package <id>`, `--no-crm`. Files read: `config/services.json`, `crm/pipeline.json`, optional `prospects/{slug}/{synthesis,page_audit}.json`.
**Outputs:** `proposals/{slug}/proposal.md` + `.html` + `.pdf`; updated `crm/pipeline.json` deal (`stage=proposed`, `links.proposal`, appended `proposal` activity); best-effort Supabase `deals` mirror; JSON summary to stdout.

Example stdout summary (full schemas + payloads: `references/io-contract.md`):

```json
{
  "slug": "acme", "company": "Acme Co", "package": "growth",
  "monthly": "USD 2800",
  "html": "/…/proposals/acme/proposal.html",
  "pdf": "/…/proposals/acme/proposal.pdf",
  "used_pre_audit": true,
  "crm": { "stage": "proposed", "proposal_link": "proposals/acme/proposal.pdf", "stage_changed": true },
  "next": "Send to the prospect. On signature: /contract, then /intake + /billing."
}
```

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill / code) |
|--------------------------------|-------------------------------------------|
| Slug, company name, deal retainer | Package-selection precedence (explicit → closest-retainer → `growth` → first) |
| Package tiers, prices, terms (in `config/services.json`) | Proposal section structure + order |
| Pre-audit wins/gaps + snapshot (score/upside/followers/outspend), or generic fallback | The "How we work" narrative + generic-opportunity fallback sentences (intentional CONSTANT — fixed agency boilerplate hardcoded in `buildProposalHtml`/`buildProposalMarkdown`; if it must vary per agency, externalize into `services.json` rather than editing the script) |
| Whether the recall band + hero pills render (needs a `/pre-audit` snapshot) | Section order + the opportunity-led HTML structure on the design system (never fork the hero; never inline raw hex) |
| Currency, setup fee (from catalog) | CRM transition gated by `schemas/deal.js` state machine |
| Whether `/pre-audit` ran | Output template-filled, never blank-page generated; always ships HTML + PDF |
| Whether Supabase is configured | Deal auto-created if absent; out-of-order stage left unchanged |

## Domain Standards

### Must Follow
- [ ] Source every price from `config/services.json` — a per-deal `monthly_retainer > 0` overrides the catalog price for the headline figure only (setup fee + currency always come from the package).
- [ ] **Address the client, not the agency.** The title and hero are for the prospect's company (`A growth engine for {company}`), never the sender's name.
- [ ] **Carry Phase 1 verbatim.** Reuse the `/pre-audit` snapshot numbers (score, upside, followers, outspend) exactly; the proposal must never contradict the audit it follows (e.g. don't claim "greenfield / no competitors" when the audit found competitors advertising).
- [ ] **Build on the design system.** Render structured HTML via `buildProposalHtml` (canonical `ds-hero`, `ds-*` components, proposal CSS on `--ds-*` tokens). Never route the client proposal through the generic `mdToHtml`; never hand-roll a hero or inline raw hex.
- [ ] **Translate internal jargon.** Client-facing copy says "you approve before spend" / "every change is logged" — never leaks `smOS`, `PAUSED`, `fbq`, API terms, etc.
- [ ] **Close hard.** Always include the accept CTA + a signature/date block + a validity date.
- [ ] Respect the deal state machine: only set `stage=proposed` when `isValidTransition(current, "proposed")` (or already `proposed`).
- [ ] Always write all three artifacts (`.md`, `.html`, `.pdf`); link the PDF if it rendered, else the HTML.
- [ ] Append a `proposal`-type activity stamped with ISO time on every CRM write.

### Must Avoid
- Hardcoding or improvising prices, packages, or terms in the document.
- Contradicting the `/pre-audit` findings, or drifting from its numbers (follower count, competitor counts, score).
- Exposing internal system/jargon or engineering terms in the client-facing document.
- A weak close (no signature block, "reply to approve" only) or a title named after the agency/sender.
- Overwriting a later-stage deal (e.g. `negotiating`/`won`) back to `proposed`.
- Treating a missing `/pre-audit` as a fatal error — use the generic opportunity framing (recall band + hero pills simply omit).

### Output Checklist (verify before delivery)
- [ ] Hero + title address the client company; exactly one `<h1>`; no literal `_`/`*` markdown emphasis leaked into the body.
- [ ] When `/pre-audit` ran: recall band + hero pills show the Phase-1 score, upside, followers and outspend — matching the audit.
- [ ] Recommended package name + monthly price + setup fee are present and match the catalog; the tier pair reads as "start → step up".
- [ ] Opportunity (wins/gaps), ROI band, 30/60/90 roadmap, terms, and the accept + signature block all render.
- [ ] `links.proposal` points at an artifact that exists on disk.
- [ ] JSON summary reports `crm.stage` and whether the stage changed.

## Error Handling

| Scenario | Action |
|----------|--------|
| No `{slug}` argument | Print usage, exit 1 — never guess the prospect |
| `config/services.json` missing | Throw "scaffold the service catalog first" — fail closed, do not fabricate pricing |
| `services.json` has no `packages` | Throw "services.json has no packages" — halt |
| `--package <id>` not in catalog | Throw listing available ids — halt, do not silently pick another |
| `/pre-audit` output absent/unparsable | Continue with generic opportunity framing (non-fatal) |
| PDF render fails (no Playwright) | Non-fatal: ship HTML, link HTML, summary notes "PDF skipped — install playwright" |
| Deal invalid on save | `upsertDeal` throws schema errors; caught and returned as `crm.error` — document still ships |
| Out-of-order CRM stage | Leave stage unchanged, still set `links.proposal`; `stage_changed: false` |
| Supabase unreachable | Mirror is best-effort; local `pipeline.json` is the source of truth |

## Dependencies & Security

- **Reuses:** `scripts/lib/crm-store.js` (`getDeal`, `upsertDeal`), `scripts/lib/design_system.js` (`reportHead`, `heroHeader`, `reportFooter` — the shared Cupertino system + canonical hero), `scripts/render_pdf.py` (headless-Chromium PDF), `scripts/lib/load-env.js`, `schemas/deal.js` (`isValidTransition`, `validate`, `normalize`), `config/services.json`. (No longer uses `md_to_html.js` for the client HTML — that generic path is only for internal markdown reports.)
- **External APIs:** none directly. Supabase mirror is best-effort via `scripts/lib/supabase.js`; PDF render shells out to `render_pdf.py` (headless Chromium / Playwright).
- **Secrets:** Supabase URL/service key resolved from env via `loadEnv()` — never hardcoded or logged. No Meta/Stripe tokens used here.
- **First-time PDF setup:** `pip install playwright && python -m playwright install chromium`.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| smOS shared `md_to_html` / `render_pdf` helper | `scripts/lib/md_to_html.js` + `scripts/render_pdf.py` (in-repo) | THIS skill's own renderer: Markdown subset, Apple-design HTML, Letter-page PDF via Chromium — the contract `writeHtmlAndPdf` honors |
| Service catalog schema (`config/services.json`) | `references/io-contract.md` (in-repo) | THIS skill's own pricing source of truth — agency/packages/terms shape it reads |
| Playwright Python (PDF engine) | https://playwright.dev/python/docs/api/class-page#page-pdf | The headless-Chromium `page.pdf()` call `render_pdf.py` invokes; page size / margins |
| WCAG 2.1 SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | 4.5:1 / 3:1 contrast for the HTML/PDF deliverable's color tokens |
| Stripe Invoices (downstream, `/billing`) | https://docs.stripe.com/api/invoices | What `/billing` issues after a proposal is signed (handoff, not called here) |
| Dropbox Sign — Signature Request (downstream, `/contract`) | https://developers.hellosign.com/api/signature-request | What `/contract` fires for e-sign after acceptance (handoff, not called here) |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-07-16 (opportunity-led HTML renderer + Phase-2 continuity)

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Package taxonomy, selection precedence, pricing rules, CRM transition matrix, proposal-section anatomy, the hardcoded-copy CONSTANT note, good/bad examples. Read before first run. |
| `references/api-reference.md` | This skill's "API" surface: the `crm-store` + `md_to_html`/`render_pdf` helper contracts, the deal state machine, Supabase mirror, and upstream/downstream skill handoffs |
| `references/io-contract.md` | Full catalog + deal + findings JSON schemas, example payloads, edge-case handling, stdout summary shape |
