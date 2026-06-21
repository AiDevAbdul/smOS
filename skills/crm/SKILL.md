---
name: crm
description: Use this skill to manage the agency sales/client pipeline — track deals from lead through proposal, signing, and churn (typically via `/crm`). This is the Phase 5 Agency-OS foundation: one deal record per company that /proposal, /contract, and /billing all hang off. Unifies the previously-separate prospects/ (pre-audit) and clients/ (signed) worlds into one queryable pipeline with a forecast.
---

# /crm — Agency Pipeline (Phase 5 · Agency OS foundation)

The spine of the commercial side of smOS. Every company the agency touches is one **deal** moving through the pipeline:

```
lead → contacted → audited → proposed → negotiating → won → (active client)
                                              ↘ lost      won → churned
```

Each stage maps to real smOS work: **audited** = `/pre-audit` ran, **proposed** = `/proposal` sent, **won** = signed (run `/intake` to onboard). The deal carries the retainer terms and the links (`pre_audit`, `proposal`, `contract`, `client_profile`) that downstream skills read.

## Storage

- `crm/pipeline.json` — the array of deals (canonical, `schemas/deal.js`)
- Best-effort mirror to Supabase `deals` (upsert on slug); no-op offline

## Commands

```
crm sync                                   # first run: import existing prospects/ + clients/
crm add <slug> --name "Acme Co" --email a@acme.co --stage lead --retainer 2000 --currency USD --source referral
crm list [--stage proposed]                # pipeline + weighted forecast
crm show <slug>                            # full deal record
crm stage <slug> <newstage> [--note "..."] # advance stage (state machine enforced)
crm log <slug> --type call --note "..."    # log an activity (note|call|email|meeting)
crm set <slug> next_action="send deck" next_action_due=2026-06-25
crm set <slug> link.proposal=clients/acme/proposal.pdf
crm next                                   # deals with due/overdue next actions
```

## Workflow

1. **Bootstrap once:** `crm sync` imports every existing prospect (→ `audited` if a pre-audit exists, else `lead`) and signed client (→ `won`) so the pipeline reflects reality.
2. **New lead:** `crm add` with the company + retainer estimate.
3. **As work happens, advance the stage.** The state machine (`schemas/deal.js` TRANSITIONS) blocks illegal jumps (e.g. `lead → won`) — use `--force` only with reason. Probability auto-updates per stage and drives the weighted forecast.
4. **Marking `won` requires a proposal link** (`links.proposal`) — the validator fail-closes otherwise, so a deal can't be "won" without the artifact that justifies it. Set it after `/proposal` runs.
5. **After `won`:** run `/intake` to onboard, then `/contract` + `/billing`.

## Pipeline forecast

`crm list` returns: count by stage, **weighted annual pipeline** (Σ retainer×12×probability for active deals), and **active MRR** (Σ retainer of won deals). This is the agency's revenue dashboard.

## Handoffs

- `/pre-audit` → set `stage=audited` + `link.pre_audit`
- `/proposal` → set `stage=proposed` + `link.proposal`
- `/contract` → set `link.contract`
- `/intake` → after `won`, links `client_profile`

## Safety

- The stage state machine is enforced (illegal transitions blocked; `--force` + reason to override).
- `won` is gated on a proposal link — no "won" without the paper trail.
- Supabase mirroring is best-effort and never blocks the local pipeline write.
