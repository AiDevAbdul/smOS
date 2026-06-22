---
name: scale
description: Use this skill when the user asks to scale winners, kill losers, or execute scaling decisions on a performance analysis (typically via `/scale {slug}` or invoked by the optimizer agent). Pauses underperformers, scales qualifying winners +20%, clones top performers at 0.5x PAUSED for budget tests, queues over-ceiling/insignificant moves for Discord approval, and logs every decision to `scaling_log.json` + Supabase `optimizer_log`. Dry-run by default; mutates Meta only with `--execute`; supports `--rollback`.
---

# /scale — Execute Scaling Decisions (Phase 4)

Consume a fresh `/analyze` output and turn its flags into concrete Meta account
actions: pause underperformers, scale qualifying winners +20%, clone the campaign's
top performer at half budget (PAUSED), and queue anything risky for human approval.
The skill is execution-only — it never re-fetches metrics — and is safe by default:
DRY-RUN runs without `--execute`, and a stack of fail-closed gates blocks mass
mutations from garbage data.

## What This Skill Does

- Run `node skills/scale/scale.js <slug> [--execute] [--force] [--rollback [log]]`.
- DRY-RUN by default: compute every decision, write `scaling_log.json`, mutate **nothing** on Meta. `--execute` is required to send writes.
- Map each `/analyze` flag to a decision: pause (ad), scale +20% (adset), duplicate at 0.5x PAUSED (adset), flag-only, or approval-queue.
- Enforce fail-closed safety: run-level circuit breaker (`MAX_AUTO_ACTIONS_ABS`/`PCT`), per-action `MIN_IMPRESSIONS_FOR_ACTION` sanity gate, business-hours window (fail-closed on unknown timezone), and $500/day single-increase ceiling.
- Route over-ceiling scales, thin (`SCALE_WATCH`) and significance-failed winners to an approval queue (`status: awaiting_approval`); flag fatigue/anomalies for the digest.
- At `--execute`, clone a qualifying `DUPLICATE_CANDIDATE` adset via the guarded chokepoint — fetch the source's live spec, POST a new adset at 0.5x daily budget, `status: PAUSED`.
- Persist: write `clients/<slug>/scaling_log.json` and (when configured) one `optimizer_log` row per run.
- `--rollback` reverses a prior run's applied actions (un-pause, restore pre-scale budgets) — dry-run unless paired with `--execute`.

## What This Skill Does NOT Do

- **Generate flags / fetch metrics** → owned by `/analyze` (this skill only consumes `performance_analysis.json`).
- **Run an interactive Discord reply loop** → the agent posts the approval message and applies approvals manually; the `.js` only writes the queue to `scaling_log.json` + `optimizer_log`.
- **Build campaigns/ads from a brief** → owned by `/launch`.
- **Change targeting, audiences, exclusions, or campaign objective** → out of scope; absolute blocks per the constitution.
- **Activate the cloned adset** → the clone is created PAUSED; activation is a human step.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (guarded `createGraph`), `scripts/lib/guards.js` (`budget-guard`), `scripts/lib/supabase.js` (`insert`, `clientIdBySlug`), `scripts/lib/load-env.js` |
| **Conversation** | Whether the user wants a dry-run preview or to apply (`--execute`); any explicit override intent (`--force`); rollback intent |
| **Skill References** | Decision/threshold taxonomy from `references/` (see table below) |
| **Client Profile** | `clients/<slug>/client_profile.json` (`accounts.ad_account_id`, `accounts.timezone`, `kpis`) + per-client `CLAUDE.md` threshold overrides |
| **Handoff** | `clients/<slug>/performance_analysis.json` — must exist and be ≤ 4h old |

## Clarifications

> Before asking: check the conversation, the client profile, and the `performance_analysis.json` handoff.
> Only ask for what cannot be determined. Decision rules and thresholds are embedded in `references/` —
> never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. Dry-run preview, or apply changes (`--execute`)? Default to dry-run if unstated.

**Optional (ask only if relevant):**
3. Override a stale analysis / off-hours / circuit-breaker block with `--force`? (Default: no — let the gate halt.)
4. Roll back the last run instead of executing (`--rollback`)?

## Workflow

1. Confirm `performance_analysis.json` exists and is ≤ 4h old; halt otherwise (run `/analyze` first), unless `--force`.
2. Run `node skills/scale/scale.js <slug>` (dry-run) and read the JSON summary + `scaling_log.json`.
3. Review the proposed decisions: auto-actions, approval queue, flag-only. Confirm counts look sane (circuit breaker not tripped).
4. If applying, rerun with `--execute`. The script enforces business hours, the metric-sanity gate, the circuit breaker, and the budget ceiling before any write.
5. For each `awaiting_approval` entry, post one consolidated Discord approval message to `approvals.channel`; apply approved actions manually.
6. Post the daily digest (auto/flagged/anomaly counts, top performer, kills) to the client channel.
7. To undo: `node skills/scale/scale.js <slug> --rollback --execute`.

## Input / Output Specification

**Inputs:** CLI args `<slug> [--execute] [--force] [--rollback [log]]`; files `clients/<slug>/client_profile.json`, `clients/<slug>/performance_analysis.json`; env `META_ACCESS_TOKEN` (+ optional `META_APP_SECRET`, Supabase vars).
**Outputs:** `clients/<slug>/scaling_log.json` (decisions + summary), one Supabase `optimizer_log` row per run (best-effort), JSON summary on stdout, progress logs on stderr.
(Full schemas, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| KPI targets / thresholds (client `CLAUDE.md` overrides) | Flag→action mapping (`decisionFromFlag`) |
| Ad account id, timezone, currency | +20% scale multiplier, 0.5x duplicate multiplier |
| Which flags `/analyze` emits this run | $500/day single-increase ceiling, business-hours window 6 AM–9 PM |
| Number of active entities | Circuit-breaker caps (abs 25 / 50% of active), 100-impression sanity floor |
| Significance verdicts carried on flags | PAUSED-default for clones, dry-run default, fail-closed unknown-tz behavior |

## Domain Standards

### Must Follow
- [ ] Treat DRY-RUN as the default — never imply changes were applied without `--execute`.
- [ ] Respect every fail-closed gate (age ≤ 4h, business hours, circuit breaker, metric sanity, budget ceiling). Use `--force` only on explicit user instruction and surface the override.
- [ ] Route over-ceiling scales and insignificant/thin winners to the approval queue, not auto-execute.
- [ ] Create cloned adsets PAUSED, at 0.5x budget, in the source campaign.
- [ ] Log every decision to `scaling_log.json` and (when configured) `optimizer_log`.

### Must Avoid
- Auto-pausing/scaling on missing or implausible metrics (`spend ≤ 0` or `impressions < 100`).
- Auto-scaling a flag whose `significance.significant === false`.
- Activating any entity (clones stay PAUSED; un-pause is human).
- Deleting entities, changing targeting/objective, or removing exclusions.

### Output Checklist (verify before delivery)
- [ ] `scaling_log.json` written with `summary` + per-decision `status`.
- [ ] Mode reported accurately (`DRY_RUN` vs `EXECUTE`) and matches whether `--execute` was passed.
- [ ] Approval queue surfaced to Discord; nothing over-ceiling was auto-applied.
- [ ] `optimizer_log` row written, or the skip reason logged (offline/unconfigured).

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `slug` arg | Print usage, exit 1 — never guess a client |
| `client_profile.json` missing | Exit 2 |
| `performance_analysis.json` missing | Exit 3 — instruct to run `/analyze` first |
| Analysis > 4h old (no `--force`) | Exit 4 — refuse stale data |
| Outside business hours / unknown tz (no `--force`) | Exit 5 — fail-closed |
| Circuit breaker trips (auto-actions > abs 25 or > 50% active) | Exit 6 — suspect bad analysis data; inspect or `--force` |
| `--rollback` log not found | Exit 7 |
| A single `update_*`/clone call fails | Record `status: error` with message + `metaError`, continue with remaining actions (do not abort run) |
| `budget-guard` chokepoint blocks a write | Surface guard message in the decision result; post to approval queue |
| Token expired (Meta code 190) | Non-retryable `TokenExpiredError` from `meta-graph.js` — surface, prompt re-auth |
| Supabase unreachable | Skip `optimizer_log` (best-effort), log the skip; `scaling_log.json` still written |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, guarded retry/backoff), `scripts/lib/guards.js` (`budget-guard` at the write chokepoint), `scripts/lib/supabase.js` (`insert`, `clientIdBySlug`, `supabaseConfigured`), `scripts/lib/load-env.js`. Runtime: Node ≥18 (ESM), `axios`.
- **External APIs:** Meta Graph/Marketing API **v25.0** (adset budget/status writes, adset clone). Rate limits + retry behavior in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN` / `META_APP_SECRET` / Supabase keys resolved from env via `load-env.js` — never hardcoded, never logged. `appsecret_proof` is computed per call.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| AdSet node | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ | `daily_budget`, `status`, `targeting`, `optimization_goal` fields for scale/clone |
| Create adset edge | https://developers.facebook.com/docs/marketing-api/reference/ad-account/ | POST `act_<id>/adsets` to create the clone |
| Ad node | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ | Pausing an ad (`status: PAUSED`) |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, code 190 token handling |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4/17/613; `X-Business-Use-Case-Usage` backoff |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Flag taxonomy, decision rules, thresholds, multipliers, the safety-gate stack, and good/bad scaling examples |
| `references/api-reference.md` | Exact Meta v25.0 endpoints/fields used for scale + clone, rate-limit codes, and retry/guard behavior |
| `references/io-contract.md` | Full `performance_analysis.json` input + `scaling_log.json`/`optimizer_log` output schemas, exit codes, example payloads, edge cases |
