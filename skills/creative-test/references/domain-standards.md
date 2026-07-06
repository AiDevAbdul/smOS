# /creative-test — Domain Standards

Embedded creative-testing expertise: why creative is the 2026 performance lever, the
concept × hook × format design, the statistical decision rules, the thresholds, and
worked good/bad examples. Read independently of SKILL.md.

---

## 1. Operating model

`/creative-test` is a **plan-or-evaluate** skill with **no Meta API calls** — the decision
path is pure local statistics (`scripts/lib/stats.js`), the same library that gates `/scale`,
so testing and scaling speak one statistical language. Two modes:

- **PLAN (default / `--plan`):** read approved `strategy_brief.creative_angles` + `ad_copy.json`
  and build a **concept × hook × format** test matrix — one cell per angle, the first angle the
  control, every challenger measured against it. All cells `PAUSED`. No metrics are read.
- **EVALUATE (`--evaluate`):** read per-cell `creative_test_results.json`
  (`impressions` / `results` / `spend`), rank cells by Wilson lower-bound rate, and crown a
  winner **only** if it beats control on a two-proportion z-test AND clears the conversion gate.

There are no LLM calls in the decision path — plan generation and winner selection are
deterministic.

---

## 2. Why creative, why this design

In 2026, with broad Advantage+ audiences and automated bidding, the dominant controllable
lever is **creative volume and quality**, not targeting. The smOS paid loop could write copy
(`/creative`), QA visuals (`/audit-creative`), and detect fatigue (`/creative-intel`) — but had
no loop that *ran a real experiment*. This skill closes that gap.

**Concept × hook × format matrix.** One cell per creative angle from the strategy brief:

- **Concept** — the underlying angle/message (e.g. "pain", "social proof", "speed").
- **Hook** — the opening line/visual that earns the scroll-stop (the `hook_code`).
- **Format** — `single_image`, `video`, `carousel` (carried from the angle).

The **first angle is the control** (the incumbent). Every other cell is a **challenger**
measured against it, so the test answers the only question that matters: *which hook beats the
one we'd otherwise run?* Launch all cells as ads inside **one** ad set (or one Advantage+
Creative / Dynamic Creative ad set) so they share audience + budget and compete cleanly — never
split across ad sets (that confounds the creative effect with delivery differences).

---

## 3. Statistical decision rules

| Constant | Value | Why |
|---|---|---|
| `MIN_RESULTS_PER_CELL` | 50 | Floor before a cell's rate is read at all — fewer and the rate is noise. |
| `MIN_CONVERSIONS_FOR_WIN` | 25 | Significance gate on the *leader* before any winner is crowned (mirrors `/scale`). |
| Confidence | 95% | Two-proportion z-test threshold (`|z| ≥ 1.96`). |

**Winner criteria (all must hold):**
1. The candidate is **not** the control.
2. Its rate beats control **and** the two-proportion z-test is significant @95% (`twoProportionZ`).
3. The candidate clears the conversion gate (`scaleSignificance(results, 25)`).

**Ranking** is by **Wilson lower bound** (`wilsonLowerBound`), not raw rate — this penalizes
cells with thin samples so a 2/3 fluke never outranks a stable 240/18000.

If no cell satisfies all three → verdict `NO_SIGNIFICANT_WINNER`: keep running to reach sample,
or refresh hooks. **Never** scale on noise.

---

## 4. Good / bad examples

**Good — honest no-call.** Three cells, leader at 18 conversions, z significant. Conversion gate
(25) not cleared → return `NO_SIGNIFICANT_WINNER`, advise "keep running." Correct: significance
without the conversion floor is a coin flip dressed as a result.

**Good — clean win.** Challenger `SPEED_VID` at 0.0145 rate (260/18000) vs control `PAIN_IMG` at
0.0102, z = 3.1, 260 conversions. Beats control, significant, gate cleared → `WINNER`, route to
`/scale`, iterate the winning concept in `/creative`.

**Bad — split delivery (avoid).** Launching each cell in its own ad set. Now budget and audience
differ per cell; a "winner" may just be the cell the algorithm fed. Always one ad set.

**Bad — raw-rate ranking (avoid).** Crowning a 3/100 (0.03) cell over a 240/18000 (0.0133) cell on
raw rate. Wilson lower bound exists precisely to stop this.

---

## 5. Must Follow / Must Avoid

### Must Follow
- [ ] Make the **first angle the control**; measure every challenger against it.
- [ ] Launch all cells in **one** ad set (or one Advantage+/Dynamic Creative ad set) — shared audience + budget.
- [ ] Keep every cell `PAUSED` in the plan; activation is `/launch` + a human step.
- [ ] Require **both** statistical significance @95% **and** ≥25 conversions on the leader before crowning a winner.
- [ ] Rank by Wilson lower bound, not raw rate.

### Must Avoid
- Crowning a winner on insufficient sample/conversions (`NO_SIGNIFICANT_WINNER` is the correct, honest output).
- Splitting cells across ad sets (confounds creative with delivery).
- Re-fetching metrics (out of scope — `/analyze` supplies results) or mutating budgets (owned by `/scale`).
- Reporting a winner when the control cell is missing from results — that is a hard error, not a no-winner.
