---
name: billing
description: Use this skill to issue retainer invoices for a won/active client (typically via `/billing {slug} invoice`). Builds a monthly invoice (retainer + first-month setup fee + optional ad-spend pass-through) as HTML+PDF, keeps a per-client ledger with per-period idempotency, optionally sends via Stripe, and logs the activity to the CRM deal. Phase 5 Agency-OS skill; completes the money side of the lifecycle.
---

# /billing — Retainer Invoicing (Phase 5 · Agency OS)

Turns a `won` deal into recurring revenue. Reads the deal's retainer terms + the service catalog, issues a per-period invoice, and tracks it in a ledger the client portal can read.

## Required Context

- `crm/pipeline.json` — the deal must be `won` (or `--force`); supplies retainer, currency, company, contact email
- `config/services.json` — agency details + package (for setup fee / scope naming)
- Optional: `STRIPE_API_KEY` for real invoice sends

## Commands

```
billing <slug> invoice [--period 2026-06] [--ad-spend 500] [--no-setup] [--send] [--force]
billing <slug> list                       # ledger: issued / paid / outstanding
billing <slug> mark-paid --period 2026-06 # record payment
```

## Workflow

1. **Issue** (`invoice`): builds the invoice for the period —
   - monthly retainer (per-deal retainer, else catalog price)
   - **one-time setup fee on the first invoice** (auto; skip with `--no-setup`)
   - optional `--ad-spend <amount>` pass-through line
   - **Per-period idempotency:** one invoice per client per month — re-running the same period is blocked unless `--force`.
2. **Send** (`--send`): with `STRIPE_API_KEY`, creates a Stripe customer + invoice items + invoice and finalizes it (returns the hosted pay link). Without a key, or on any error, it generates the invoice locally and marks it manual — it never charges silently or claims a send it didn't make.
3. **Record payment** (`mark-paid`): sets the invoice `paid` in the ledger.

## Output

- `billing/{slug}/ledger.json` — the invoice ledger (`schemas/invoice.js`)
- `billing/{slug}/invoice-{period}.md` + `.html` + `.pdf`
- CRM deal gets a billing activity logged

## Handoffs

- `/contract --mark-signed` → deal `won` → `/intake` to onboard → `/billing` to invoice
- `/portal` (next) reads `billing/{slug}/ledger.json` for the client's invoice view

## Safety

- Gated on `won` (the lifecycle guarantees a signed contract precedes billing); `--force` to override.
- Per-period idempotency prevents double-billing a month.
- Invoice totals are validated against the sum of line items (`schemas/invoice.js`) — a stored total can't drift from its lines.
- Stripe is best-effort and fail-closed to a local/manual invoice.

## Token Efficiency

- Invoices are computed from the deal + catalog, not generated free-form.
- First-time PDF setup: `pip install playwright && python -m playwright install chromium`.
