---
name: rules
description: Use this skill to install and manage Meta-native Automated Rules — conservative, server-side guardrails (pause runaway CPA/CTR/frequency, notify on overruns/zero delivery) that fire on Meta's servers every 30 minutes even when smOS is offline. This skill should be used when the user asks to set up automated rules, real-time guardrails, or a 24/7 safety net on a client's ad account, typically via `/rules {slug} <mode>` (list, install, preview, disable, enable, history).
---

# /rules — Meta-Native Automated Rules (Paid Ops)

Install and operate a curated library of conservative guardrail rules directly on a client's Meta ad account. Rules execute on Meta's servers semi-hourly, so they catch disasters (a campaign burning budget at 2 AM) in 30–60 minutes — the window the daily optimizer agent cannot cover. This skill produces and manages those rules; it never scales budgets or changes strategy.

## What This Skill Does

- Install a fixed library of 5 conservative rules account-wide via `POST /act_{id}/adrules_library` (idempotent — skips rules already present by name).
- List all rules on the account, preview which entities currently match a rule (dry-run), enable/disable a rule, and pull a rule's last 30 executions.
- Derive each rule's thresholds from the client's `kpis` (e.g. CPA target × 5) with defensible defaults.
- Default the strictest action to `PAUSE`; never auto-scale or change targeting.
- Write a `rules_log.json` (install/skip/error) and `rule_history_<name>.json` (history mode).

## What This Skill Does NOT Do

- **Scale budgets / duplicate winners** — owned by `/scale` (optimizer agent, with Discord approval). Rules are guardrails, not strategy.
- **Nuanced scheduled optimization decisions** — owned by the daily optimizer (`/scale`, `/analyze`).
- **Launch campaigns or build ad structure** — owned by `/launch`.
- **Per-entity targeted rules** — rules install account-wide so new campaigns are covered automatically.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (createGraph, act(), isTbd), `scripts/lib/load-env.js`, `scripts/lib/guards.js` (write chokepoint), `skills/rules/rules.js` (the script) |
| **Conversation** | Which `{slug}`, which mode, any rule name the user referenced |
| **Skill References** | Templates, thresholds, and the adrules schema in `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.ad_account_id`, `kpis` (+ per-client `CLAUDE.md` KPI overrides) |

## Clarifications

> Before asking: check the conversation, the client profile, and `rules_log.json`.
> Only ask for what cannot be determined. Thresholds, the rule library, and the
> adrules schema live in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. Which mode? (`list` | `install` | `preview <template>` | `disable <name>` | `enable <name>` | `history <name>`)

**Optional (ask only if relevant):**
3. Run `install` as `--dry-run` first to inspect bodies before any real POST?
4. Is a holiday/seasonal push active that warrants temporarily `disable`-ing a PAUSE rule?

## Workflow

1. Resolve `{slug}` and confirm `clients/{slug}/client_profile.json` exists; bail if `accounts.ad_account_id` is TBD.
2. Run `node skills/rules/rules.js <slug> <mode> [args]`. The script loads env, builds the Graph client, and `act_`-normalizes the account id.
3. For `install`: read existing rules, build each template from client `kpis`, skip any existing by name, POST the rest (or only to `/preview` under `--dry-run`), then write `rules_log.json`.
4. For `preview`/`disable`/`enable`/`history`: the script finds the rule by name and acts on its id.
5. Report installed/skipped/errors to the user; flag any OAuth or rule-limit halt.

## Input / Output Specification

**Inputs:** CLI `<slug> <mode> [template|name] [--dry-run]`; `clients/{slug}/client_profile.json`; env `META_ACCESS_TOKEN` (+ optional `META_APP_SECRET`).
**Outputs:** stdout JSON `{ slug, mode, result }`; `clients/{slug}/rules_log.json` (install); `clients/{slug}/rule_history_<name>.json` (history).
(Full schemas, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| CPA target → thresholds (`cpa_target × 5`), daily_budget | The 5-rule library names, structure, and filter fields |
| Ad account id, currency, timezone | Strictest action = `PAUSE`; account-wide scope; semi-hourly schedule |
| Which rules already exist (skip set) | Idempotency by `name`; no auto-scale / no targeting change |
| Mode + rule/template name args | Graph version v25.0; entity types (AD for pauses, ADSET for notifies) |

## Domain Standards

### Must Follow
- [ ] Keep every rule conservative — strictest action is `PAUSE`; budget/targeting untouched.
- [ ] Install account-wide (no entity ids) so new campaigns are auto-covered.
- [ ] Be idempotent — skip any rule whose `name` already exists.
- [ ] Derive thresholds from `kpis`; fall back to documented defaults (CPA 50) only when absent.
- [ ] Default `install` POSTs for real; surface `--dry-run` as the safe inspect path.

### Must Avoid
- Creating rules that increase or change budgets, or change targeting.
- Hardcoding entity ids into a rule's spec.
- Retrying a failed POST automatically (let meta-graph's own backoff handle transients).

### Output Checklist (verify before delivery)
- [ ] `rules_log.json` lists every template as installed / skipped / errored.
- [ ] No rule has a non-empty entity-id list.
- [ ] CPA/CTR/frequency rules use action `PAUSE`; overrun/zero-delivery use `NOTIFICATION`.
- [ ] Spend filters are in **cents** (e.g. `$50 → 5000`); CTR is a **percent** (e.g. `0.3`).

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Exit 2, name the path — never guess |
| `accounts.ad_account_id` is TBD | Exit 3; route user to `/setup-accounts` |
| Missing `META_ACCESS_TOKEN` | createGraph throws at startup; halt with the missing var |
| Token expired/invalid (code 190/102/463/467) | `TokenExpiredError`, non-retryable — prompt re-auth, do not hammer |
| No `ads_management` permission for adrules_library | Halt, surface the OAuth scope gap |
| Rule limit reached (Meta caps ~50/account) | List existing rules, suggest pruning before install |
| Duplicate rule name | Skip, log `{reason: "already exists"}` |
| Unknown template/mode | Throw with the list of valid names; exit 1 |
| Transient Meta error (rate limit / 5xx) | meta-graph retries with backoff + jitter; no manual retry |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, guarded write chokepoint, retry, `appsecret_proof`), `scripts/lib/load-env.js`, `scripts/lib/guards.js`.
- **External APIs:** Meta Marketing API **v25.0** — `adrules_library` edge (rate limits in `references/api-reference.md`).
- **Scopes:** `ads_management` (required for reading/writing rules).
- **Secrets:** `META_ACCESS_TOKEN`, `META_APP_SECRET` resolved via env (`~/.config/smos/.env`, chmod 600) — never hardcoded or logged. `appsecret_proof` is HMAC-derived per call.
- **Type:** Automation skill — script (`rules.js`) + dependencies + error handling + I/O spec all documented above.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Ad Account adrules_library | https://developers.facebook.com/docs/marketing-api/reference/ad-account/adrules_library/ | POST `act_<id>/adrules_library`: `name`, `evaluation_spec`, `execution_spec`, `status` |
| Ad Rule node | https://developers.facebook.com/docs/marketing-api/reference/ad-rule/ | Rule object fields and operators |
| Execution Spec | https://developers.facebook.com/docs/marketing-api/ad-rules/overview/execution-spec/ | `execution_type`: PAUSE, NOTIFICATION, CHANGE_BUDGET… |
| Schedule-based rules | https://developers.facebook.com/docs/marketing-api/ad-rules/guides/scheduled-based-rules/ | `evaluation_type = SCHEDULE`; `schedule_type` (SEMI_HOURLY, HOURLY, DAILY) |
| Ad Rules engine overview | https://developers.facebook.com/docs/marketing-api/ad-rules | Trigger-based vs schedule-based model |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Marketing API Rate Limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account limits, `X-Business-Use-Case-Usage` |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | The 5-rule library, thresholds, filter/action taxonomies, formulas, good/bad rule examples |
| `references/api-reference.md` | Exact adrules_library endpoints, fields, enums, v25.0 version, rate limits + error codes |
| `references/io-contract.md` | Full JSON schemas, exit codes, and example payloads (log + history) + edge cases |
