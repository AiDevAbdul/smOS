# CRM — External Surface: Supabase Mirror & Downstream Handoffs

CRM has **no Meta/Stripe/Dropbox calls of its own**. Its only external surface is the
optional best-effort Supabase mirror; everything else here is the handoff contract that
lets downstream commercial skills read/write the same deal. Readable standalone.

> **Last verified: 2026-06-22.** Mirrored-column list derived from `persist()` in
> `skills/crm/crm.js` and `mirror()` in `scripts/lib/crm-store.js`. PostgREST/Supabase
> semantics verified against the cited URLs below.

## 1. Supabase PostgREST upsert (the only external call)

The mirror runs through `scripts/lib/supabase.js` → `upsert("deals", row, "slug")`.

| Aspect | Value |
|--------|-------|
| Endpoint | `POST ${SUPABASE_URL}/rest/v1/deals` |
| Auth headers | `apikey: <SERVICE_KEY>` + `Authorization: Bearer <SERVICE_KEY>` (service key bypasses RLS) |
| Upsert headers | `Prefer: return=representation,resolution=merge-duplicates` |
| Conflict key | query param `on_conflict=slug` (requires a UNIQUE constraint on `deals.slug`) |
| Body | JSON array of rows (the writer wraps a single row in an array) |
| DDL | **out of scope** — table creation uses the Management API + PAT, not this path |

Cited sources (fetch when status is unexpected):

| Resource | URL | Use For |
|----------|-----|---------|
| PostgREST — Insert/Upsert | https://postgrest.org/en/stable/references/api/tables_views.html#upsert | `Prefer: resolution=merge-duplicates` + `on_conflict` semantics |
| Supabase REST (PostgREST) | https://supabase.com/docs/guides/api | `SUPABASE_URL/rest/v1/<table>` + service-key RLS bypass |

### Mirrored columns

`crm.js` `persist()` writes: `slug`, `company_name`, `stage`, `monthly_retainer`,
`currency`, `probability`, `owner`, `contact`, `links`, `updated_at`.
`crm-store.js` `mirror()` (used by /proposal, /contract) writes the same minus
`owner` and `contact`. Both upsert on `slug`.

### Best-effort contract (rate/error behavior)

- **Unset env** → `supabaseConfigured()` is `false`; the call is a no-op returning `{ skipped: true }`. The CRM is fully usable offline / in CI.
- **REST/network error** → caught and returned as `{ error }`, **never thrown**. The local `crm/pipeline.json` write has already committed before the mirror runs, so the deliverable is never blocked.
- **No retry / no rate-limit handling** is implemented — a single upsert per mutation, fire-and-forget. There is no batching loop, so PostgREST/Supabase request limits are not a practical concern here.

## 2. Storage model

- **Canonical:** `crm/pipeline.json` — a JSON array of normalized deals. Every write re-normalizes the whole array through `schemas/deal.js` (`savePipeline`).
- **Mirror:** the Supabase `deals` table above, upserted per mutation. The mirror is a convenience for cross-tool dashboards, never the source of truth.

## 3. Downstream handoff contract — who reads/writes what

Every commercial skill reads and patches the deal through `scripts/lib/crm-store.js`
(`getDeal`, `upsertDeal`) so storage stays consistent with `schemas/deal.js`. CRM owns
the interactive commands; the others mutate specific fields.

| Skill | Reads | Writes | External API |
|-------|-------|--------|--------------|
| `/pre-audit` | deal slug | `stage=audited`, `links.pre_audit` | none |
| `/proposal` | `deal.deal` retainer terms, `links.pre_audit` | `stage=proposed`, `links.proposal` | none |
| `/crm stage … won` | `links.proposal` (gate) | `stage=won`, `won_at`, `probability=100` | none |
| `/intake` | won deal | `links.client_profile` (creates `clients/<slug>/` + `CLAUDE.md` + `clients` row) | none |
| `/contract` | `links.client_profile`, `deal.deal` | `links.contract` | Dropbox Sign (e-sign) |
| `/billing` | `deal.deal.monthly_retainer`, `currency` | (invoice/subscription state) | Stripe |

`upsertDeal(slug, patch)` creates the deal if missing (so `/proposal` can run on a bare
slug), deep-merges `links` and `deal`, re-validates fail-closed, saves, and mirrors.

Downstream-API references (fetch only when wiring those skills):

| Resource | URL | Use For |
|----------|-----|---------|
| Stripe Invoices | https://docs.stripe.com/api/invoices | `/billing` retainer invoicing fed by `deal.deal` |
| Stripe Subscriptions | https://docs.stripe.com/api/subscriptions | Recurring monthly retainer |
| Dropbox Sign — Signature Request | https://developers.hellosign.com/api/signature-request | `/contract` e-sign of the service agreement |

## 4. Why this design

- One record per company means acquisition → contracting → active → churn is visible in one query, and the weighted forecast is computable in a single pass.
- The state machine + `won` gate make the forecast trustworthy: a deal cannot reach 100% probability without the artifact (proposal) that justifies the win.
- Local-first with a best-effort mirror keeps the CRM fully usable offline and in CI, matching the smOS constitution's "never block the deliverable on persistence" rule.
