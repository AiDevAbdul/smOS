---
name: billing
description: Use this skill to issue monthly retainer invoices for a won/active client and track them in a per-client ledger. This skill should be used when issuing, listing, or marking paid an agency retainer invoice (typically via `/billing {slug} invoice`, `/billing {slug} list`, or `/billing {slug} mark-paid`). It builds an invoice (retainer + first-month setup fee + optional ad-spend pass-through) as HTML+PDF, enforces per-period idempotency to prevent double-billing, optionally sends via Stripe (fail-closed to a local/manual invoice), and logs the activity to the CRM deal.
---

# /billing — Retainer Invoicing (Phase 5 · Agency OS)

Turn a `won` deal into recurring revenue. This skill reads the deal's retainer terms and the
service catalog, issues a per-period invoice (HTML+PDF), and tracks it in a ledger the client
portal can read. It runs the deterministic companion `skills/billing/billing.js`.

## What This Skill Does

- Build a monthly retainer invoice for a period (`YYYY-MM`): retainer line, one-time setup fee on the first invoice, optional ad-spend pass-through line.
- Enforce per-period idempotency — one invoice per client per month; block a re-issue unless `--force`.
- Optionally send via Stripe (`--send`): create customer + invoice items + invoice, finalize, return the hosted pay link. Fail-closed to a local/manual invoice on any error or missing key.
- Maintain a per-client ledger (`billing/{slug}/ledger.json`) and emit invoice HTML + PDF.
- List the ledger (`list`) with issued / paid / outstanding totals; record payment (`mark-paid`).
- Log a billing activity onto the CRM deal.

## What This Skill Does NOT Do

- Generate the proposal or choose the package narrative — `/proposal` owns that.
- Draft or e-sign the service agreement / move the deal to `won` — `/contract` owns that.
- Move pipeline stages or manage the deal record — `/crm` owns that.
- Render the client-facing invoice view — `/portal` reads `ledger.json` and owns that.
- Onboard the client / create the client profile after `won` — `/intake` owns that.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/billing-store.js` (ledger), `schemas/invoice.js` (shape + totals check), `skills/proposal/proposal.js` (`loadCatalog`, `pickPackage`), `scripts/lib/crm-store.js`, `scripts/lib/md_to_html.js` |
| **Conversation** | The `{slug}`; period, ad-spend amount, and whether to actually `--send` |
| **Skill References** | Domain rules in `references/` (see table below) |
| **Client Profile** | `crm/pipeline.json` deal (retainer, currency, company, contact email); `config/services.json` (agency + package pricing) |

## Clarifications

> Before asking: check the conversation, the CRM deal (`crm/pipeline.json`), and `config/services.json`.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for invoice math, setup-fee rules, or Stripe field shapes.

**Required (must resolve before running):**
1. Which client `{slug}` and which subcommand (`invoice` / `list` / `mark-paid`).

**Optional (ask only if relevant):**
2. Billing period if not the current month (`--period YYYY-MM`).
3. Ad-spend pass-through amount for this period (`--ad-spend <major-units>`).
4. Whether to actually charge via Stripe now (`--send`) or generate locally for manual sending.
5. Whether to skip the first-month setup fee (`--no-setup`) or override a gate (`--force`).

## Workflow

1. Resolve the deal via `getDeal(slug)`; halt if none exists.
2. For `invoice`: confirm `deal.stage === "won"` (else require `--force`); compute the period; check the ledger for an existing invoice in that period (block unless `--force`).
3. Pick the package with `pickPackage(loadCatalog(), { retainer: deal.deal.monthly_retainer })`; build the invoice via `buildInvoice(...)` — retainer (per-deal override > catalog), setup fee on first invoice unless `--no-setup`, optional ad-spend line.
4. If `--send`: call `stripeSend`; on success set status `sent` and attach `stripe` ids + hosted URL; on any failure keep it local/manual.
5. Save via `saveInvoice` (validates against `schemas/invoice.js`, including the totals check), render Markdown → HTML → PDF, and append a billing activity to the deal via `upsertDeal`.
6. For `list`: print issued / paid / outstanding totals. For `mark-paid`: set the period's invoice `paid`.

## Input / Output Specification

**Inputs:** `billing.js <slug> <invoice|list|mark-paid> [--period YYYY-MM] [--ad-spend N] [--no-setup] [--send] [--force]`; reads `crm/pipeline.json`, `config/services.json`; env `STRIPE_API_KEY` (optional).
**Outputs:** `billing/{slug}/ledger.json` (`schemas/invoice.js`), `billing/{slug}/invoice-{period}.md` + `.html` + `.pdf`; a billing activity on the CRM deal; best-effort Supabase `invoices` mirror; a JSON result to stdout.
(Full schemas, flag table, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Retainer amount, currency, company, contact email (from deal) | Setup fee only on the first invoice; one invoice per period |
| Package selection (closest-to-retainer from catalog) | Invoice id format `INV-{slug}-{period}`; due date = issued + 7 days |
| Billing period, ad-spend pass-through amount | `total` must equal sum of line items (fail-closed) |
| Whether Stripe is configured / used | Stripe failure → local/manual invoice; never a false "sent" |
| Setup fee, retainer per package (in `config/services.json`) | Amounts in MAJOR units; cents conversion only at the Stripe boundary |

## Domain Standards

### Must Follow
- [ ] Gate `invoice` on `deal.stage === "won"` (signed contract precedes billing); only `--force` overrides.
- [ ] Issue exactly one invoice per client per period; block duplicates unless `--force`.
- [ ] Include the one-time setup fee only when there are zero prior invoices, unless `--no-setup`.
- [ ] Keep amounts in major units; convert to cents only at the Stripe API boundary (`Math.round(amount * 100)`).
- [ ] Validate every saved invoice against `schemas/invoice.js`; never persist a total that drifts from its lines.

### Must Avoid
- Claiming a Stripe send that did not return a 2xx — fail-closed to `mode: "manual"`.
- Free-form invoice generation — always compute from deal + catalog.
- Hardcoding retainer/setup/currency — read them from the deal and `config/services.json`.
- Charging silently when `--send` is omitted.

### Output Checklist (verify before delivery)
- [ ] `ledger.json` validates and contains the new/updated invoice.
- [ ] Invoice `.md`, `.html`, and `.pdf` exist (PDF noted as skipped only if playwright is uninstalled).
- [ ] `total == subtotal == sum(line_items)`.
- [ ] CRM deal has a billing activity logged for this invoice.
- [ ] If `--send` succeeded, status is `sent` and `stripe.hosted_url` is present.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `slug` or `cmd` | Print usage, exit 1 |
| No CRM deal for slug | Error "client must be won before billing", exit 2 |
| `mark-paid` with no invoice for period | Error, exit 3 |
| Deal not `won` and no `--force` | Error naming current stage, exit 4 |
| Invoice already exists for period, no `--force` | Error naming the existing invoice id, exit 5 |
| `--send` but no `STRIPE_API_KEY` / no contact email | Generate local invoice, `mode: "manual"` with reason — never fail the run |
| Stripe non-2xx or thrown error | Catch, return `mode: "manual"` with the error string — never a false success |
| Invoice fails schema/totals validation | `saveInvoice` throws; do not persist a drifting invoice |
| PDF render fails (no playwright) | Continue; report PDF as skipped |
| Unknown subcommand | Error, exit 1 |

## Dependencies & Security

- **Reuses:** `scripts/lib/billing-store.js`, `schemas/invoice.js` (via `schemas/index.js`), `skills/proposal/proposal.js` (`loadCatalog`, `pickPackage`), `scripts/lib/crm-store.js`, `scripts/lib/md_to_html.js`, `scripts/lib/load-env.js`, `scripts/lib/supabase.js`.
- **External APIs:** Stripe REST `https://api.stripe.com/v1` (customers, invoiceitems, invoices, invoices/{id}/finalize), form-encoded — see `references/api-reference.md`. PDF via headless Chromium (Playwright).
- **Secrets:** `STRIPE_API_KEY` resolved from env only — never hardcoded, never logged. Stripe is best-effort and fail-closed.
- **Setup:** `pip install playwright && python -m playwright install chromium` (first-time PDF support).

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Stripe API Reference (root) | https://docs.stripe.com/api | Current pinned API version, request conventions |
| Stripe Versioning | https://docs.stripe.com/api/versioning | `Stripe-Version` header (current `2026-05-27.dahlia`) |
| Stripe Invoices | https://docs.stripe.com/api/invoices | Create / finalize / send retainer invoices |
| Stripe Customers | https://docs.stripe.com/api/customers | Create the client as a Customer |
| Stripe Subscriptions | https://docs.stripe.com/api/subscriptions | Recurring monthly retainer (future automation) |
| Stripe Idempotent requests | https://docs.stripe.com/api/idempotent_requests | `Idempotency-Key` so retries never double-bill |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Invoice math, setup-fee/idempotency rules, fail-closed Stripe policy, good/bad examples |
| `references/api-reference.md` | Exact Stripe endpoints, fields, version, cents conversion, rate limits, idempotency |
| `references/io-contract.md` | Full flag table, exit codes, invoice JSON schema, ledger + stdout example payloads, edge cases |
