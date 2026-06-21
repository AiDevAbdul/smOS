---
name: contract
description: Use this skill to generate a client service agreement from an accepted proposal and (optionally) send it for e-signature (typically via `/contract {slug}`). Builds an HTML+PDF agreement from the deal + service catalog, advances the CRM deal to `negotiating`, and on signature moves it to `won`. Phase 5 Agency-OS skill; the bridge from proposal to signed client.
---

# /contract — Service Agreement Generator (Phase 5 · Agency OS)

Closes the deal. Generates the agreement from the same catalog and deal record `/proposal` used, sends it for signature, and records the win — which unblocks `/intake` + `/billing`.

> **Not legal advice.** The agreement is a template. Have a qualified attorney review it before sending — the output and PDF both say so. (Same honesty principle as the trademark step in `/brand-name`.)

## Required Context

- `crm/pipeline.json` — the deal must exist and should be `proposed`/`negotiating` with `links.proposal` set
- `config/services.json` — agency details, package scope, and terms
- Optional: `DROPBOX_SIGN_API_KEY` for real e-signature sends

## Workflow

1. **Generate** (`/contract {slug}`):
   - Re-derives the package from the deal's retainer (or `--package <id>`).
   - Renders the agreement (parties, services, fees, term, payment, cancellation, IP, confidentiality, liability, signature block) to **HTML + PDF**.
   - Advances the CRM deal `proposed → negotiating` and sets `links.contract`.
2. **Send for signature** (`--send`):
   - With `DROPBOX_SIGN_API_KEY` set, attempts a real e-sign send to the deal's contact email; otherwise returns a manual result (send the PDF yourself). Fail-closed — any provider error falls back to manual rather than claiming success.
3. **Record signature** (`--mark-signed`):
   - Moves the deal to `won` (the validator requires `links.proposal`, so a deal can't be won without the paper trail) and stamps `won_at`.

## Running

```
node skills/contract/contract.js {slug}                 # generate + link, deal → negotiating
node skills/contract/contract.js {slug} --send          # also send for e-signature
node skills/contract/contract.js {slug} --mark-signed   # signature received → deal won
node skills/contract/contract.js {slug} --package scale # force a package
```

## Output

- `contracts/{slug}/agreement.md` + `.html` + `.pdf`
- CRM deal → `negotiating` (on generate) → `won` (on `--mark-signed`), `links.contract` set

## Handoffs

- `/proposal` → run first; the deal should be `proposed` with `links.proposal`
- On `won` → `/intake` to onboard the client, then `/billing` to invoice the retainer

## Safety

- Agreement is a reviewed-by-attorney template, never represented as binding legal text.
- E-sign is best-effort and fail-closed to manual.
- The `won` transition reuses the deal validator — no win without a proposal on file.
