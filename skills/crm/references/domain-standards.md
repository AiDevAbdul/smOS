# CRM — Domain Standards

Embedded sales-pipeline expertise for the smOS agency CRM. All values here are the
ones encoded in `schemas/deal.js`; this file is the human-readable source of truth so
nothing has to be rediscovered at runtime. Readable standalone.

> **Derived values — keep current.** Every number/edge below comes from `schemas/deal.js`.
> If that file changes, re-diff this doc (see SKILL.md → Keeping Current).
> **Last verified against `schemas/deal.js`: 2026-06-22.**

## 1. Stage taxonomy (lifecycle order)

`schemas/deal.js` `STAGES`:

```
lead → contacted → audited → proposed → negotiating → won → churned
                                              ↘ lost (re-engageable)
```

| Stage | Meaning | smOS work that produced it |
|-------|---------|----------------------------|
| `lead` | A company exists in the pipeline; no contact yet | manual `crm add`, or `sync` of a prospect with no audit |
| `contacted` | First outreach made (call/email/meeting) | `crm log` + `crm stage` |
| `audited` | Public-data audit delivered | `/pre-audit` ran → `links.pre_audit` |
| `proposed` | Pitch/proposal sent | `/proposal` ran → `links.proposal` |
| `negotiating` | Terms under discussion | manual advance |
| `won` | Signed; becomes an active client | proposal accepted → `/intake` |
| `lost` | Dead deal (re-engageable via `contacted`) | `crm stage <slug> lost --reason "..."` |
| `churned` | Former client who left (win-back via `contacted`) | manual advance from `won` |

`won`, `lost`, `churned` are terminal-ish. `lost` and `churned` can both transition
back to `contacted` to re-engage.

## 2. Transition matrix (`TRANSITIONS`)

A deal may only move along these edges. Any other move is **blocked** (exit 4) unless
`--force` is passed with a recorded reason. Setting a deal to its current stage is
idempotent and always allowed.

| From | Allowed → |
|------|-----------|
| `lead` | `contacted`, `audited`, `proposed`, `lost` |
| `contacted` | `audited`, `proposed`, `negotiating`, `lost` |
| `audited` | `proposed`, `negotiating`, `lost` |
| `proposed` | `negotiating`, `won`, `lost` |
| `negotiating` | `won`, `lost` |
| `won` | `churned` |
| `lost` | `contacted` (re-engage) |
| `churned` | `contacted` (win-back) |

**Why a state machine:** prevents a deal silently jumping `lead → won` without the
steps that produce a proposal/contract paper trail. `--force` exists for genuine
data-repair (e.g. backfilling a deal that closed offline) and must record why.

## 3. Per-stage close probability (`STAGE_PROBABILITY`)

Auto-applied on every `crm stage` change; drives the weighted forecast.

| Stage | Probability |
|-------|-------------|
| `lead` | 10 |
| `contacted` | 20 |
| `audited` | 35 |
| `proposed` | 55 |
| `negotiating` | 75 |
| `won` | 100 |
| `lost` | 0 |
| `churned` | 0 |

Probability is overridable per deal (set explicitly in the record), but `crm stage`
resets it to the stage default unless the field was already customized.

## 4. Forecast formulas

From `summarize()` in `crm.js` and `weightedValue()` in `schemas/deal.js`.

- **Weighted value of one deal** (annualized, probability-adjusted):
  - For active deals (not won/lost/churned): `round(monthly_retainer × 12 × probability/100)`
  - For `won`: `monthly_retainer × 12` (full annual contract value, not probability-weighted)
  - For `lost` / `churned`: `0`
- **Weighted annual pipeline** = Σ weightedValue over all *active* deals (stage not in
  `lost`/`churned`). This is the agency's forward revenue dashboard.
- **Active MRR** = Σ `monthly_retainer` over all `won` deals. Current recurring revenue.

**Both are reported PER CURRENCY** (changed in Group D3). The portfolio holds EUR, USD
and PKR retainers, so a single blended total was arithmetic on incommensurable units —
a meaningless headline number. `_blended` is retained only for backward compatibility
and is explicitly labelled as not a real amount. `clients_without_retainer` counts won
deals with `monthly_retainer: 0`, so a total is never quietly understated.

`crm list` returns: `total`, `by_stage` (count per stage), `weighted_pipeline_annual`
(per currency), `active_mrr` (per currency), `clients_without_retainer`, and `_blended`.

## 4b. Retention (Group D3)

- **Renewal date** = explicit `deal.renewal_date`, else `engagement_start + term_months`.
  When neither is known it is `null`, and the renewal status is `"unknown"` — which is a
  distinct state from "not due". Never let an unset term read as "nothing to do".
- **Tenure** = whole elapsed months since `engagement_start` (falling back to `won_at`).
- **Revenue to date** = retainer × tenure, or `null` when the retainer is unrecorded.
  `0` would assert we have earned nothing; `null` says we don't know the terms.
- **Health score** (`scripts/lib/client-health.js`) is a weighted blend of five optional
  signals — performance (35), payment (25), delivery (15), engagement (15), tenure (10).
  A missing signal is removed from the DENOMINATOR, never scored as zero: absence of
  evidence is not evidence of trouble. A client with no artifacts scores `null`, and
  `confidence` reports what share of the full weighting had data. Below 50% confidence
  the band is marked `band_provisional` — a hint, not a finding.

## 4c. Cost to serve, margin and capacity (Group D4)

Revenue was being read as profit because nothing recorded cost. `deal.cost_to_serve`
(`hours_per_month`, `hourly_cost`, `tool_cost`, `contractor_cost`) plus an append-only
`deal.effort_log` make per-client margin computable, and `config/roster.json` holds the
delivery roster with per-member `max_clients` / `max_hours_per_month`.

Three rules `scripts/lib/agency-economics.js` enforces in code, because breaking any of
them produces a confident number that is wrong:

1. **Unknown cost is not zero cost.** With no logged hours and no budget, `margin` is
   `null` — never "100% margin", which would make the least-measured client look like
   the most profitable one in the book.
2. **Estimate vs actual is always labelled.** `hours_basis` is `logged` when the period
   has effort entries, `budgeted` when it falls back to `hours_per_month`, `unknown`
   otherwise. A margin from a guess must not read like a margin from a timesheet.
3. **No invented FX.** Cost rates are in one currency. A client billed in another gets
   `margin: null` with a reason — smOS holds no exchange rates.

`margin` also reports `loss_making`, and `portfolioMargin` totals per currency while
counting (and explaining) every client it could not measure. `roster` reports a deal
whose `owner` matches no roster member as **unassigned** rather than dropping it: an
unowned client is a capacity risk, not a zero. Members' hours utilization is a FLOOR
whenever `clients_with_unknown_hours` is non-empty.

## 5. Activity types

`schemas/deal.js` `normalizeActivity` lowercases the type. Recognized values:
`note`, `call`, `email`, `meeting`, `stage` (auto-logged on transitions), `proposal`,
`contract`. Unknown types are accepted as-is (lenient) — prefer the listed set.

## 6. Good / bad examples

**Good — clean acquisition path**
```
crm add acme --name "Acme Co" --retainer 2500 --currency USD --source referral
crm log acme --type call --note "intro call, interested"
crm stage acme contacted --note "intro call done"
# /pre-audit runs → sets stage=audited + links.pre_audit
crm stage acme proposed --note "deck sent"     # blocked from contacted? no — allowed
crm set acme link.proposal=clients/acme/proposal.pdf
crm stage acme won --note "signed"             # passes the proposal gate
```

**Bad — and why it fails**
```
crm stage acme won            # ✗ exit 4: lead→won is not an allowed transition
crm stage acme proposed
crm stage acme won            # ✗ exit 3: won requires links.proposal
crm add acme --name "Acme"    # ✗ exit 2 if acme already exists — use set/stage
```

**Good — honest forecast hygiene**
- A `negotiating` $3,000/mo deal contributes `3000×12×0.75 = $27,000` to the weighted
  pipeline — not the full $36k. Do not inflate by jumping stages.
- Mark genuinely dead deals `lost` so they drop to 0 weight rather than lingering at
  35% and overstating the forecast.

**Bad — forecast distortion**
- Forcing a deal to `won` to lift MRR without a signed proposal: blocked by the gate,
  and dishonest even with `--force`.
- Leaving stale `proposed` deals at 55% for months: re-stage to `lost` or log activity.
