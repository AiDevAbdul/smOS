# Billing — Stripe API Reference

Exact external API surface used by `--send`. The companion calls Stripe REST directly with
`fetch` (form-encoded), no SDK. Read this when verifying field shapes, the cents conversion,
idempotency, or rate limits.

## Auth, host, version

- **Base host:** `https://api.stripe.com/v1`
- **Auth:** `Authorization: Bearer ${STRIPE_API_KEY}` (env only — never hardcoded/logged).
- **Content type:** `application/x-www-form-urlencoded` (Stripe expects form encoding, not JSON).
- **API version:** pinned per-account or via the `Stripe-Version` header. Current version string:
  `2026-05-27.dahlia` (see Versioning URL below). The companion does not send a version header
  today; if pinning becomes necessary, add `Stripe-Version: 2026-05-27.dahlia`.

## Call sequence (`stripeSend`)

In order; any non-2xx throws and the whole send falls back to manual:

| Step | Method + Path | Key params | Returns |
|------|---------------|-----------|---------|
| 1 | `POST customers` | `email` (deal contact), `name` (company) | `id` (customer) |
| 2 (×N lines) | `POST invoiceitems` | `customer`, `amount` (cents, string), `currency` (lowercase), `description` | item |
| 3 | `POST invoices` | `customer`, `collection_method=send_invoice`, `days_until_due=7`, `auto_advance=true` | `id` (invoice) |
| 4 | `POST invoices/{id}/finalize` | — | `hosted_invoice_url` |

On full success: `{ sent: true, mode: "stripe", customer_id, invoice_id, hosted_url }`.

## Cents conversion (critical)

Ledger amounts are MAJOR units. Stripe `amount` is the **smallest currency unit** (cents).
Convert only at the boundary:

```
amount: String(Math.round(line.amount * 100))   // 3000 USD → "300000"
currency: inv.currency.toLowerCase()             // "USD" → "usd"
```

Never store cents in the ledger; never send major units to Stripe.

## Idempotency

For safe retries, attach `Idempotency-Key: INV-{slug}-{period}` to the customer/invoice POSTs
so a network retry cannot double-create. See the Idempotent requests doc below. (The local
ledger period-check is the first line of defense; idempotency keys protect the Stripe side.)

## Rate limits

Stripe applies per-account request limits (live mode is more generous than test). On `429`,
back off and retry with the same idempotency key. The companion does not auto-retry; a 429
surfaces as a thrown error → manual fallback, which is safe (no partial charge claimed).

## Source URLs

| Resource | URL | Use For |
|----------|-----|---------|
| API Reference (root) | https://docs.stripe.com/api | Request conventions, current version |
| Versioning | https://docs.stripe.com/api/versioning | `Stripe-Version` header, version string |
| Invoices | https://docs.stripe.com/api/invoices | `collection_method`, `days_until_due`, `auto_advance`, finalize, `hosted_invoice_url` |
| Invoice Items | https://docs.stripe.com/api/invoiceitems | `amount` (cents), `currency`, `description`, `customer` |
| Customers | https://docs.stripe.com/api/customers | `email`, `name` |
| Subscriptions | https://docs.stripe.com/api/subscriptions | Recurring retainer (future automation) |
| Idempotent requests | https://docs.stripe.com/api/idempotent_requests | `Idempotency-Key` header semantics |

Fetch the official doc before changing any field name or enum. Cross-check the canonical map
in `skills/references-shared.md` §13 so URLs stay consistent across skills.

**Last verified:** 2026-06-22
