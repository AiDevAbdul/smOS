# /portal — External Surfaces Reference

The `/portal` script makes **no live API calls at render time** — it reads already-persisted
local artifacts and store files. This reference documents the two external surfaces whose
data the portal *displays* (Stripe hosted links) or *optionally writes to* (Supabase pointer),
so the displayed values stay accurate. Self-contained.

## Stripe — the Pay-now link (display only)

The portal never calls Stripe. It renders the `hosted_url` that `/billing` already stored on
each invoice (`invoice.stripe.hosted_url`). Background for understanding that field:

| Resource | URL | Use For |
|----------|-----|---------|
| Invoices | https://docs.stripe.com/api/invoices | `hosted_invoice_url` is Stripe's hosted payment page; what the Pay-now link points to |
| API versioning | https://docs.stripe.com/api/versioning | Pinned via `Stripe-Version` header (current `2026-05-27.dahlia`) — set by `/billing`, not here |
| Idempotent requests | https://docs.stripe.com/api/idempotent_requests | Why an invoice never double-bills — relevant only to `/billing` |

- `invoice.stripe.hosted_url` — Stripe's `hosted_invoice_url`; a public, tokenized link the
  client opens to pay. Safe to embed in a client-facing page.
- The portal treats it opaquely: render `[Pay now](hosted_url)` only when present and the
  invoice is not yet `paid`. It does not validate or refresh the link.
- **Rate limits:** none consumed by `/portal` (no Stripe call). `/billing` owns Stripe rate
  limits (Stripe default ~100 read / 100 write req/s in live mode).

## Supabase — best-effort pointer (optional write)

When configured, the store libs mirror their records to Supabase; a Supabase pointer write
for the portal is best-effort and must never fail the render.

| Surface | Detail |
|---------|--------|
| Access pattern | REST + service key (per project memory `project_supabase_blocked.md`); direct Postgres URL is dead |
| Tables touched (by store libs, not the portal directly) | `deals` (via `crm-store.js`), `invoices` (via `billing-store.js`) |
| Failure mode | `supabaseConfigured()` gate; any error is swallowed (`catch {}`) — HTML is still written |
| Secrets | Service key resolved from env via `scripts/lib/load-env.js`; never hardcoded or written into the HTML |

## Meta Graph API — not used here

The portal shows paid/organic metrics from persisted artifacts (`performance_analysis.json`,
`inbox.json`, etc.) produced by upstream skills (`/analyze`, `/inbox`, `/content-plan`,
`/listening`). Those skills own Meta API v25.0 access and its rate limits. If a metric
definition is unclear, consult the canonical map in `skills/references-shared.md`
(Marketing API, Pages API, Instagram Platform sections) rather than re-deriving it here.

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API rate limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Context for upstream metric pulls (not consumed by /portal) |
| Meta Business Help Center | https://www.facebook.com/business/help | Client-safe metric definitions for the dashboard |

## Version pins — single source of truth

The portal calls neither Stripe nor Meta and renders **no version string**, so it cannot
introduce version drift into the output. The two pins below are documented here only because the
portal *displays* Stripe-stamped links and Meta-derived metrics; they are owned upstream.

| Pin | Value | Owned by | Canonical source |
|-----|-------|----------|------------------|
| Stripe API version | `2026-05-27.dahlia` | `/billing` (`Stripe-Version` header) | `skills/references-shared.md` § 13 |
| Meta Graph API version | `v25.0` | paid/organic skills | `skills/references-shared.md` § 1 |

All version facts trace to `skills/references-shared.md` — there is no second place to update. On
each Last-verified pass, reconcile the table above against that map and bump the date below.

**Last verified:** 2026-06-22 — Stripe version `2026-05-27.dahlia`, Meta Graph API v25.0
confirmed current against `references-shared.md`. To keep current: re-read that canonical map's
§ 1 and § 13, reconcile this table, and bump this date when confirmed.
