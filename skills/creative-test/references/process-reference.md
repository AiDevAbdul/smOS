# /creative-test — Process & Statistics Reference

This skill makes **no external API calls**. Its "API" is the local statistics library and the
skill-to-skill handoff contract. Read this for the exact statistical functions used and how
`/creative-test` chains with `/strategy-brief`, `/creative`, `/launch`, `/analyze`, and `/scale`.

---

## 1. Statistical library (`scripts/lib/stats.js`)

Reused verbatim — the same functions that gate `/scale`, so a "winner" here and a "scale" there
mean the same thing.

| Function | Signature | Used for |
|---|---|---|
| `twoProportionZ` | `(aSucc, aTotal, bSucc, bTotal) → { z, significant }` | Challenger-vs-control test @95% (`|z| ≥ 1.96`). |
| `scaleSignificance` | `(conversions, min) → { significant }` | Conversion-count gate on the leader (`min = 25`). |
| `wilsonLowerBound` | `(succ, total) → number` | Sample-penalized ranking key for all cells. |

**Why Wilson over raw rate:** the lower bound of the Wilson score interval shrinks toward 0 as the
sample shrinks, so thin cells cannot outrank stable ones. This is the ranking sort key in
`evaluateResults()`.

---

## 2. Handoff chain (no re-derivation)

```
/strategy-brief ──(creative_angles)──┐
/creative ───────(ad_copy.json)──────┤→ /creative-test --plan → creative_test_plan.json
                                                                      │
                                          /launch (cells as ads, PAUSED, one ad set)
                                                                      │
                                          /analyze (≥7 days, ≥ sample) → creative_test_results.json
                                                                      │
                              /creative-test --evaluate → creative_test_decision.json
                                                                      │
                                    WINNER → /scale (budget) ; iterate concept → /creative
```

- **Reads, never re-derives:** angles come from `strategy_brief.json`; copy from `ad_copy.json`;
  metrics from `creative_test_results.json` (supplied by `/analyze`).
- **Writes the contract `/launch` and `/scale` expect:** `cell_id`, `is_control`, `format`, `status: PAUSED`.

## 3. Boundary — what this skill does NOT touch

| Concern | Owner |
|---|---|
| Launching the cells (creating ads/ad sets on Meta) | `/launch` |
| Fetching live metrics | `/analyze` |
| Mutating budgets / scaling the winner | `/scale` |
| Writing new copy for the winning concept | `/creative` |

## 4. Versioning / freshness

No Meta API surface, so no API-version coupling. The only external contract is the shape of
`/analyze`'s results (`impressions`/`results`/`spend` per cell) and `/strategy-brief`'s
`creative_angles`. If either upstream schema changes, re-verify `buildTestPlan` /
`evaluateResults` field reads against `io-contract.md`.

**Last verified:** 2026-06-30
