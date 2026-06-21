---
name: proposal
description: Use this skill to generate a branded client proposal / pitch (typically via `/proposal {slug}`). Builds an HTML+PDF proposal from the service catalog (config/services.json) + the prospect's /pre-audit findings, recommends a package, and advances the CRM deal to `proposed` with the artifact linked. Phase 5 Agency-OS skill; the bridge from audited prospect to signed client.
---

# /proposal — Client Proposal Generator (Phase 5 · Agency OS)

Turns an audited prospect into a sales-ready proposal and moves the deal forward. Pricing comes from the **service catalog** (`config/services.json`), the situation comes from **`/pre-audit`** output, and the result links straight into the **CRM** deal.

## Required Context

- `config/services.json` — the agency's package/pricing catalog (edit this, not the script)
- `crm/pipeline.json` — the deal (company name + retainer estimate); created if absent
- `prospects/{slug}/synthesis.json` or `page_audit.json` (optional) — `/pre-audit` findings to ground the "opportunity" section

## Workflow

1. Load the catalog and the CRM deal.
2. **Pick the recommended package:** `--package <id>` if given, else the tier closest to the deal's retainer estimate, else `growth`. A per-deal retainer overrides the catalog price.
3. Pull the prospect's situation from `/pre-audit` output if it ran (wins + gaps); otherwise use a generic opportunity framing.
4. Render the proposal to **HTML + PDF** via the shared `writeHtmlAndPdf` helper (same design language as every report).
5. **Advance the CRM deal to `proposed`** (only if the state machine allows from its current stage) and set `links.proposal` — this is what lets the deal later be marked `won`.

## Running

```
node skills/proposal/proposal.js {slug} [--package growth] [--no-crm]
```

- `--package` — force a tier (`starter|growth|scale` or whatever's in the catalog)
- `--no-crm` — generate the doc without touching the pipeline

## Output

- `proposals/{slug}/proposal.md` + `.html` + `.pdf`
- CRM deal moved to `proposed` with `links.proposal` set

## Handoffs

- `/pre-audit` → run first so the opportunity section is grounded in real findings
- `/crm` → the deal must exist (or is auto-created); proposal sets `stage=proposed`
- On signature → `/contract` (links.contract), then `/intake` + `/billing`

## Safety

- Pricing is never invented — it comes from `config/services.json`. Edit the catalog to change tiers.
- The CRM transition respects the deal state machine; an out-of-order stage is left unchanged (only the proposal link is set).

## Token Efficiency

- The proposal is template-filled from the catalog + pre-audit findings, not blank-page generated.
- First-time PDF setup: `pip install playwright && python -m playwright install chromium`.
