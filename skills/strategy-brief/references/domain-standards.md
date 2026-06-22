# strategy-brief — Domain Standards

Embedded expertise for campaign-strategy synthesis. All thresholds below are encoded in
`strategy-brief.js` so the brief is deterministic from inputs — this file documents WHY each
value is what it is so future maintainers can change it intentionally.

---

## 1. Objective hierarchy (decision tree)

The objective is chosen from **pixel health** and **purchase history**, not from client
preference. Uses ODAX `OUTCOME_*` enums only (legacy objectives are deprecated for creation).

| Condition | Phase A (day 0) | Phase B (day 14) | Phase C |
|-----------|-----------------|------------------|---------|
| Pixel `full` AND `best_roas > 0` | `OUTCOME_SALES` | `OUTCOME_SALES` (retargeting) | `OUTCOME_SALES` (day 28, LAL + 2nd cluster after 3-day ROAS gate) |
| Pixel not `full` OR no purchase history | `OUTCOME_LEADS` if `Purchase` is a conversion event else `OUTCOME_TRAFFIC` | `OUTCOME_SALES` (promote once pixel has ~200+ events) | `OUTCOME_SALES` (day 21, scale into LAL + 2nd cluster) |

Rationale: a cold pixel cannot optimize for conversions reliably; start lighter-funnel,
accumulate signal, then graduate. `best_roas`/`pixel_health` come from `audit_raw.json`; with
no audit, `pixel_health = "unknown"` → the cold-start branch is taken (conservative default).

---

## 2. Budget allocation

**Split (CONSTANT): 60% cold · 25% warm (retargeting) · 15% lookalike.** Defined in
`DEFAULT_BUDGET_SPLIT`.

- `daily_total = monthly_budget_low / 30` (falls back to `monthly_budget`, then `$3000`).
- Cold daily ÷ cold audiences = per-cold-adset budget. Warm daily ÷ retargeting audiences.
  Lookalike daily is assigned whole to the single LAL adset.
- **Approval flag:** any per-adset `daily_budget > $200` sets `needs_approval: true`
  (`ADSET_LARGE_DAILY`). This mirrors the constitution's global guardrail "any new campaign
  launch with daily budget > $200".

Rationale for 60/25/15: prospecting needs the majority to feed the funnel; retargeting is
high-efficiency but volume-capped by warm-audience size; lookalike is a test allocation until
the 3-day ROAS gate proves it.

---

## 3. Audience ranking (launch order)

Produced by `rankAudiences()`, trimmed to **top 5**:

1. `BROAD` — no-interest baseline, always priority 1.
2–3. Up to two largest interest clusters (sorted by `size_estimate` midpoint).
4–5. Up to two retargeting layers (`retargeting_layers`/`retargeting`).
6. One lookalike from the strongest seed (`lookalike`/`lookalikes`), if present.

Size midpoint parses strings like `"500k-2M"` → numeric midpoint for sorting; unparseable → 0.

---

## 4. Creative angle selection

Three angles are chosen from `competitor_intel.angles` and bucketed pain / aspiration / proof.

**Scoring (`pickCreativeAngles`):**
- `fit_for_client == "high"` → +3; `== "medium"` → +1.
- `frequency == "rare"|"uncommon"` → +2 (whitespace gap = opportunity).
- `frequency == "very_common"` → −0.5 (saturated).
- Angle label contains a `voice.restricted_words`/`voice.avoid` term → −5 (effectively drops it).

Top 3 are bucketed by keyword:
- **proof**: `trust|credential|review|testimonial|proof|certif`
- **aspiration**: `transform|result|outcome|before.*after|future`
- **pain**: `problem|pain|fix|repair|broken|issue`

Empty buckets are filled from remaining top angles. Each angle gets `angle_id` (= uppercased
slug of `name`), `hook_archetype`, a recommended `format`, and a one-line `prompt` for `/creative`.

**Format heuristic:** detailing/cosmetic use-cases → `reels_15_30s` if the competitor winning
signal is short video, else `carousel`; repair/mechanical → `single_image`; default `single_image`.

**Excluded angles:** any competitor angle whose label contains a restricted word is recorded in
`excluded_angles` with the offending word — auditable, never silently dropped.

---

## 5. Success metrics (defaults; overridden by client `kpis`)

| Tier | Metric | Default | Source key |
|------|--------|---------|-----------|
| Cold | CTR target | 1.0% | `cold_ctr_target` |
| Cold | CPM ceiling | $30 | `cold_cpm_ceiling` |
| Cold | CPA target | $50 | `cpa_target` |
| Cold | ROAS target | 1.5 | `cold_roas_target` |
| Warm | CPA target | 60% of cold CPA | derived |
| Warm | ROAS target | 3.0 | `warm_roas_target` |
| Scale gate | rule | 3 consecutive days ROAS > target | constant |
| Pause floor | CPA multiplier | 3× | `pause_cpa_multiplier` |
| Pause floor | CTR floor | 0.5% | `pause_ctr_floor` |
| Pause floor | Frequency ceiling | 4.0 | `pause_frequency_ceiling` |

Warm CPA at ~60% of cold CPA reflects that warm audiences convert cheaper. Pause floors mirror
the constitution's Global KPI Thresholds.

---

## 6. 30-day calendar shape (CONSTANT)

- **Week 1:** launch Phase A, 3 creatives × 2 audiences, monitor only (no scaling).
- **Week 2:** kill underperformers per pause thresholds, refresh worst creative.
- **Week 3:** begin the phase scheduled for day 14–20 (retargeting), evaluate scale gate.
- **Week 4:** begin the phase scheduled for day 21+ (LAL + scale), plan month 2.

Phases are mapped to weeks by `Math.floor(start_day / 7) + 1`.

---

## 7. Conflict reconciliation (`assumptions`)

- Profile CPA target vs. audit `best_cpa` diverge by >30% → flag both, default to profile.
- Audit `pixel_health != "full"` → note that Phase A uses a lighter-funnel objective.
- No `audit_raw.json` → note "running with profile-only assumptions".

Never silently override a profile value with an audit value or vice versa.

---

## Good vs. bad examples

**Good — angle selection:** competitor intel shows "warranty-backed repairs" is `rare` and
`fit_for_client: high`; profile restricts the word "cheap". The angle scores +5, lands in the
**proof** bucket, gets `angle_id: "WARRANTY_BACKED_REPAIRS"`. A "cheapest in town" angle scores
−5 and is listed under `excluded_angles` with reason `contains restricted word 'cheap'`.

**Bad — what NOT to do:** hand-writing a fourth angle "because three feels thin", or renaming an
`angle_id` between runs. `/creative` and `/launch` join on `angle_id`; a rename silently breaks
the handoff (exactly the drift the schemas exist to prevent). Always let the code derive the id.

**Bad — budget:** bumping a cold adset to $250/day without setting `needs_approval`. The $200
flag is a guardrail, not advice — clearing it requires the human approval defined in the
constitution.
