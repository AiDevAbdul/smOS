---
name: creative-test
description: Use this skill when the user wants to design or evaluate a structured creative test on Meta — A/B/n testing ad hooks, concepts, or formats (typically `/creative-test {slug}`). In 2026 performance is won at the creative-volume level, so this skill turns approved angles + copy into a disciplined concept × hook × format experiment, then calls a winner with real statistical significance (two-proportion z-test, conversion-count gate) when results return. Plan mode by default; `--evaluate` reads results and picks a winner. Never crowns a winner on insufficient data.
---

# /creative-test — Structured Creative Testing (Phase 1)

Closes the highest-leverage paid gap: smOS could write copy (`/creative`), QA visuals
(`/audit-creative`), and detect fatigue (`/creative-intel`), but had **no loop that runs
a real creative experiment**. Creative is the dominant 2026 performance lever — this skill
makes testing systematic and statistically honest. It is **pure-local** (no Meta API calls)
and reuses the same `scripts/lib/stats.js` rigor that gates `/scale`.

## What This Skill Does

- Run `node skills/creative-test/creative-test.js <slug> [--plan|--evaluate] [--metric=ctr|cvr]`.
- **Plan mode (default):** read approved `strategy_brief.creative_angles` + `ad_copy.json`
  and build a **concept × hook × format test matrix** — one cell per angle, the first angle
  as control, every challenger measured against it. Writes `creative_test_plan.json` + `.md`
  + design-system HTML/PDF. All cells `PAUSED`.
- **Evaluate mode (`--evaluate`):** read `creative_test_results.json` (per-cell
  `impressions` / `results` / `spend`), rank cells by their **Wilson lower-bound** rate,
  then declare a winner only if it beats control on a **two-proportion z-test @95%** AND
  clears the **minimum-conversion gate** (≥25 conversions). Writes `creative_test_decision.json`.

## What This Skill Does NOT Do

- **Launch the cells** → hand the plan to `/launch` (one ad set, all cells as ads, PAUSED;
  or an Advantage+ Creative / Dynamic Creative ad set so cells share audience + budget).
- **Fetch metrics** → supply `creative_test_results.json` from `/analyze` output.
- **Scale the winner** → the decision routes to `/scale`, which owns budget mutation.
- **Crown a winner on noise** → fail-closed: below sample/significance it returns
  `NO_SIGNIFICANT_WINNER` and tells you to keep running or refresh hooks.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/stats.js` (`twoProportionZ`, `scaleSignificance`, `wilsonLowerBound`), `scripts/lib/paths.js` (`clientFile`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`), `schemas/index.js` (`strategyBrief`, `adCopy`) |
| **Conversation** | Plan or evaluate? Primary metric (`ctr` default vs `cvr`) — infer from the user's goal (clicks vs conversions) |
| **Skill References** | Test design, statistical rules, thresholds from `references/` (see table below) |
| **Client files** | `clients/<slug>/strategy_brief.json` (must carry `creative_angles`), `ad_copy.json`; for evaluate, `creative_test_plan.json` + `creative_test_results.json` |
| **Handoff** | Plan consumed by `/launch`; results produced by `/analyze`; winner routed to `/scale` |

## Clarifications

> Before asking: check the conversation and the client files. Decision rules, thresholds, and the
> matrix design are embedded in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. Plan a new test, or evaluate returned results (`--evaluate`)? Default to plan if unstated.

**Optional (ask only if relevant):**
3. Primary metric — CTR (default) or CVR? Infer from whether the goal is clicks or conversions.

If the user can't answer (3), default to `ctr`. If `strategy_brief.json` has no `creative_angles`,
stop and route to `/strategy-brief` rather than inventing angles.

## Workflow

1. Confirm `strategy_brief.json` exists and validates; halt to `/strategy-brief` otherwise.
2. Run `node skills/creative-test/creative-test.js <slug> [--metric=ctr|cvr]` (plan) and read the JSON summary + `creative_test_plan.json`.
3. Review the matrix: confirm the control cell, cell count, and formats look right; hand cells to `/launch` (one ad set, all PAUSED).
4. Let the test run **≥7 days** and reach minimum sample (`≥50 results/cell`).
5. Supply `/analyze` output as `creative_test_results.json`, then run `--evaluate`.
6. Read `creative_test_decision.json`: a `WINNER` routes to `/scale` (budget) and back to `/creative` (iterate the winning concept); `NO_SIGNIFICANT_WINNER` means keep running or refresh hooks — never scale on noise.

## Input / Output Specification

**Inputs:** CLI args `<slug> [--plan|--evaluate] [--metric=ctr|cvr]`; files `clients/<slug>/strategy_brief.json`, `ad_copy.json`, and (evaluate) `creative_test_plan.json` + `creative_test_results.json`.
**Outputs:** `creative_test_plan.json` + `.md` + `.html` (+ `.pdf`); (evaluate) `creative_test_decision.json`; JSON summary on stdout, progress on stderr.
(Full schemas, exit codes, example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Creative angles / hooks / formats under test | First angle = control; concept × hook × format design |
| Primary metric (`ctr` vs `cvr`) | Wilson-lower-bound ranking; two-proportion z-test @95% |
| Per-cell impressions / results / spend | `MIN_RESULTS_PER_CELL` = 50, `MIN_CONVERSIONS_FOR_WIN` = 25 |
| Number of cells, winning hook | PAUSED-default cells; fail-closed `NO_SIGNIFICANT_WINNER` |
| Client name, headlines | One-ad-set design; no Meta API, no LLM in the decision path |

## Domain Standards

### Must Follow
- [ ] First angle is the **control**; every challenger is measured against it.
- [ ] All cells `PAUSED`; launch is `/launch` + a human step.
- [ ] Require **both** z-test significance @95% **and** ≥25 conversions on the leader before crowning a winner.
- [ ] Rank cells by **Wilson lower bound**, not raw rate.
- [ ] Launch all cells in **one** ad set so they share audience + budget.

### Must Avoid
- Crowning a winner on insufficient sample/conversions — `NO_SIGNIFICANT_WINNER` is the correct honest output.
- Splitting cells across ad sets (confounds creative effect with delivery).
- Re-fetching metrics or mutating budgets (owned by `/analyze` and `/scale`).
- Inventing creative angles when the brief carries none — route to `/strategy-brief`.

### Output Checklist (verify before delivery)
- [ ] `creative_test_plan.json` written with a control cell and `cell_count` matching the matrix.
- [ ] Every cell `status: PAUSED`.
- [ ] (Evaluate) `creative_test_decision.json` verdict matches the gates — no winner without significance **and** the conversion floor.
- [ ] Mode reported accurately (`plan` vs `evaluate`) on stdout.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `slug` arg | Print usage, exit 2 — never guess a client |
| `strategy_brief.json` missing | Exit 3 — instruct to run `/strategy-brief` first |
| `creative_test_plan.json` missing (evaluate) | Exit 3 — run `--plan` first |
| `creative_test_results.json` missing (evaluate) | Exit 3 — supply per-cell impressions/results from `/analyze` |
| `strategy_brief` fails schema validation | Exit 4 — surface the validation errors |
| Control cell absent from results | Exit 4 — hard error, not a no-winner |
| Cell in results has `impressions = 0` | Rate 0 (guarded division); ranks last, never crowned |
| HTML/PDF render throws | Log to stderr, continue — JSON outputs still written |

## Dependencies & Security

- **Reuses:** `scripts/lib/stats.js` (`twoProportionZ`, `scaleSignificance`, `wilsonLowerBound`), `scripts/lib/paths.js` (`clientFile`), `scripts/lib/md_to_html.js` (`writeHtmlAndPdf`), `schemas/index.js`, `scripts/lib/load-env.js`. Runtime: Node ≥18 (ESM).
- **External APIs:** none — pure-local compute. PDF render uses the shared headless-Chromium helper.
- **Secrets:** none required for the decision path. No client data leaves the machine.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Meta — Test and Learn / split testing | https://developers.facebook.com/docs/marketing-api/guides/test-and-learn/ | How Meta structures experiments (shared audience/budget) |
| Meta — Advantage+ creative | https://developers.facebook.com/docs/marketing-api/advantage-plus-creative/ | Running cells as one Advantage+ / Dynamic Creative ad set |
| Two-proportion z-test | https://en.wikipedia.org/wiki/Test_statistic | The significance test used in `evaluateResults` |
| Wilson score interval | https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval | Why ranking uses the lower bound, not raw rate |

For patterns not covered here, fetch the official docs above. See also `skills/references-shared.md`
for the canonical doc-URL map.

**Last verified:** 2026-06-30

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Test design (concept × hook × format), the statistical decision rules, thresholds, and good/bad examples |
| `references/process-reference.md` | The `stats.js` functions used and the `/strategy-brief`→`/launch`→`/analyze`→`/scale` handoff chain |
| `references/io-contract.md` | Full input/output schemas, the results-file shape, exit codes, and edge cases |
