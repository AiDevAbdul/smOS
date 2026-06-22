# Attribution / Incrementality — Domain Standards

Self-contained domain knowledge for `/attribution`. The skill measures whether ads
*cause* incremental conversions, not just which touchpoint they sat on. This file
holds the methods, formulas, thresholds, and good/bad examples so the model never
has to discover them at runtime.

## Why incrementality (not last-click)

Last-click (and any positional model) credits a conversion to whichever ad the
user last touched. It says nothing about whether the conversion *would have
happened anyway*. Incrementality answers the only question that matters for spend
decisions: **how many conversions did the ad cause that would not have occurred
without it?** A campaign can have great last-click ROAS and ~zero incrementality
(it was retargeting people already going to buy). The job of this skill is to make
that gap visible and refuse to hide it.

## Measurement methods (the allowed `method` enum)

`schemas/attribution_report.js` exports `METHODS`. Each value is a claim about HOW
the incremental number was produced. A report MUST carry exactly one.

| `method` | What it is | Rigor |
|----------|-----------|-------|
| `meta_lift_study` | Meta Conversion Lift — randomized test vs holdout cell run inside Meta | Highest (RCT) |
| `geo_holdout` | Geographic split: matched markets get ads vs withheld | High (quasi-experimental) |
| `ghost_ads` | Holdout users shown a placebo/PSA; compare conversion rates | High |
| `incremental_attribution` | Meta's modeled Incremental Attribution insights column | Medium (modeled) |
| `modeled` | Any other media-mix / modeled estimate | Lowest — label clearly |

Rule: the method label is a truth claim. Do not tag a modeled estimate as
`meta_lift_study`. If unsure which a provided export came from, use `modeled`.

## Formulas

Per campaign row:

- **Incremental conversions** = conversions in the exposed (test) cell − expected
  conversions from the control/holdout cell, scaled to the test population.
  (For a Meta lift study this is reported directly per cell — do not recompute.)
- **Incremental CPA** = `spend / incremental_conversions`.
  Always higher than last-click CPA. If it is *not*, the cell is suspect.
- **Lift factor (incrementality_factor)** = `incremental_conversions / last_click_conversions`.
  - `< 0.3` — most credited conversions were not caused by the ad (retargeting cannibalization warning).
  - `0.3 – 0.7` — typical for healthy prospecting; meaningful but not 1:1.
  - `> 0.7` — strong incremental driver.
  - `> 1.0` — the ad drove conversions beyond what last-click even captured (view-through / cross-device).
- **Confidence** — carry the study's significance (`p_value` or stated confidence). A
  lift number without significance is directional only; flag it.

## Thresholds & decision guidance

| Signal | Reading | Action it informs (other skills act) |
|--------|---------|--------------------------------------|
| Incremental CPA ≤ client target CPA | Genuinely efficient | Candidate to scale (`/scale`) |
| Incremental CPA > 2× last-click CPA | Last-click flatters this campaign | Re-examine before scaling |
| Lift factor < 0.3 + high last-click conv | Cannibalizing organic/existing demand | Test pausing / shift to prospecting |
| Result not significant (p ≥ 0.05) | Inconclusive | Do not act; let study finish |

This skill *reports* these; it never pauses/scales (that is `/scale` / `/rules`).

## Good vs bad report rows

GOOD — sourced, complete, honest gap shown:
```
Method: meta_lift_study  ·  Period: 2026-05-01 → 2026-05-28
| Campaign            | Last-click | Incremental | Incr. CPA | Lift |
| CONV_PROSPECT_202605 |       420 |         180 |    $41.10 | 0.43 |
```

BAD — last-click copied into the incremental column (forbidden):
```
| CONV_RETARGET_202605 |       900 |         900 |     $8.00 | 1.00 |   ← fabricated lift
```
A factor of exactly 1.00 across the board is the classic tell that someone aliased
last-click as incremental. The schema rejects rows with no measured figure; never
defeat that by copying the last-click value over.

BAD — unsourced claim:
```
"Campaign drove 35% lift."   ← no method, no period, no significance. Refuse.
```

## Keeping current

- Method enum lives in `schemas/attribution_report.js` (`METHODS`) — extend there, then update the table above.
- If Meta renames Conversion Lift or its result fields, update `scripts/lib/lift_study.js` mapper and `references/api-reference.md` together.
- Thresholds above are agency defaults; client-specific CPA targets come from `clients/{slug}/CLAUDE.md` and override the generic guidance.
