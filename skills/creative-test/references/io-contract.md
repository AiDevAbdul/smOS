# /creative-test — I/O Contract

Exact inputs, outputs, exit codes, and example payloads. Read independently of SKILL.md.

---

## Invocation

```
node skills/creative-test/creative-test.js <slug> [--plan | --evaluate] [--metric=ctr|cvr]
```

- `--plan` (default): design the matrix.
- `--evaluate`: read results, decide a winner.
- `--metric=ctr` (default) | `cvr`: primary metric. `ctr` = link clicks / impressions; `cvr` = conversions / impressions.

---

## Inputs

| File | Mode | Required | Notes |
|---|---|---|---|
| `clients/<slug>/strategy_brief.json` | plan | yes | Source of `creative_angles`; validated via `strategyBrief.normalize` + `.validate`. |
| `clients/<slug>/ad_copy.json` | plan | no | Headlines per angle (`selectTopCopy`); falls back to `null` headline if absent. |
| `clients/<slug>/creative_test_plan.json` | evaluate | yes | The plan written by `--plan`. |
| `clients/<slug>/creative_test_results.json` | evaluate | yes | Per-cell metrics, shape below. |

### `creative_test_results.json` shape

```json
{ "cells": [ { "cell_id": "PAIN_VID", "impressions": 18000, "results": 240, "spend": 130.5 } ] }
```

- `cell_id` **must** match a cell in the plan.
- `results` = primary-metric numerator (link clicks for CTR, conversions for CVR).
- The control cell (`plan.design.control_cell`) must appear, or evaluate hard-errors (exit 4).

---

## Outputs

### Plan mode
- `clients/<slug>/creative_test_plan.json` — `schema: "creative_test_plan/v1"`, plus `slug`,
  `generated_at`, `hypothesis`, `design` (`control_cell`, `formats_under_test`, `cell_count`),
  `primary_metric`, `cells[]`, `min_sample`, `win_criteria`, `next`.
- `creative_test_plan.md` + `.html` (+ `.pdf` via shared `writeHtmlAndPdf`; render failure is
  logged and non-fatal).
- stdout: `{ slug, mode:"plan", cells, control, metric, next }`.

Each `cells[]` entry: `cell_id`, `angle_id`, `angle`, `hook_code`, `format`, `is_control`,
`copy_headline`, `status:"PAUSED"`.

### Evaluate mode
- `clients/<slug>/creative_test_decision.json` — `{ ok, mode:"evaluate", control_cell, decision, ranked[] }`.
  - `decision.verdict` ∈ `WINNER` | `NO_SIGNIFICANT_WINNER`, with `cell_id` (winner) + `action`.
  - `ranked[]` (sorted by `rate_lower_bound_95` desc): `cell_id`, `hook_code`, `is_control`,
    `impressions`, `results`, `rate`, `rate_lower_bound_95`, `vs_control_significant`,
    `enough_conversions`, `z`.
- stdout: `{ slug, verdict, cell }`.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (plan written, or decision written). |
| 2 | Missing `slug` arg — usage printed; never guesses a client. |
| 3 | Required input file missing (`strategy_brief.json`, or in evaluate the `plan`/`results`) — HALT with which file + which skill to run first. |
| 4 | Invalid input: `strategy_brief` fails schema validation, or the control cell is absent from results. |

## Edge cases

- **No angles in brief** → an empty matrix; the brief should carry `creative_angles` (run `/strategy-brief` first).
- **A results cell with `impressions = 0`** → rate 0 (guarded division); ranks last, never crowned.
- **Cell in results not in plan** → ignored (only `plan.cells` are scored).
- **Cell in plan not in results** → skipped from `ranked` (no metrics yet).
- **HTML/PDF render throws** → logged to stderr, JSON outputs still written (degrade gracefully).
