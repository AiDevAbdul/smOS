# /agency-ops — metric definitions

Every metric below is a pure function in `scripts/lib/agency-metrics.js` (or D3/D4's
`client-health.js` / `agency-economics.js`) and is unit-tested in
`test/agency-ops.test.js`. The column that matters most is the last one: what the metric
does when the data can't support it.

## Revenue

| Metric | Definition | Abstains when |
|---|---|---|
| **Active MRR** | Σ `deal.deal.monthly_retainer` over `won` deals, grouped by currency | never — but reports `clients_without_retainer` (+ slugs) so it's never read as covering the whole book |
| **Weighted open pipeline (annual)** | Σ `weightedValue(deal)` over deals not in won/lost/churned, per currency | never |
| **NRR** | `(start_mrr + expansion − contraction − churned) / start_mrr`, between the earliest snapshot on/after `--since` and the latest | fewer than 2 snapshots, or no MRR in the earliest snapshot |
| **Gross retention** | `(start_mrr − contraction − churned) / start_mrr` — NRR without expansion | same as NRR |

**New logos are excluded from NRR by definition.** NRR measures what happened to revenue
you already had; counting new clients would let acquisition mask churn. `new_logo_mrr` is
reported separately.

## Why NRR needs snapshots

Retainer changes are not versioned on the deal. From current state alone, a client who
paid $1,000 in June and $3,000 today reads as having always paid $3,000 — so a
"reconstructed" NRR would show real expansion as flat, and flat as contraction. Every
`/agency-ops` run appends one snapshot (`agency/mrr_snapshots.json`, idempotent per
date), holding per-client MRR so expansion and contraction stay separable. The first
useful NRR appears on the second run.

## Retention & sales

| Metric | Definition | Abstains when |
|---|---|---|
| **Logo churn** | churned-in-window / (active + churned-in-window) | nothing has ever churned — `0%` would imply a measured denominator |
| **Win rate** | won / (won + lost), decided in window | no losses recorded — `100%` off zero losses is a claim the data doesn't make |
| **Pipeline velocity** | days `created_at` → won: **median**, mean, sample size, range | no won deal has a creation date |

Median is reported before mean deliberately: at single-digit sample sizes one slow deal
moves the mean a long way. The range is shown so the reader sees the spread.

Stage timestamps come from `won_at` / `lost_at` when set, otherwise from the auto-logged
`type: "stage"` activity entries (`stageReachedAt`).

## Receivables

From `scripts/lib/ar.js` over every won client's ledger. Buckets: `current` (issued, not
yet due), `1-30`, `31-60`, `61-90`, `90+` days past `due_date`.

Only `status: "sent"` invoices are receivable — a draft hasn't been given to the client,
and paid/void are settled. **"Overdue" is never stored**, only derived from
`(invoice, today)`: a stored flag is stale when written and would need un-writing when
the client pays.

Cross-client roll-ups MUST read `by_currency`, not the flat `outstanding` — this book
holds USD, EUR and PKR. `mixed_currency: true` marks when the flat totals blend.

## Profitability

From `scripts/lib/agency-economics.js`. `margin = retainer − (hours × rate + tool_cost +
contractor_cost)`, where hours are **logged** effort for the month if any exists,
otherwise the **budgeted** `hours_per_month`. `hours_basis` always says which.

Rate precedence: per-client `cost_to_serve.hourly_cost` → roster member `hourly_cost` →
roster `default_hourly_cost`.

Abstains (`margin: null`) when: no hours and no budget; the retainer is unrecorded; or the
deal's currency differs from the roster's cost currency.

## Capacity

From `rosterLoad`. Per member: client count and hours against `max_clients` /
`max_hours_per_month`, with `over_client_limit` / `over_hours_limit` flags. Only `won`
deals consume delivery capacity.

Two reporting rules: a deal whose `owner` matches no roster member is listed as
**unassigned** (an unowned client is a capacity risk, not zero load), and hours
utilization is a **floor** whenever `clients_with_unknown_hours` is non-empty.

## Share links

`scripts/lib/share-token.js`. Token = `<payload-b64url>.<hmac-sha256-b64url>`, signed with
`SMOS_SHARE_SECRET`. The payload names the permitted resource, an optional client slug
scope, an expiry, and a nonce.

Verification is fail-closed and timing-safe, and checks scope only *after* the signature
so probing reveals nothing. A forged, edited (e.g. bumped expiry), differently-signed,
expired or malformed token is refused. A secret that is absent, a placeholder, or under 16
characters counts as unconfigured — minting throws rather than producing an unsigned token.

**This module does not gate a route.** The serving layer must call `verifyShareToken()`
and refuse on `ok: false`; a token in front of a file that is also still world-readable
protects nothing. This is why the dashboard writes to gitignored `agency/` instead of
`public/reports/`, which is readable by anyone who guesses a slug.

**Last verified:** 2026-09-09
