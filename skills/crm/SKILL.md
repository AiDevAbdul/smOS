---
name: crm
description: Use this skill to manage the agency's sales/client pipeline — one deal record per company tracked from lead through contacted, audited, proposed, negotiating, won, lost, and churned, with a state-machine-enforced stage flow and a weighted revenue forecast. This skill should be used when the user wants to add/advance/inspect deals, log sales activities, see the pipeline forecast, or import existing prospects/clients (typically via `/crm`). It is the Phase 5 Agency-OS foundation that /proposal, /contract, and /billing all read and write through.
---

# /crm — Agency Pipeline (Phase 5 · Agency OS foundation)

<!--
Keep this file lean. Heavy domain knowledge, full schemas, and examples live in
references/*.md and are read on demand (progressive disclosure + token efficiency).
-->

Maintain one **deal** record per company as it moves through the sales pipeline, and surface a weighted revenue forecast. This skill is the commercial spine of smOS: it unifies the previously-separate `prospects/` (pre-audit) and `clients/` (signed) worlds into one queryable pipeline that `/proposal`, `/contract`, and `/billing` hang off via `deal.links` and `deal.deal` terms.

## What This Skill Does

- Run `node skills/crm/crm.js <cmd>` for these subcommands: `add`, `list`, `show`, `stage`, `log`, `set`, `sync`, `next`.
- Enforce the stage state machine (`schemas/deal.js` `TRANSITIONS`) — block illegal jumps (e.g. `lead → won`) unless the user authorizes `--force`.
- Auto-set close probability per stage and compute a **weighted annual pipeline** plus **active MRR** forecast.
- Block any `won` transition that lacks a `links.proposal` (fail-closed schema gate).
- Persist to `crm/pipeline.json` (canonical) and best-effort mirror to the Supabase `deals` table.
- Import existing `prospects/` (→ `audited` if a pre-audit HTML exists, else `lead`) and signed `clients/` (→ `won`) via `sync`.

## What This Skill Does NOT Do

- Generate the pitch deck / proposal artifact — that is `/proposal` (it sets `stage=proposed` + `links.proposal`).
- Produce the service agreement or e-sign it — that is `/contract` (sets `links.contract`).
- Issue invoices or charge retainers — that is `/billing` (Stripe).
- Onboard a won deal into a working client (profile + per-client `CLAUDE.md` + `clients` row) — that is `/intake`.
- Run the public-data prospect audit — that is `/pre-audit` (sets `stage=audited` + `links.pre_audit`).

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/crm/crm.js`, `schemas/deal.js` (`STAGES`, `TRANSITIONS`, `STAGE_PROBABILITY`, `weightedValue`), `scripts/lib/crm-store.js`, `scripts/lib/supabase.js`, `scripts/lib/load-env.js` |
| **Conversation** | The slug, company name, retainer, stage, or activity the user already named |
| **Skill References** | `references/domain-standards.md` (stages, probabilities, forecast formulas), `references/io-contract.md` (deal schema + handoffs), `references/api-reference.md` (Supabase mirror) |
| **Existing pipeline** | `crm/pipeline.json` — run `crm show <slug>` / `crm list` before mutating |

## Clarifications

> Before asking: check the conversation, `crm/pipeline.json`, and prior handoff files.
> Only ask for what cannot be determined. Stage taxonomy, probabilities, and forecast
> math are embedded in `references/` — never ask the user for them. The Supabase mirror
> is env-driven and auto-detected — never ask the user about it.

**Required (must resolve before running):**
1. The deal `<slug>` to act on (and for `add`, the company `--name`).
2. For `stage`: the target stage (must be a valid `TRANSITIONS` move, or the user must explicitly authorize `--force` + a recorded reason).

**Optional (ask only if relevant):**
3. Retainer amount / currency / source / owner / next action when adding or updating a deal.

## Workflow

1. **Bootstrap once:** run `crm sync` to import existing prospects and clients so the pipeline reflects reality.
2. **Add a new lead:** `crm add <slug> --name "Acme Co" --email a@acme.co --retainer 2000 --currency USD --source referral`.
3. **Advance the stage as work happens:** `crm stage <slug> <newstage> --note "..."`. The state machine blocks illegal jumps; probability and forecast update automatically.
4. **Set `links.proposal` before marking `won`:** `crm set <slug> link.proposal=...` — `schemas/deal.js` fail-closes otherwise.
5. **Log touches** with `crm log <slug> --type call --note "..."` and track follow-ups with `crm set <slug> next_action="..." next_action_due=YYYY-MM-DD`; review with `crm next`.
6. **Hand off after `won`:** route to `/intake`, then `/contract` + `/billing`.

## Input / Output Specification

**Inputs:** subcommand + `<slug>` + `--flag value` pairs and/or `key=value` pairs (e.g. `next_action="..."`, `link.proposal=...`). Env: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (optional, for mirroring).
**Outputs:** mutations to `crm/pipeline.json` (array of normalized deals); JSON printed to stdout per command (`pipeline` summary, deal record, transition result); best-effort upsert to Supabase `deals`.
(Full schemas, every flag, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Company name, contact, slug, source, owner | The eight stages and their lifecycle order |
| Retainer amount, currency, setup fee | The `TRANSITIONS` state machine (legal moves) |
| Current stage, next action, due date | Per-stage default probabilities |
| Activity log entries | Weighted-forecast formula (retainer × 12 × prob) |
| Which handoff links exist | The `won` ⇒ `links.proposal` fail-closed gate |

## Domain Standards

### Must Follow
- [ ] Resolve every stage change through `crm stage` so `TRANSITIONS` and probability stay authoritative.
- [ ] Set `links.proposal` before any `won` transition.
- [ ] Use `--force` only with an explicit user-authorized `--reason`/`--note` recording why the state machine was overridden.
- [ ] Treat `crm/pipeline.json` as the canonical store; never hand-edit it — go through the CLI so validation runs.

### Must Avoid
- Inventing stages, probabilities, or forecast math (all live in `schemas/deal.js`).
- Marking a deal `won` to "make the forecast look good" without the proposal artifact.
- Blocking the local write on a Supabase failure — mirroring is best-effort only.

### Output Checklist (verify before delivery)
- [ ] The CLI exited 0 (non-zero = validation/transition failure; surface the message verbatim).
- [ ] `crm/pipeline.json` validates against `schemas/deal.js` (the CLI enforces this on write).
- [ ] Stage, probability, and `updated_at` reflect the intended change.
- [ ] Handoff links the next skill needs (`pre_audit`/`proposal`/`contract`/`client_profile`) are present.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing required input (`add` without slug) | Halt; CLI exits 1 naming the missing field — never guess |
| Deal not found (`show`/`stage`/`set`/`log`) | CLI exits 2; suggest `crm add <slug>` |
| Duplicate slug on `add` | CLI exits 2; tell the user to use `stage`/`set` |
| Illegal stage transition | CLI exits 4 listing allowed moves; do not `--force` without user authorization |
| `won` without `links.proposal` (or other schema failure) | CLI exits 3 with the validation error; set the link first |
| Unknown `key=value` field on `set` | CLI exits 1 naming the field |
| Supabase mirror error | Swallowed/best-effort; local write still succeeds — never block the pipeline |
| Corrupt/missing `pipeline.json` | `loadPipeline()` returns `[]`; the next write recreates it — do not panic-fix by hand |

## Dependencies & Security

- **Reuses:** `schemas/deal.js` (via `schemas/index.js`), `scripts/lib/crm-store.js`, `scripts/lib/supabase.js`, `scripts/lib/load-env.js`.
- **Runtime:** Node.js (ESM); no external advertising/payment API calls in the core flow.
- **External APIs:** Supabase PostgREST only, for the optional best-effort mirror (no Meta/Stripe calls here).
- **Secrets:** `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` resolved from env via `load-env.js` (`~/.config/smos/.env`, chmod 600) — never hardcoded or logged.

## Documentation & References

CRM makes no external advertising/payment API calls — it is a local JSON pipeline with an
optional best-effort Supabase mirror. The relevant external surface is therefore the
**Supabase PostgREST upsert** the mirror uses, plus the downstream skills a `won` deal
hands off to. Fetch a row below only when behavior is ambiguous; otherwise the verified
values in `references/` are authoritative.

| Resource | URL | Use For |
|----------|-----|---------|
| PostgREST — Insert/Upsert (resolution=merge-duplicates) | https://postgrest.org/en/stable/references/api/tables_views.html#upsert | The exact `Prefer: resolution=merge-duplicates` + `on_conflict` semantics the mirror relies on |
| Supabase REST (PostgREST) | https://supabase.com/docs/guides/api | How `SUPABASE_URL/rest/v1/<table>` + service key bypasses RLS (the mirror's access pattern) |
| Stripe Invoices | https://docs.stripe.com/api/invoices | Downstream `won → /billing` handoff — what `links`/`deal` feed retainer invoicing |
| Dropbox Sign — Signature Request | https://developers.hellosign.com/api/signature-request | Downstream `won → /contract` handoff — e-sign of the service agreement |

**How to fetch & use:** when a Supabase mirror call returns an unexpected status,
`WebFetch` the PostgREST upsert page and confirm the `Prefer` header + `on_conflict`
query param match `scripts/lib/supabase.js`; do not change the conflict key without
confirming `slug` has a unique constraint. For downstream handoffs, fetch the Stripe /
Dropbox Sign pages only when wiring those skills — CRM only needs to know which `links`
they read.

**Good vs bad doc use:**
- Good: mirror upsert returns HTTP 409 → fetch the PostgREST upsert page → confirm `resolution=merge-duplicates` is set and `on_conflict=slug` targets a real unique constraint → fix the constraint, not the CLI.
- Bad: invent a Supabase batch limit or a `won`-probability value from memory → instead read `references/domain-standards.md` (schema-derived) or fetch the cited page.

For the full canonical doc-URL map see `skills/references-shared.md`.

**Last verified:** 2026-06-22

### Keeping Current

The stage list, transition matrix, per-stage probabilities, and forecast math in
`references/` are **derived from `schemas/deal.js`**, not independent constants. Re-verify
them whenever `schemas/deal.js` or `skills/crm/crm.js` changes:

1. Diff `STAGES`, `TRANSITIONS`, `STAGE_PROBABILITY`, and `weightedValue` against `references/domain-standards.md`.
2. Diff the mirrored column list in `persist()` (crm.js) / `mirror()` (crm-store.js) against `references/api-reference.md`.
3. Re-confirm Supabase/PostgREST upsert semantics against the cited URLs and update the **Last verified** date above and in each `references/*.md`.

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Stage taxonomy, transition matrix, per-stage probabilities, forecast formulas, activity types, good/bad pipeline examples |
| `references/api-reference.md` | The Supabase PostgREST upsert the mirror uses (endpoint, headers, conflict key, mirrored columns, rate/error behavior) + downstream handoff contract |
| `references/io-contract.md` | Full deal JSON schema, every CLI flag/exit code, example command payloads, `sync` reconciliation, edge-case handling |
