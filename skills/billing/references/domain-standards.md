# Billing — Domain Standards

Embedded expertise for retainer invoicing. Read this when you need the invoice math,
the rules that govern setup fees / idempotency / Stripe fallback, or worked examples.

## Lifecycle position

The agency money flow:

```
/crm (deal: lead → ... → won)  →  /contract (e-sign → won)  →  /intake (create client)
   →  /billing (issue monthly retainer invoice)  →  /portal (client sees the ledger)
```

`/billing` is gated on the deal being `won` because a signed contract must precede any
charge. The gate is overridable only with `--force` (e.g. re-billing a deal that was
manually advanced). Never bill a deal that has not reached `won` without an explicit
`--force` from the user.

## Invoice composition

An invoice for a period (`YYYY-MM`) is built from up to three line items:

1. **Monthly retainer** (always). Amount = `deal.deal.monthly_retainer` if > 0, else the
   selected package's `monthly_retainer` from `config/services.json`. The per-deal value
   overrides the catalog so a negotiated price wins.
2. **One-time setup fee** (first invoice only). Included when the client has **zero prior
   invoices** in the ledger and the package `setup_fee > 0`. Skipped entirely with `--no-setup`.
3. **Ad-spend pass-through** (optional). Included only when `--ad-spend <amount>` is passed
   and > 0. Ad spend is normally billed by Meta directly; this line exists for agencies that
   front the spend and re-bill it.

**Totals rule (fail-closed):** `total == subtotal == sum(line_items.amount)`. The schema
validator (`schemas/invoice.js`) rejects any invoice whose stored total drifts from its
lines (compared in cents: `Math.round(total*100) === Math.round(subtotal*100)`). Never
hand-set a total.

## Constants (do not vary per run)

| Constant | Value | Rationale |
|----------|-------|-----------|
| Invoice id | `INV-{slug}-{period}` | One stable id per client-month → natural idempotency key |
| Due date | issued_at + 7 days | Matches catalog terms "Net 7" |
| Amount units | MAJOR (e.g. `3000` = $3,000) | Human-readable ledger; cents only at Stripe boundary |
| Default currency | `USD` | Overridden by `deal.deal.currency` or package `currency` |
| Default status | `draft` | Becomes `sent` only on a confirmed Stripe finalize |

## Idempotency (anti double-billing)

- The companion checks the ledger before issuing: if any invoice already has this `period`,
  it refuses unless `--force`. This is the local guard.
- On the Stripe side, retries should carry an `Idempotency-Key` (see `api-reference.md`) so a
  network retry never creates a second customer/invoice. The deterministic key is the invoice
  id `INV-{slug}-{period}`.

## Fail-closed Stripe policy

`--send` is **best-effort and fail-closed**. The skill must never report a charge it did not make.

- No `STRIPE_API_KEY` → `mode: "manual"`, invoice generated locally, reason recorded.
- No contact email on the deal → `mode: "manual"`, reason recorded (Stripe needs a recipient).
- Any non-2xx HTTP response or thrown error → caught → `mode: "manual"` with the error string.
- Only a full chain (customer → invoice items → invoice → finalize) returning 2xx flips the
  invoice to `sent` and attaches `stripe.{customer_id, invoice_id, hosted_url}`.

## Good vs bad

**Good — first invoice for a Growth client, no ad spend**
```
billing acme invoice --period 2026-06
→ line items: ["Growth management retainer — 2026-06" 3000, "One-time setup fee" 750]
→ total 3750 USD, status draft, due 2026-06-29
```
Correct: setup fee included because it is the first invoice; total equals the sum.

**Good — second month, with re-billed ad spend, sent via Stripe**
```
billing acme invoice --period 2026-07 --ad-spend 500 --send
→ line items: [retainer 3000, ad-spend pass-through 500]  (no setup fee — not the first)
→ Stripe finalize 2xx → status sent, hosted_url present
```

**Bad — manually setting a total**
```
{ "line_items": [{ "amount": 3000 }], "total": 3750 }
→ REJECTED: total (3750) != sum of line items (3000)
```

**Bad — claiming sent without Stripe**
```
billing acme invoice --send   # no STRIPE_API_KEY
→ WRONG to mark status "sent". Correct: status draft/manual, reason "No STRIPE_API_KEY…".
```

**Bad — billing a non-won deal**
```
billing acme invoice          # deal.stage === "proposed"
→ HALT exit 4: "is proposed, not won. Sign the contract first, or --force."
```

## Keeping current

- Package pricing, setup fees, currency, and Net terms live in `config/services.json` — edit
  there, never inline in the skill. The skill reads them at runtime via `loadCatalog`.
- Statuses are defined once in `schemas/invoice.js` (`STATUSES = draft|sent|paid|void`). If the
  agency adds a status, update the schema, not this file's prose.
- Stripe version + endpoint shapes: re-verify against `api-reference.md` URLs on change.

**Last verified:** 2026-06-22
