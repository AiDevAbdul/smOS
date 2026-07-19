# Competitor Analysis — Evaluation & Improvement Roadmap

**Scope:** the competitor-intelligence layer inside `/pre-audit` and `/research`.
**Date:** 2026-07-19 · **Author:** smOS engine review · **Status:** proposal for build

---

## 1. What exists today

Competitor analysis runs on **two engines that share one code path** (`scripts/meta-ad-library/`), split by whether the account has signed:

| | `/research` (post-signature) | `/pre-audit` (pre-signature) |
|---|---|---|
| Output dir | `clients/{slug}/` | `prospects/{slug}/` |
| Data source | Meta Ad Library `/ads_archive` (token) | Public scrape + Ad Library (token optional) |
| Pipeline | `client.py` → `analyzer.py` → `classifier.py` → `report.py` → `differ.py` | `collect.py` → `normalize.py` → `build.py` → `pre_audit_report.py` |
| Competitor score | `analyzer.score_competitor` (0–100, 5 weighted metrics) | `build.score` outspend dimension (active-ad counts) |
| Copy analysis | `classifier.classify_competitor` — LLM into 6 angles, cached | `classifier.score_creative_matrix` — LLM, 5 creative dims 0–10, cached |
| Trend | `differ.diff_snapshots` (new/killed ads, tier/format/CTA moves) | none |
| Canonical output | `competitor_intel.json` (feeds `/strategy-brief`) | `competitor_summary.json` (feeds the report) |

### What's genuinely strong (keep)

- **Public-data-only.** No client ad-account token needed for the competitive read — legally clean and lets a prospect be pitched within an hour.
- **Deterministic core, LLM only where it must be.** Metrics are pure Python; the LLM is used only for angle/creative classification and is **content-addressed cached**, so re-runs are free and reproducible.
- **Honesty guards.** `unverified` statuses, the `low_confidence` data-quality gate in `build.py`, and the "category benchmark vs measured" labeling rule (H1) are the right instincts and should be preserved through every change below.
- **The scored creative matrix at pre-sale** is a real differentiator — no competing agency ships a 5-dimension competitor creative score before a contract exists.

---

## 2. Findings (ranked by impact)

### 🔴 F1 — 40% of the `/research` competitor score is built on fields Meta almost never returns

`analyzer.score_competitor` weights the 0–100 score as:

```
volume 25% + spend 25% + format 20% + cadence 15% + impressions 15%
```

But the Meta Ad Library only returns `spend` and `impressions` for **political / issue / EU** ads. For commercial advertisers — i.e. essentially every local/SMB client smOS serves — both fields are empty. Verified against the repo's own pulled data:

| Pulled set | Ads | With spend | With impressions |
|---|---|---|---|
| gsc-store competitors | 7,874 | **0** | **0** |
| ttelgo competitors | 8,069 | **0** | **0** |
| gsc-store competitors (PK) | 3,571 | **0** | **0** |
| hope87 competitors | 104 | **0** | **0** |

Consequence: `spend_tier` collapses to `"Unknown"` (→10 pts) and `impression_score` to 0 for nearly every competitor. **40% of the formula is dead weight** producing a false appearance of rigor; the ranking is actually decided by volume + format + cadence alone. `/pre-audit` already avoids this by deriving outspend from active-ad counts — `/research` should adopt the same basis.

### 🔴 F2 — Format detection is guesswork

`analyzer.infer_format` returns `"video"` if `"video"` appears in the snapshot URL and `"carousel"` if there is more than one creative body — both unreliable (snapshot URLs don't reliably encode media type; multiple bodies ≠ carousel). Meta exposes `display_format` / `media_type` on the archived-ad node, which are authoritative and unused. Every format-derived metric (format score = 20% of F1's total, `visual_strategy` in the matrix, dominant-format diffs) inherits this error.

### 🟠 F3 — Output schema drifts between normal and synthesis mode

Normal `/research` writes a top-level `gaps` array; synthesis mode writes `gaps_for_blue_rose_to_exploit` (plus `winning_recipe_recommendation`, `category_landscape`, etc.). The live `clients/blue-rose-auto/data/competitor_intel.json` shows `gaps: None` as a result. `/strategy-brief` reads `.angles` (present in both) but `.gaps` is silently empty in synthesis mode. One schema must satisfy both modes.

### 🟠 F4 — No real gap/whitespace computation

`domain-standards.md` describes gaps as "angle nobody leans on that the client's USP fits," paired with a `recommended_angle`. In practice gaps are produced by **templates** (`build.synthesize`) or the LLM in synthesis mode — never computed from the actual angle distribution across the competitor set vs. client fit. The intelligence the taxonomy promises is not being derived from the data.

### 🟠 F5 — No creative teardown beyond text

`/research` classifies only `ad_creative_bodies` (text). The pre-audit "creative matrix" *infers* `visual_strategy` from format + copy rather than looking at the actual image/video. Nothing captures the **landing page / offer / destination** a competitor ad points to — so "what are they actually selling, and how" is invisible. `offers_seen` exists only in hand-authored synthesis mode.

### 🟡 F6 — Competitors = whoever the client named

Both engines analyze `profile.competitors` (client-supplied). There's no auto-discovery of who is *actually* running ads in the category + geo. `ig_discovery.py` and `discover_pk.py` exist but aren't wired into the mainline flow. Risk: you profile perceived rivals, not the advertisers actually competing for the client's auction.

### 🟡 F7 — Trend intelligence is manual and lossy

`differ.py` can diff two snapshots, but the SKILL notes `persist.py` must be run separately and snapshots aren't auto-stored. So "who is ramping / fatiguing over time" depends on someone remembering to persist — the longitudinal signal degrades between runs.

### 🟡 F8 — No small-sample guard

A competitor with 2 active ads receives a "dominant angle" and a rank alongside one with 50. Volume is normalized in the score, but low-n competitors aren't flagged, so a thin sample can masquerade as a confident read.

### ⚪ F9 — `market.py` is dead, hardcoded code

`scripts/meta-ad-library/market.py` is 1,041 lines hardcoded to automotive / Blue Rose and wired into **no** skill — the exact "per-client renderer" anti-pattern the skill's own Must-Avoid list forbids. Either generalize its useful parts (category term-expansion, theme extraction) into the shared pipeline or delete it.

---

## 3. Improvement roadmap

Four workstreams, matching the agreed priorities. Each item lists the files to touch and rough effort (S <½ day, M ~1 day, L multi-day).

### Workstream A — Fix scoring & format flaws  *(highest ROI, do first)*

| # | Change | Files | Effort |
|---|---|---|---|
| A1 | Re-base the competitor score off signals that actually populate: volume, cadence, **creative survival past 60d**, format diversity, angle diversity. Drop spend/impressions from the weighting; keep them as *bonus* only when present (political/EU). | `analyzer.py::score_competitor` | M |
| A2 | Read authoritative `display_format` / `media_type` from the archived-ad node; fall back to the current heuristic only when absent. Add these fields to the `client.py` field list. | `analyzer.py::infer_format`, `client.py` | S |
| A3 | Add creative-**survival** and **age** metrics (from `ad_delivery_start_time` / `ad_creation_time`) as first-class scored inputs — this is the strongest available proxy for "what's working" without spend data. | `analyzer.py` | S |
| A4 | Flag low-sample competitors (`n_active_ads < 5`) with a `confidence: "low"` field so the report and `/strategy-brief` can caveat them (addresses F8). | `analyzer.py`, schema | S |

**Definition of done:** the competitor score varies meaningfully across a real commercial set (no more "everyone scores ~10 on spend"); format counts match a manual spot-check of 10 ads.

### Workstream B — Unify schema + real gap logic

| # | Change | Files | Effort |
|---|---|---|---|
| B1 | Make `competitor_intel.js` the single schema for **both** normal and synthesis mode: always populate `angles`, `gaps`, `offers`, `ctas`, `competitors`. Map synthesis-only keys onto the canonical ones (fixes F3). | `schemas/competitor_intel.js`, `research.js`, `report.py` | M |
| B2 | Compute whitespace gaps programmatically: tally angle frequency across the competitor set, cross-reference each angle's `fit_for_client` against `business.usp`, and emit `{type, observation, recommended_angle}` for under-served, high-fit angles (fixes F4). | new `gaps.py` (or extend `analyzer.py`), `classifier.py` | M |
| B3 | Add a regression test that asserts `.angles` and `.gaps` are non-null in both modes, so drift can't return. | `tests/` | S |

**Definition of done:** `/strategy-brief` reads a populated `.gaps` regardless of mode; gap statements trace to a computed angle-frequency number, not a template string.

### Workstream C — Deeper creative teardown

| # | Change | Files | Effort |
|---|---|---|---|
| C1 | Capture each competitor ad's **destination**: follow `ad_creative_link_captions` / snapshot link, record landing domain + detected offer keywords (free/BOGO/%-off/quote/trial). Surface as `offers_seen` in both engines (fixes F5, part 1). | `client.py` / `collectors.py`, `analyzer.py` | M |
| C2 | Add lightweight **vision scoring** of the top N competitor creatives (thumbnail + on-image text + hook frame) using the existing cached-LLM pattern, feeding a *measured* `visual_strategy` instead of an inferred one. Reuse `creatives.py` (already downloads assets) which is currently only used by `/audit-creative`. | `classifier.py::score_creative_matrix`, `creatives.py` | L |
| C3 | Extend the pre-audit creative matrix + `/research` report to show the teardown (offer, destination, measured visual score) per competitor. | `pre_audit_report.py`, `report.py` | M |

**Definition of done:** the report answers "what is each competitor offering, where does it send traffic, and how good is the creative" from observed data, with graceful `—` fallbacks when a fetch is blocked.

### Workstream D — Discovery + trend tracking

| # | Change | Files | Effort |
|---|---|---|---|
| D1 | Wire in **auto-discovery** of in-market advertisers: keyword/category + geo search of the Ad Library, rank by active-ad volume, and *propose* competitors the client didn't name (human confirms — never auto-added silently). Fold `market.py`'s term-expansion here, then retire the hardcoded file (fixes F6, F9). | `discover_pk.py`, `ig_discovery.py`, `research.js`; delete/refactor `market.py` | L |
| D2 | Auto-persist every run's snapshot (`competitor_snapshots`) so `differ.py` always has a prior baseline; surface a "movers since last run" block (ramping / fatiguing / new entrants) in the report (fixes F7). | `research.js`, `persist.py`, `differ.py`, `report.py` | M |
| D3 | Optional: schedule a periodic competitor refresh per active client (reuse the scheduler / auditor agent) so trend data accrues without manual runs. | scheduler config | S |

**Definition of done:** running `/research` twice a week apart yields an automatic movement report; a client with 2 named competitors gets 3–5 evidence-ranked suggestions of who else to watch.

---

## 4. Suggested sequencing

1. **A** (scoring + format) — corrects results everything else depends on; small, self-contained.
2. **B** (schema + gaps) — unblocks `/strategy-brief` and makes output trustworthy.
3. **C1** then **C2/C3** — offer/destination capture is cheap and high-signal; vision scoring is the heaviest lift, do it once the rest is stable.
4. **D** — highest long-term value (discovery + trend), but depends on A/B being solid first.

Each workstream ships independently and preserves the existing honesty guards. Nothing here changes the public-data-only, deterministic-core, cached-LLM architecture — it deepens it.

---

## 5. Open questions for the team

- **Vision scoring cost/latency (C2):** cap at top-N creatives per competitor? Suggest N=5, cached, so cost stays flat on re-runs.
- **Auto-discovery guardrail (D1):** confirm competitors should be *proposed for human approval*, never auto-written to `profile.competitors`.
- **Trend cadence (D3):** weekly refresh per active client, or only on-demand?
