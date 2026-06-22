# /scale — Domain Standards

Embedded scaling expertise: the flag taxonomy, the flag→action decision rules,
thresholds/multipliers, the fail-closed safety-gate stack, and worked examples.
Read independently of SKILL.md.

---

## 1. Operating model

`/scale` is **execution-only**. It never calls the Meta read API for metrics. It
consumes the `flags` array produced by `/analyze` (`performance_analysis.json`) and
turns each flag into a deterministic decision — there are **no LLM calls** in the
decision path. Two modes:

- **DRY-RUN (default):** compute every decision, write `scaling_log.json`, mutate nothing on Meta. Status of actionable items = `dry_run`.
- **EXECUTE (`--execute`):** send writes through the guarded Graph client. Status = `applied` (or `error`).

Mutating the account always goes through `scripts/lib/meta-graph.js` → `guardGraphWrite`, so the `budget-guard` and other chokepoint rules apply regardless of this skill's own gates (defense in depth).

---

## 2. Flag taxonomy → decision

`/analyze` emits flags; `decisionFromFlag()` maps each one:

| Flag (from `/analyze`) | Decision | Entity | Auto-eligible? | Notes |
|---|---|---|---|---|
| `PAUSE_CANDIDATE_CPA` | pause (`status: PAUSED`) | ad | yes* | * only if metrics plausible |
| `PAUSE_CANDIDATE_ROAS` | pause | ad | yes* | |
| `PAUSE_CANDIDATE_CTR` | pause | ad | yes* | |
| `PAUSE_CANDIDATE_FREQUENCY` | pause | ad | yes* | |
| `SCALE_CANDIDATE` | scale `daily_budget × 1.2` | adset | yes, unless over ceiling / insignificant / no budget | over-ceiling → approval queue |
| `SCALE_WATCH` | flag only | adset | no | ROAS qualifies but conversions < `scale_min_conversions` (default 15) — too thin |
| `DUPLICATE_CANDIDATE` | clone adset at `× 0.5`, PAUSED | adset | yes* | top ROAS in campaign (>2× next-best); emitted by `/analyze` |
| `CREATIVE_FATIGUE` | flag only | (carried) | n/a (digest) | never pause silently |
| `ANOMALY_delivery_stall` | flag only | (carried) | n/a (digest) | |
| `ANOMALY_attribution` | flag only | (carried) | n/a (digest) | |
| `ANOMALY_spend_spike` | flag only | (carried) | n/a (digest) | |
| (any unknown flag) | flag only | (carried) | no | safe default |

A decision is **actionable** (counts toward the circuit breaker, runs in the execute loop) only if it carries an `endpoint` to mutate or a `source_id` to clone. Everything else is flag-only.

---

## 3. Multipliers & ceilings (CONSTANT)

| Constant | Value | Meaning |
|---|---|---|
| `SCALE_MULTIPLIER` | 1.2 | +20% daily budget on a qualifying winner |
| `DUPLICATE_BUDGET_MULTIPLIER` | 0.5 | clone built at half the source's daily budget (min 1 cent) |
| `AUTO_SCALE_DELTA_CEILING_CENTS` | 50_000 | scale delta > $500/day → approval queue, not auto |
| `BUDGET_INCREASE_CEILING_CENTS` | 50_000 | $500/day single-action global block |
| `MAX_ANALYSIS_AGE_HOURS` | 4 | refuse analysis older than this (no `--force`) |
| `BUSINESS_HOURS` | 6–21 | 6 AM–9 PM client timezone window |

Budgets are handled in **cents** end to end. Meta `daily_budget` is sent as a string of cents.

---

## 4. The fail-closed safety-gate stack

Order matters: each gate can halt the run or downgrade an action before any write.

1. **Freshness gate** — `performance_analysis.json` must be ≤ 4h old, else exit 4 (override `--force`).
2. **Business-hours gate** — must be 6 AM–9 PM in the client timezone, else exit 5. **Fail-closed:** unknown/invalid timezone in autonomous mode counts as *outside* the window. (`--force` / operator mode keeps the lenient legacy behavior.)
3. **Per-action metric-sanity gate** (`metricsArePlausible`) — refuse to act on an entity whose `spend ≤ 0` or `impressions < MIN_IMPRESSIONS_FOR_ACTION` (100). Guards against the "API returned null/zero → every ad reads as a breach" failure. A pause/scale/duplicate on implausible metrics downgrades to flag-only with a `bad-data guard` reason.
4. **Significance gate (defense-in-depth)** — `SCALE_CANDIDATE` whose carried `significance.significant === false` is refused for auto-scale and downgraded to flag-only. (`/analyze` already gates this; `/scale` re-checks in case a stale/hand-edited analysis slips one through.)
5. **Budget ceiling gate** — a scale whose delta exceeds $500/day is marked non-auto and routed to the approval queue. The `budget-guard` chokepoint would block it anyway.
6. **Run-level circuit breaker** — at `--execute`, if auto-actions exceed `MAX_AUTO_ACTIONS_ABS` (25) **or** `MAX_AUTO_ACTIONS_PCT` (50%) of active entities, refuse the whole run (exit 6). Prevents a garbage analysis (every entity reading as a breach) from mass-mutating the account. Override `--force`.

---

## 5. Conflict resolution

Flags are grouped by `entity_id` so the same entity isn't touched twice. When one
entity carries multiple decisions, priority wins: `pause (3) > scale (2) = duplicate
(2) > flag (1)`. Example: an entity with both PAUSE and ANOMALY → pause executes,
the anomaly remains visible in the digest.

---

## 6. Clone naming

The cloned adset's name is derived from the source so it stays inside the
`[PLACEMENT]_[AGE_RANGE]_[INTEREST_CODE]` convention and is distinguishable:

- `FEED_2545_FITNESS_v1` → `FEED_2545_FITNESS_v2` (bump trailing version token)
- `FEED_2545_FITNESS` → `FEED_2545_FITNESS_DUP` (no version → `_DUP` suffix)
- missing name → `DUP_ADSET`

The slim adset row in `performance_analysis.json` has no targeting/optimization_goal,
so the clone fetches the source's **full live spec** through the guarded graph
(`name, campaign_id, optimization_goal, billing_event, bid_strategy, bid_amount,
targeting, promoted_object, attribution_spec, destination_type`) and POSTs a new
adset built from it at 0.5x budget, `status: PAUSED`.

---

## 7. Rollback semantics

`--rollback [log]` reads a prior `scaling_log.json` (or an explicit path) and reverses
only `status: "applied"` decisions:

- `pause` → set `status: ACTIVE` (un-pause).
- `scale` → restore `daily_budget` to `budget_before_cents`.
- Duplicates and flags are **not** reversed (a paused clone is consequence-free; deleting it would be a destructive action).

Rollback is itself dry-run unless `--execute` is also passed.

---

## 8. Good vs bad examples

**GOOD — qualifying winner, in hours, plausible metrics:**
```
adset FEED_2545_FITNESS  daily_budget $200, ROAS 4.2 (4 days), 28 conversions, 41k impr
→ SCALE_CANDIDATE, significant=true, delta $40 ≤ $500
→ auto scale to $240/day (dry-run shows it; --execute applies it)
```

**GOOD — thin winner held back:**
```
adset REELS_1834_RUNNING  ROAS 5.1 but only 9 conversions (< 15 floor)
→ SCALE_WATCH → flag only, surfaced for human review (never auto-scaled)
```

**GOOD — top performer cloned, PAUSED:**
```
adset FEED_2545_FITNESS (top ROAS, >2× next-best) → DUPLICATE_CANDIDATE
→ --execute clones FEED_2545_FITNESS_v2 at $100/day, status PAUSED, same campaign
```

**BAD — would-be auto-pause on garbage data (correctly refused):**
```
ad IMG_PAIN_v1  spend $0, impressions 12  → PAUSE_CANDIDATE_CPA
→ metric-sanity gate: impressions < 100 → downgraded to flag-only (bad-data guard)
```

**BAD — over-ceiling scale auto-applied (never do this):**
```
adset with $3000/day budget, +20% = +$600/day delta (> $500 ceiling)
→ MUST go to approval queue (awaiting_approval), not auto. budget-guard blocks otherwise.
```
