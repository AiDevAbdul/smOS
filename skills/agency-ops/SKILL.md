---
name: agency-ops
description: Use this skill to render the agency's own internal operating dashboard via `/agency-ops` — MRR per currency, NRR from real MRR snapshots, logo churn, win rate, pipeline velocity, AR aging, per-client margin against cost-to-serve, client health + renewals, and delivery capacity. This skill should be used when the user asks how the agency itself is doing — revenue, retention, profitability, receivables, or whether the team is over capacity — as opposed to how one client's ads are doing. It is the inward-facing sibling of `/portal`, writes to gitignored `agency/` rather than a guessable public path, and mints signed expiring share tokens with `--share`.
---

# /agency-ops — Agency Operations Dashboard (Group D5)

`/portal` shows ONE client their results. This shows the operator the whole book. It is
the last piece of the retention layer: D1 made retainers recurring, D2 made collections
real, D3 scored client health, D4 measured cost-to-serve — this reports all of it in one
place, as HTML + PDF on the shared design system.

## What This Skill Does

- Run `node skills/agency-ops/agency-ops.js` to render `agency/agency-ops.html` + `.pdf`.
- Report **MRR per currency** (never blended), active clients, and the weighted open pipeline.
- Report **NRR / gross retention** decomposed into expansion, contraction, churned MRR and new-logo MRR — computed from real MRR snapshots, not reconstructed from current state.
- **Record an MRR snapshot on every run** (`agency/mrr_snapshots.json`), idempotent per date. This is what makes NRR possible at all (see below).
- Report **logo churn**, **win rate**, and **pipeline velocity** (median first, with sample size and range) — each abstaining with a stated reason when the data can't support it.
- Report **AR aging** per currency with the five worst overdue invoices, from the D2 ledgers.
- Report **per-client margin** against cost-to-serve, flagging loss-making clients and labelling every figure `logged` vs `budgeted`.
- Report **client health + renewal status** with the confidence of each score.
- Report **delivery capacity** per roster member, naming clients with no owner and clients with unknown hours.
- `--share` mints a signed, expiring share token (`scripts/lib/share-token.js`).

## What This Skill Does NOT Do

- Show a client anything — that is `/portal`. This page carries whole-book revenue, margin and receivables and must not be handed to a client.
- Fetch live Meta or Stripe data. It reads the pipeline, the ledgers, the roster and the snapshot history. Run `/billing … reconcile` first if payment status may be stale.
- Change any state except appending today's MRR snapshot. It issues no invoice, advances no deal, sends no reminder.
- Serve or host the page. `--share` mints a token; the **serving layer must call `verifyShareToken()` and refuse on failure**. A token in front of a still-world-readable file protects nothing.
- Convert currencies. There are no FX rates in smOS, so cross-currency figures are reported side by side, never summed.

## Why it records snapshots (the NRR problem)

NRR asks "what happened to the revenue we already had?", which needs **MRR as of a past
date**. Retainer changes are not versioned on the deal — a client who paid $1,000 in June
and $3,000 today looks, from current state alone, like they always paid $3,000. Computing
NRR that way would report real expansion as flat and flat as contraction.

So `/agency-ops` writes a snapshot every run and computes NRR between snapshots. Until a
second one exists it reports `null` with exactly that explanation. The first useful NRR
number therefore appears on the second run in a new period — this is expected, not a bug.

## Honesty contract (enforced in code, visible in the render)

Every metric that cannot be computed renders as **"Not reported"** with its reason, never
as a zero or a blank:

| Situation | What it reports | Why not the obvious number |
|---|---|---|
| Fewer than 2 MRR snapshots | NRR `null` | Past MRR isn't reconstructable from current state |
| Wins but no recorded losses | Win rate `null` | 100% off an empty denominator is a claim the data doesn't make |
| No churned clients | Churn `null` | 0% implies a measured denominator |
| No hours and no budget | Margin `null` | Unknown cost is not zero cost — it would rank the least-measured client as the most profitable |
| Retainer in a different currency to the roster | Margin `null` | smOS holds no FX rates |
| No health signals available | Score `null`, confidence 0 | A client with no artifacts is unscored, not healthy |
| Won deal with `monthly_retainer: 0` | Excluded from MRR **and named** | Terms unrecorded ≠ earns nothing |

## Workflow

1. Load the pipeline (`crm-store.js → loadPipeline`), each won client's ledger (`billing-store.js → listInvoices`), and `config/roster.json`.
2. Record today's MRR snapshot (skip with `--no-snapshot`) **before** building the dashboard, so today's MRR is in the history NRR reads.
3. Build metrics via `agency-metrics.js → agencyDashboard`, margins via `agency-economics.js → clientProfitability` + `portfolioMargin`, capacity via `rosterLoad`, health via `client-health.js → clientHealth`.
4. Render through `design_system.js` (`reportHead` / `heroHeader` / `reportFooter`) reusing `ds-*` classes, then `writeDocHtmlAndPdf`.
5. With `--share`, mint a token — refusing outright if `SMOS_SHARE_SECRET` is absent or a placeholder.

## Input / Output Specification

**Inputs:** `agency-ops.js [--month YYYY-MM] [--since YYYY-MM-DD] [--json] [--share [--ttl N]] [--no-snapshot]`; reads `crm/pipeline.json`, `billing/*/ledger.json`, `config/roster.json`, `agency/mrr_snapshots.json`; env `SMOS_SHARE_SECRET` (optional, required for `--share`).
**Outputs:** `agency/agency-ops.html` + `.pdf`, `agency/mrr_snapshots.json` (appended), and a JSON summary to stdout. `agency/` is gitignored — this data is not source.

## Error Handling

| Scenario | Action |
|----------|--------|
| `--month` / `--since` malformed | Error naming the expected format, exit 1 |
| No won deals | Renders with empty sections; rate metrics abstain with reasons |
| `config/roster.json` missing or unreadable | Warn, fall back to defaults, report every client as unassigned |
| `--share` with no/placeholder `SMOS_SHARE_SECRET` | `minted: false` with the reason — never mints an unsigned token |
| Playwright absent | HTML still written; PDF reported as skipped |
| A client's ledger is unreadable | Treated as no invoices for that client (AR understated, not fatal) |

## Reference Files

- `references/metrics.md` — the definition of every metric, and what each one abstains on.
