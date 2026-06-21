---
name: rules
description: Use this skill when the user asks to set up automated rules, real-time guardrails, or 24/7 safety nets on a client's ad account (typically via `/rules {slug}`). Creates Meta-native automated rules that fire on Meta's servers — they keep working even when smOS is offline. Complements the daily optimizer agent: optimizer handles nuanced decisions on a schedule; rules handle time-critical guardrails immediately.
---

# /rules — Meta-Native Automated Rules

## Why this matters

The smOS optimizer runs once a day at 08:00 client-local. If a brand-new campaign starts burning $200/hr at 02:00 because of a broken targeting setup, you lose ~$1,200 before the optimizer notices. Meta Automated Rules execute on Meta's servers as often as every 30 minutes — they catch this in 30–60 min, not 6 hours.

Rules are **guardrails, not strategy**. They should be conservative: pause obvious losers, notify on anomalies. Leave nuanced scaling/optimization to the optimizer agent.

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.ad_account_id`, `kpis`
- Meta Graph API with `ads_management` scope

## Standard rule library

`/rules {slug} install` installs the standard set; `/rules {slug} list` shows what's there.

| Template | Trigger | Action | Why |
|---|---|---|---|
| `PAUSE_RUNAWAY_CPA` | spend > $50/day AND CPA > 5× target over last 3d | PAUSE | Catastrophic CPA — pause immediately, do not wait for daily optimizer |
| `PAUSE_LOW_CTR_LIVE` | spend > $50 AND link CTR < 0.3% over last 3d | PAUSE | Creative is dead in the water |
| `PAUSE_HIGH_FREQ` | frequency > 5 over last 7d | PAUSE | Burnout territory |
| `NOTIFY_BUDGET_OVERRUN` | daily spend > 1.5× daily_budget | NOTIFICATION | Delivery oddity — investigate |
| `NOTIFY_ZERO_DELIVERY` | active, impressions = 0 in last 24h | NOTIFICATION | Adset stuck — usually a rejection or budget exhaustion |

These are **defensible defaults**. They will not auto-scale; they will not change budgets; they will not change targeting. The strictest action is PAUSE.

## Modes

`node skills/rules/rules.js <slug> <mode> [args]`

- `list` — Show all rules currently on the account
- `install` — Create the standard set (skips any that already exist by name)
- `preview <template>` — Show which entities would currently match (dry-run via Meta's `/preview`)
- `disable <name>` — Set status DISABLED (use during a holiday push)
- `enable <name>` — Set status ENABLED
- `history <name>` — Last 30 executions of that rule

## Workflow (`install` mode)

1. Read existing rules via `GET /act_{id}/adrules_library`
2. For each template, check if a rule with the same `name` exists
3. If missing, build the `evaluation_spec` + `execution_spec` from the template + client KPI overrides
4. POST to `/act_{id}/adrules_library`
5. Output `clients/{slug}/rules_log.json` with what was installed/skipped

## Guardrails inside this skill

- Never creates rules that auto-scale budgets — that's the optimizer agent's job, with Discord approval
- Never targets specific entity IDs in the install — rules apply account-wide so they cover new campaigns automatically
- `--dry-run` (default OFF for `install`) only POSTs to `/preview`, never to the real endpoint

## Output

- `clients/{slug}/rules_log.json` — log of every rule action (install/disable/enable)
- For `history`: written to `clients/{slug}/rule_history_<name>.json`

## Error Handling

- Account doesn't have permission for adrules_library → halt with the OAuth gap
- Rule limit reached (Meta caps ~50/account) → list what's there, suggest pruning
- Duplicate name → skip, log "exists"
