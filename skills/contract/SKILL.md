---
name: contract
description: Use this skill to generate a client service agreement from an accepted proposal and optionally send it for e-signature, then record the signature as a closed-won deal. This skill should be used when drafting, sending, or marking-signed a Meta-advertising retainer agreement (typically via `/contract {slug}`, `/contract {slug} --send`, or `/contract {slug} --mark-signed`). It renders the agreement (parties, services, fees, term, payment, cancellation, IP, confidentiality, liability, signature block) as HTML+PDF from the CRM deal and service catalog, advances the deal `proposed → negotiating` on generate, optionally e-signs via Dropbox Sign (fail-closed to manual), and on signature moves the deal to `won`. Phase 5 Agency-OS skill — the bridge from proposal to signed client.
---

# /contract — Service Agreement Generator (Phase 5 · Agency OS)

Close the deal. This skill reads the CRM deal and the service catalog, renders a service
agreement (HTML+PDF) from the same package `/proposal` quoted, optionally sends it for
e-signature, and records the win — which unblocks `/intake` and `/billing`. It runs the
deterministic companion `skills/contract/contract.js`.

> **Not legal advice.** The agreement is a template. A qualified attorney must review it
> before sending — the Markdown, HTML, and PDF all carry that disclaimer, and the CLI
> repeats it. Same honesty principle as the trademark step in `/brand-name`.

## What This Skill Does

- Re-derive the package from the deal's retainer (or an explicit `--package <id>`) via the shared catalog helpers.
- Render the agreement Markdown (10 numbered sections) and write `agreement.md` + `.html` + `.pdf`.
- Advance the CRM deal `proposed → negotiating` on generate and set `links.contract`.
- Optionally send for e-signature (`--send`) via Dropbox Sign — fail-closed to a manual signature block on any missing key, missing contact email, or provider error.
- Record a received signature (`--mark-signed`): move the deal to `won`, stamp `won_at`, and log the activity.
- Log every action (generate / sign) onto the CRM deal's activity trail.

## What This Skill Does NOT Do

- Write the proposal or choose the package narrative / pricing — `/proposal` owns that.
- Manage pipeline stages interactively or create the deal record — `/crm` owns that.
- Issue retainer invoices or take payment — `/billing` owns that.
- Onboard the client / create the client profile after `won` — `/intake` owns that.
- Provide binding legal text or legal review — out of scope; an attorney must review the template.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/crm-store.js` (`getDeal`, `upsertDeal`), `schemas/deal.js` (`isValidTransition`, `validate`), `skills/proposal/proposal.js` (`loadCatalog`, `pickPackage`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`) |
| **Conversation** | The `{slug}`; whether to `--send` now; an explicit `--package` override |
| **Skill References** | Domain rules + I/O schemas in `references/` (see table below) |
| **Client Profile** | `crm/pipeline.json` deal (company, contact name/email, `deal.monthly_retainer`, `currency`, `links.proposal`); `config/services.json` (agency block, package scope, terms) |

## Clarifications

> Before asking: check the conversation, the CRM deal (`crm/pipeline.json`), and `config/services.json`.
> Only ask for what cannot be determined. Domain knowledge (clause text, attorney-review
> requirement, e-sign field shapes) is embedded in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}` (the deal must already exist via `/crm`/`/proposal`).

**Optional (ask only if relevant):**
2. Whether to e-sign now (`--send`) or generate locally for manual sending.
3. A package override (`--package starter|growth|scale`) if the deal retainer should not drive selection.
4. Whether this run records a received signature (`--mark-signed`).

## Workflow

1. Resolve the deal via `getDeal(slug)`; halt (exit 2) if none exists.
2. **`--mark-signed`:** require `links.contract` (exit 3); require a valid transition to `won` (exit 4); on success set `stage=won`, stamp `won_at`, log activity, print JSON, and stop.
3. **Generate (default):** load the catalog; pick the package with `pickPackage(catalog, { packageId, retainer: deal.deal.monthly_retainer })`.
4. Build the agreement Markdown via `buildContractMarkdown(...)`; write `agreement.md`, then `writeHtmlAndPdf(...)` for `.html` + `.pdf`.
5. Advance `proposed → negotiating` if the state machine allows; set `links.contract` (PDF path if rendered, else HTML); log activity.
6. **`--send`:** call `sendForSignature(...)`; if a `DROPBOX_SIGN_API_KEY` and contact email exist, attempt a real send; otherwise (or on any error) return a manual result.
7. Print a single JSON object with paths, CRM stage, e-sign result, the disclaimer, and the next step.

## Input / Output Specification

**Inputs:** positional `<slug>`; flags `--package <id>`, `--send`, `--mark-signed`; reads `crm/pipeline.json`, `config/services.json`; env `DROPBOX_SIGN_API_KEY` (optional).
**Outputs:** `contracts/{slug}/agreement.md` + `.html` + `.pdf`; mutated CRM deal (`stage`, `links.contract`, `won_at`, `activities`) in `crm/pipeline.json` + best-effort Supabase `deals` mirror; one JSON object on stdout.
(Full schemas, example payloads, and exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Company, contact name/email, retainer, currency, chosen package | The 10-section agreement structure + clause wording |
| Package scope (`includes`), fees, term/payment/cancellation text (from `config/services.json`) | Attorney-review disclaimer always present; e-sign fail-closed to manual |
| Whether e-sign runs and which provider key is set | `proposed → negotiating` on generate; `won` only via `--mark-signed` |
| Deal's current stage / transition legality | `won` requires `links.proposal` (enforced by `schemas/deal.js`) |

## Domain Standards

### Must Follow
- [ ] Every rendered artifact (md/html/pdf) carries the "not legal advice — attorney review required" disclaimer.
- [ ] Re-derive fees from the deal retainer (override) or catalog package — never invent pricing.
- [ ] Only advance stages through `dealSchema.isValidTransition`; never force a deal to `won` outside `--mark-signed`.
- [ ] Treat e-sign as best-effort: a non-2xx, missing key, or missing email must fall back to manual, not claim success.
- [ ] Verify the live Dropbox Sign payload before the first real send (see "verify before first send" note below).

### Must Avoid
- Representing the template as binding or attorney-reviewed legal text.
- Marking a deal `won` without `links.proposal` and `links.contract` on file.
- Logging or echoing the `DROPBOX_SIGN_API_KEY`.
- Hardcoding agency name, pricing, or terms in the skill — they live in `config/services.json`.

### Output Checklist (verify before delivery)
- [ ] `agreement.md`, `.html`, and `.pdf` exist (or PDF gracefully skipped with a note when Playwright is absent).
- [ ] `links.contract` points at the PDF when rendered, else the HTML.
- [ ] CRM stage is `negotiating` after generate (or unchanged if the transition was illegal) / `won` after `--mark-signed`.
- [ ] The JSON result includes the disclaimer and the correct next step.

## Error Handling

| Scenario | Action |
|----------|--------|
| No `{slug}` argument | Print usage, exit 1 |
| No CRM deal for slug | Print "run /crm add … (and /proposal) first", exit 2 |
| `--mark-signed` with no `links.contract` | Print "run /contract first", exit 3 |
| `--mark-signed` from a stage that can't reach `won` | Print the blocking stage, exit 4 |
| `won` validation fails (e.g. no `links.proposal`) | Surface `deal invalid` errors from schema, exit 5 |
| Unknown `--package` id | `pickPackage` throws with the available ids; FATAL exit 1 |
| `config/services.json` missing / no packages | `loadCatalog` throws; FATAL exit 1 |
| Dropbox Sign missing key / no contact email / non-2xx / network error | Return manual fallback result (no crash), `mode: "manual"` |
| Playwright not installed | PDF skipped, HTML still written, JSON notes "(PDF skipped — install playwright)" |

## Dependencies & Security

- **Reuses:** `scripts/lib/crm-store.js`, `schemas/deal.js` (via `schemas/index.js`), `skills/proposal/proposal.js` (`loadCatalog`/`pickPackage`), `scripts/lib/md_to_html.js`, `scripts/lib/load-env.js`.
- **External APIs:** Dropbox Sign REST v3 (`POST https://api.hellosign.com/v3/signature_request/send`) — optional, fail-closed. Rate limits + field shapes in `references/api-reference.md`.
- **Secrets:** `DROPBOX_SIGN_API_KEY` resolved from env via `loadEnv()`; sent as HTTP Basic auth; never hardcoded or logged.
- **Runtime:** Node ESM; PDF rendering needs Playwright Chromium (`pip install playwright && python -m playwright install chromium`).

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Dropbox Sign — Signature Request docs | https://developers.hellosign.com/api/signature-request | All signature-request endpoints (send, list, get, status) |
| Dropbox Sign — Developer docs home | https://developers.hellosign.com/ | Auth, base host `api.hellosign.com`, `test_mode` |
| Dropbox Sign — Send (REST endpoint) | https://api.hellosign.com/v3/signature_request/send | The exact POST endpoint this skill calls |

> **Host-rename caveat (verify before first send):** the v3 host `api.hellosign.com` and
> the `developers.hellosign.com` docs are the **legacy/transitional HelloSign domain**
> retained after the Dropbox Sign rename — they may be redirected or deprecated in favor
> of a Dropbox-branded host. Before the **first real e-sign send**, re-confirm the live
> host, auth scheme, and the multipart field names against the current docs above; the
> embedded `references/api-reference.md` documents the field shapes but flags them as
> unverified against production. The skill fail-closes to a manual signature block on any
> mismatch, so an outdated host degrades safely rather than silently dropping the request.

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22 (Dropbox Sign host may change after the HelloSign rename — re-verify before the first production send.)

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Agreement clause taxonomy, fee/term sourcing rules, stage-transition rules, attorney-review policy, good/bad clause examples |
| `references/api-reference.md` | Dropbox Sign v3 endpoint, auth, multipart fields, status codes, rate limits, fail-closed contract, verify-before-first-send checklist |
| `references/io-contract.md` | Full CLI flag matrix, deal/catalog input schemas, output JSON schema, exit codes, example payloads, edge cases |
</content>
</invoke>
