---
name: creative-test
description: Use this skill when the user wants to design or evaluate a structured creative test on Meta — A/B/n testing ad hooks, concepts, or formats (typically `/creative-test {slug}`). In 2026 performance is won at the creative-volume level, so this skill turns approved angles + copy into a disciplined concept × hook × format experiment, then calls a winner with real statistical significance (two-proportion z-test, conversion-count gate) when results return. Plan mode by default; `--evaluate` reads results and picks a winner. Never crowns a winner on insufficient data.
---

# /creative-test — Structured Creative Testing (Phase 1)

Closes the highest-leverage paid gap: smOS could write copy (`/creative`), QA visuals
(`/audit-creative`), and detect fatigue (`/creative-intel`), but had **no loop that runs
a real creative experiment**. Creative is the dominant 2026 performance lever — this skill
makes testing systematic and statistically honest.

## What This Skill Does

- Run `node skills/creative-test/creative-test.js <slug> [--plan|--evaluate] [--metric=ctr|cvr]`.
- **Plan mode (default):** read approved `strategy_brief.creative_angles` + `ad_copy.json`
  and build a **concept × hook × format test matrix** — one cell per angle, the first angle
  as control, every challenger measured against it. Writes `creative_test_plan.json` + `.md`
  + design-system HTML/PDF. All cells `PAUSED`.
- **Evaluate mode (`--evaluate`):** read `creative_test_results.json` (per-cell
  `impressions` / `results` / `spend`) and rank cells by their **Wilson lower-bound** rate,
  then declare a winner only if it beats control on a **two-proportion z-test @95%** AND
  clears the **minimum-conversion gate** (≥25 conversions). Writes `creative_test_decision.json`.
- Reuses the same `scripts/lib/stats.js` rigor that gates `/scale`, so testing and scaling
  speak one statistical language.

## What This Skill Does NOT Do

- **Launch the cells** → hand the plan to `/launch` (one ad set, all cells as ads, PAUSED;
  or an Advantage+ Creative / Dynamic Creative ad set so cells share audience + budget).
- **Fetch metrics** → supply `creative_test_results.json` from `/analyze` output.
- **Scale the winner** → the decision routes to `/scale`, which owns budget mutation.
- **Crown a winner on noise** → fail-closed: below sample/significance it returns
  `NO_SIGNIFICANT_WINNER` and tells you to keep running or refresh hooks.

## Inputs / Outputs

- Reads: `clients/<slug>/strategy_brief.json`, `ad_copy.json`, and (evaluate)
  `creative_test_results.json`.
- Writes: `creative_test_plan.json` + `.md` + `.html` (+ `.pdf`), and `creative_test_decision.json`.

## Results file shape (`creative_test_results.json`)

```json
{ "cells": [ { "cell_id": "PAIN_VID", "impressions": 18000, "results": 240, "spend": 130.5 } ] }
```

`cell_id` must match the plan's cells. `results` = the primary-metric numerator
(link clicks for CTR tests, conversions for CVR tests).
