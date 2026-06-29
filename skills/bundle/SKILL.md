---
name: bundle
description: Use this skill to assemble all of a client's existing client-facing reports into ONE shareable web hub — a numbered "client journey" roadmap (Pre-Audit → Audit → Research → Strategy → Audience → Creative → Content Plan → Performance Reports) with a button per phase that opens each report. This skill should be used when the user asks to bundle, package, or share all reports as a single link/page for a client, typically via `/bundle {slug}`. It copies the rendered HTML into `public/reports/{slug}/` and writes the hub `index.html`; deploy is a separate, explicit step.
---

# /bundle — Single Shareable Client Deliverables Hub (Phase 5+)

Turn a client's scattered deliverables into one link. `/bundle` is a **pure assembler**:
it collects the client-facing HTML that other skills already rendered, copies each into
`public/reports/{slug}/`, and writes a numbered phase roadmap `index.html` (bold circular
step badges + an "Open" button per phase). The shareable link is `/reports/{slug}/`.

## What This Skill Does

- Walk a fixed client-journey manifest and resolve each phase's rendered HTML (newest wins).
- Copy each resolved report into `public/reports/{slug}/` under a normalized `{NN}-{phase}.html` name.
- Render the hub `index.html` using the design-system `ds-roadmap` component (numbered steps).
- Show missing phases as muted "In progress" steps so the client sees the full arc (suppress with `--only-ready`).
- Update the `public/reports/index.json` manifest with a `{type:"bundle"}` entry (de-duped per slug).
- Print a JSON summary: hub path, public URL, included/missing phases, deploy hint.

## What This Skill Does NOT Do

- **Re-render or re-derive any report** — each report is owned by its skill (`/audit`, `/research`, `/strategy-brief`, `/audience-map`, `/creative`, `/content-plan`, `/report`, `/monthly-review`, `/before-after`, `/pre-audit`). Run those first.
- **Produce a merged PDF** — the deliverable is a web hub; individual reports keep their own PDFs.
- **Deploy or host** — it only writes files into `public/`. Deploy is a separate, explicit step (`vercel deploy --prod`), per the constitution's "confirm outward-facing actions" rule.
- **Aggregate live metrics or commercial data** — that white-label dashboard is `/portal`.
- **Touch the Meta API or any live service** — fully offline-safe.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/bundle/bundle.js`; `scripts/lib/design_system.js` (`reportHead`/`heroHeader`/`reportFooter`); `scripts/lib/load-env.js`; `design-system/smos-design-system.css` (`ds-roadmap`/`ds-btn`) |
| **Conversation** | The `{slug}`; whether to show the full journey or `--only-ready` |
| **Skill References** | Phase manifest + file resolution + output paths (`references/io-contract.md`); journey rationale (`references/domain-standards.md`) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `business.name`; `config/services.json` → `agency.name` |

## Clarifications

> Before asking: check the conversation, the client profile, and what reports already exist
> in `clients/{slug}/` + `clients/{slug}/reports/`. Only ask for what cannot be determined.

**Required (must resolve before running):**
1. Which client `{slug}`? (Must have `clients/{slug}/client_profile.json` from `/intake`.)

**Optional (ask only if relevant):**
2. Show the full start→end journey with muted "In progress" steps (default), or only
   ready reports (`--only-ready`)?

## Workflow

1. Run `node skills/bundle/bundle.js <slug> [--only-ready]`.
2. The script HALTS (exit 3) if `client_profile.json` is missing — never blank-page generate.
3. It resolves each journey phase, copies hits into `public/reports/{slug}/`, and writes the hub `index.html`.
4. It updates `public/reports/index.json` and prints the summary (included/missing phases, public URL).
5. Review the hub locally (open `public/reports/{slug}/index.html`), then — only with the
   user's go-ahead — `vercel deploy --prod` and share the `share_url`. All client hubs
   live under one neutral Vercel project (**`smos-reports`**, repo-linked via `.vercel/`);
   each client is its own path: `https://smos-reports.vercel.app/reports/{slug}/`. One
   deploy ships every client. (Override the base with `SMOS_REPORTS_BASE_URL`.)

## Input / Output Specification

**Inputs:** `<slug>` arg; existing rendered HTML under `clients/{slug}/`, `clients/{slug}/reports/`, `prospects/{slug}/`, and previously-published `public/reports/{slug}/`.
**Outputs:** `public/reports/{slug}/index.html` (the hub) + copied `{NN}-*.html` reports; updated `public/reports/index.json`.
(Full manifest, resolution rules, exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Which reports exist; client/agency name; dates | Journey phase order; file-resolution rules; `ds-roadmap` markup; output paths |

## Domain Standards

### Must Follow
- [ ] Pure assembler — copy only; never regenerate a report.
- [ ] Use the `ds-roadmap` / `ds-btn` design-system classes — never hand-roll CSS.
- [ ] Self-contained copies only (reports already inline their CSS) — no external asset rewriting.
- [ ] Deploy stays a separate, explicit step — the skill never auto-publishes.

### Must Avoid
- Fabricating a phase that has no rendered file (show it muted instead).
- Adding cross-currency or live-metric aggregation (that is `/portal`).

### Output Checklist (verify before delivery)
- [ ] Hub `index.html` written; numbered steps 1..N render; present phases have working relative-link buttons.
- [ ] `public/reports/index.json` has a valid, de-duped `bundle` entry for the slug.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Halt (exit 3), name the path — run `/intake` first |
| No reports resolved at all | Still writes the hub (all steps muted) — surfaces that nothing is ready yet |
| Missing one phase | Render it as a muted "In progress" step (or skip with `--only-ready`) |

## Dependencies & Security

- **Reuses:** `scripts/lib/design_system.js`, `scripts/lib/load-env.js`, `config/services.json`, `design-system/smos-design-system.css`.
- **External APIs:** none. Deploy uses the Vercel CLI against the existing `vercel.json` (`outputDirectory: public`).
- **Secrets:** none read or logged; offline-safe.

**Last verified:** 2026-06-29

## Reference Files

| File | When to Read |
|------|--------------|
| `references/io-contract.md` | Phase manifest, file-resolution rules, normalized names, output paths, manifest schema, exit codes |
| `references/domain-standards.md` | Client-journey rationale, muted-vs-active rule, design-system component usage |
