# /rules — Domain Standards

Embedded expertise for Meta Automated Rules as smOS uses them. Readable standalone.

## Why server-side rules exist alongside the optimizer

The smOS optimizer (`/scale`) runs once a day at 08:00 client-local. A brand-new campaign
that starts burning $200/hr at 02:00 (broken targeting, runaway auction) loses ~$1,200
before the optimizer notices. Meta Automated Rules evaluate on Meta's servers as often as
every 30 minutes (`SEMI_HOURLY`), so they catch the same disaster in 30–60 min.

**Division of labor:** rules = time-critical guardrails (immediate, conservative, server-side).
Optimizer = nuanced scaling/budget decisions (scheduled, human-approved via Discord). Rules
never scale or change targeting — the strictest action they take is `PAUSE`.

## The standard rule library (the 5 installed by `install`)

| Template | Trigger (filters) | Time window | Action | Entity | Why |
|---|---|---|---|---|---|
| `PAUSE_RUNAWAY_CPA` | `spent > $50` AND `cost_per_action_type:offsite_conversion.fb_pixel_purchase > cpa_target×5` | LAST_3_DAYS | PAUSE | AD | Catastrophic CPA — pause now, don't wait for daily run |
| `PAUSE_LOW_CTR_LIVE` | `spent > $50` AND `ctr < 0.3` (percent) | LAST_3_DAYS | PAUSE | AD | Creative is dead on arrival |
| `PAUSE_HIGH_FREQ` | `frequency > 5.0` | LAST_7_DAYS | PAUSE | AD | Audience burnout |
| `NOTIFY_BUDGET_OVERRUN` | `spent > {daily_budget}×1.5` | TODAY | NOTIFICATION | ADSET | Delivery oddity — investigate, do not auto-act |
| `NOTIFY_ZERO_DELIVERY` | `impressions < 1` AND `effective_status = ACTIVE` | YESTERDAY | NOTIFICATION | ADSET | Adset stuck — usually a rejection or budget exhaustion |

All five use `evaluation_type: SCHEDULE`. The first four schedule `SEMI_HOURLY`;
`NOTIFY_ZERO_DELIVERY` schedules `DAILY` (24h impressions check).

## Threshold formulas

| Threshold | Formula | Default if KPI absent |
|---|---|---|
| Runaway CPA ceiling | `kpis.cpa_target × 5` | `cpa_target = 50` → ceiling 250 |
| Min spend gate (pause rules) | flat `$50` = `5000` cents | n/a (constant) |
| Low CTR floor | flat `0.3%` | n/a (constant) |
| High frequency ceiling | flat `5.0` over 7d | n/a (constant) |
| Budget overrun | `daily_budget × 1.5` (Meta substitutes per-entity `{daily_budget}`) | n/a (constant) |

CPA field default is `cost_per_action_type:offsite_conversion.fb_pixel_purchase`
(pixel purchase). Override per client if the conversion event differs.

## Units & taxonomy gotchas (verify before delivery)

- **Spend is in cents.** `$50` → `5000`. A bare `50` would pause after 50 cents.
- **CTR is a percent**, not a ratio. `0.3%` → `0.3` (not `0.003`).
- **Frequency** is a plain float over the window.
- **Action taxonomy:** only `PAUSE` and `NOTIFICATION` appear here. `CHANGE_BUDGET` /
  `REBALANCE_BUDGET` are deliberately excluded — that is the optimizer's job.
- **Entity types:** pause rules target `AD` (kill the specific dead creative); notify rules
  target `ADSET` (delivery is an adset-level concern).
- **No entity ids:** rules install account-wide so future campaigns inherit them.

## Good vs bad rule design

**Good** — conservative, account-wide, idempotent, high spend gate:
```
PAUSE_RUNAWAY_CPA: spent > 5000 (cents) AND CPA > 250, LAST_3_DAYS, action PAUSE, entity AD
```
Pauses only a genuinely broken ad after meaningful spend; safe to leave running 24/7.

**Bad** — too aggressive / out of scope:
```
SCALE_WINNERS: ROAS > 3 → CHANGE_BUDGET +30%   ✗ auto-scaling belongs to the optimizer + Discord approval
KILL_FAST: spent > 100 (cents = $1) → PAUSE     ✗ min-spend gate far too low; pauses before learning
PAUSE_CAMP_123: entity_id 123… → PAUSE          ✗ entity-scoped; new campaigns not covered
```

## Operational notes

- Meta caps roughly **50 rules per ad account**. If `install` errors on the limit, list
  existing rules and prune before retrying.
- During a holiday/seasonal push, `disable <name>` a PAUSE rule rather than deleting it;
  `enable` it again afterward.
- `preview <template>` calls Meta's `/preview` to show which entities *currently* match —
  use it to sanity-check thresholds before trusting a live rule.
