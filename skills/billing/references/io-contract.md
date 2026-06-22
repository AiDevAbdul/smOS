# Billing — I/O Contract

The exact input/output contract of `skills/billing/billing.js`. Read this when wiring a
caller, asserting in tests, or debugging an exit code.

## CLI

```
node skills/billing/billing.js <slug> invoice  [--period YYYY-MM] [--ad-spend N] [--no-setup] [--send] [--force]
node skills/billing/billing.js <slug> list
node skills/billing/billing.js <slug> mark-paid [--period YYYY-MM]
```

### Flags

| Flag | Applies to | Meaning | Default |
|------|-----------|---------|---------|
| `--period YYYY-MM` | invoice, mark-paid | Billing period | current month (UTC `YYYY-MM`) |
| `--ad-spend N` | invoice | Add an ad-spend pass-through line (major units) | none |
| `--no-setup` | invoice | Skip the first-month setup fee | setup added on first invoice |
| `--send` | invoice | Attempt a Stripe send | off (generate local) |
| `--force` | invoice | Override the `won` gate and the period-exists guard | off |

### Exit codes

| Code | Condition |
|------|-----------|
| 0 | Success |
| 1 | Missing slug/cmd, or unknown subcommand |
| 2 | No CRM deal for slug |
| 3 | `mark-paid`: no invoice for that period |
| 4 | `invoice`: deal not `won` and no `--force` |
| 5 | `invoice`: invoice already exists for the period and no `--force` |

## Inputs (files / env)

- `crm/pipeline.json` — deal record (`getDeal(slug)`): `stage`, `company_name`, `contact.email`,
  `deal.monthly_retainer`, `deal.currency`, `activities[]`.
- `config/services.json` — agency block + packages (`loadCatalog` / `pickPackage`).
- Env `STRIPE_API_KEY` — optional; only used by `--send`.

## Outputs

- `billing/{slug}/ledger.json` — array of invoices (`schemas/invoice.js`); source of truth.
- `billing/{slug}/invoice-{period}.md`, `.html`, `.pdf` — the rendered invoice.
- CRM deal: a `note` activity appended (`invoice {id} issued (...)`).
- Best-effort Supabase `invoices` mirror.
- A JSON result object printed to stdout.

## Invoice schema (`schemas/invoice.js`)

```jsonc
{
  "id": "INV-acme-2026-06",        // INV-{slug}-{period}
  "slug": "acme",
  "company": "Acme Co",
  "period": "2026-06",              // YYYY-MM (validated by regex)
  "currency": "USD",
  "line_items": [
    { "description": "Growth management retainer — 2026-06", "amount": 3000 },
    { "description": "One-time setup fee", "amount": 750 }
  ],
  "subtotal": 3750,                 // = sum(line_items.amount)
  "total": 3750,                    // MUST equal subtotal (cents-compared)
  "status": "draft",                // draft | sent | paid | void
  "issued_at": "2026-06-22T10:00:00.000Z",
  "due_date":  "2026-06-29T10:00:00.000Z",   // issued_at + 7 days
  "stripe": null                    // or { customer_id, invoice_id, hosted_url }
}
```

Validation (fail-closed): non-empty `id`, `slug`; `period` matches `^\d{4}-\d{2}$`; at least one
line item each with a description; `total >= 0`; status in the enum; and the totals check
`round(total*100) === round(subtotal*100)`.

## Example stdout — `invoice` (local / not sent)

```json
{
  "slug": "acme",
  "invoice": "INV-acme-2026-06",
  "period": "2026-06",
  "total": "USD 3750",
  "setup_included": true,
  "status": "draft",
  "html": "/…/billing/acme/invoice-2026-06.html",
  "pdf": "/…/billing/acme/invoice-2026-06.pdf",
  "stripe": "(not sent — add --send)",
  "next": "Send manually or re-run with --send"
}
```

## Example stdout — `invoice --send` (Stripe success)

```json
{
  "slug": "acme",
  "invoice": "INV-acme-2026-07",
  "period": "2026-07",
  "total": "USD 3000",
  "setup_included": false,
  "status": "sent",
  "html": "/…/billing/acme/invoice-2026-07.html",
  "pdf": "/…/billing/acme/invoice-2026-07.pdf",
  "stripe": { "sent": true, "mode": "stripe", "customer_id": "cus_…", "invoice_id": "in_…", "hosted_url": "https://invoice.stripe.com/i/…" },
  "next": "On payment: /billing acme mark-paid --period 2026-07"
}
```

## Example stdout — `list`

```json
{
  "slug": "acme",
  "count": 2,
  "issued": 6750,
  "paid": 3750,
  "outstanding": 3000,
  "invoices": [
    { "id": "INV-acme-2026-06", "period": "2026-06", "total": 3750, "status": "paid" },
    { "id": "INV-acme-2026-07", "period": "2026-07", "total": 3000, "status": "sent" }
  ]
}
```

## Example stdout — `mark-paid`

```json
{ "slug": "acme", "period": "2026-06", "status": "paid", "total": 3750 }
```

## Edge cases

| Case | Behavior |
|------|----------|
| First invoice + `--no-setup` | Setup fee omitted; retainer-only invoice |
| `--ad-spend 0` or negative | No pass-through line added |
| Re-running same period | Blocked (exit 5) unless `--force`; `--force` overwrites the same `id` in place |
| `--send` succeeds but `hosted_invoice_url` absent | `hosted_url: null`; status still `sent` |
| `--send` fails (any reason) | Invoice still saved locally; `stripe` field stays `null`; result reports manual mode + reason |
| Supabase not configured | Local ledger still written; mirror silently skipped |
| Playwright not installed | HTML written; `pdf` reported as "(PDF skipped — install playwright)" |

**Last verified:** 2026-06-22
