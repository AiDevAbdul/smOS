# /launch — Domain Standards (embedded expertise)

Self-contained reference for the campaign-build conventions `launch.js` encodes. Read this
to understand the mappings, taxonomies, the fail-closed gate ladder, and what a good vs bad
plan looks like. None of this requires runtime discovery — it is the skill's expertise.

## 1. Objective mapping

The strategy brief carries Meta's ODAX `OUTCOME_*` objective per phase. `launch.js` maps each
to a short campaign-name code, an adset optimization goal, and (for sales) a pixel object.

| Brief `objective` | Name code | Optimization goal | Notes |
|-------------------|-----------|-------------------|-------|
| `OUTCOME_SALES` | `CONV` | `OFFSITE_CONVERSIONS` | Adds `promoted_object.pixel_id` + `custom_event_type` (default `PURCHASE`) when pixel is real |
| `OUTCOME_LEADS` | `LEADS` | `LEAD_GENERATION` | |
| `OUTCOME_TRAFFIC` | `TRAFFIC` | `LINK_CLICKS` | Default fallback objective |
| `OUTCOME_ENGAGEMENT` | `ENGAGE` | `POST_ENGAGEMENT` | |
| `OUTCOME_AWARENESS` | `AWARE` | `REACH` | |
| `OUTCOME_APP_PROMOTION` | `APP` | (no goal map) | Name code only; supply goal upstream |

Legacy objectives (CONVERSIONS, LINK_CLICKS, …) are deprecated for *creation* — always emit
`OUTCOME_*`. Only the live (first) phase is built as real entities; B/C phases are recorded as
`deferred_phases` documents, not created.

## 2. Naming taxonomy (enforced by regex + the naming-check hook)

| Entity | Pattern | Regex | Example |
|--------|---------|-------|---------|
| Campaign | `[OBJ]_[AUD]_[YYYYMM]` | `^[A-Z]+_[A-Z0-9]+_\d{6}$` | `CONV_LAL1PCT_202606` |
| AdSet | `[PLCMT]_[AGEminAGEmax]_[CODE]` | `^[A-Z]+_\d{4}_[A-Z0-9]+$` | `FEED_2545_FITNESS` |
| Ad | `[FMT]_[HOOK]_v[N]` | `^[A-Z]+_[A-Z0-9]+_v\d+$` | `IMG_PAIN_v1` |

- Audience code = the audience `id`, uppercased, non-alphanumerics stripped, ≤16 chars (fallback `AUD`).
- Age block is `age_min` concatenated with `age_max` as four digits (e.g. 25 & 45 → `2545`).
- Placement code derived from angle format: `reel*`→`REELS`, `story*`→`STORY`, else `FEED`.
- Format code: `single_image`→`IMG`, `carousel`→`CAR`, `single_video`/`reels_15_30s`→`VID`.

## 3. Placement map (by creative format)

| Format | publisher_platforms | facebook_positions | instagram_positions |
|--------|---------------------|--------------------|---------------------|
| `reels_15_30s` | facebook, instagram | facebook_reels | reels, story |
| `carousel` | facebook, instagram | feed | stream |
| `single_image` | facebook, instagram | feed | stream, story |
| `single_video` | facebook, instagram | feed | stream, reels |

Unknown formats fall back to `single_image`.

## 4. Constant defaults (never per-client)

- Status: **PAUSED** on every campaign/adset/ad.
- Bid strategy: `LOWEST_COST_WITHOUT_CAP`. Billing event: `IMPRESSIONS`.
- Attribution: `[{CLICK_THROUGH,7},{VIEW_THROUGH,1}]`.
- `special_ad_categories: []` unless the profile specifies otherwise.
- Budgets stored in cents (`Math.round(dollars * 100)` as a string).
- Standard Enhancements: `enroll_status: OPT_OUT`.
- UTMs auto-stamped on the destination link: `utm_source=meta`, `utm_medium=paid_social`, `utm_campaign=<adset name>`, `utm_content=<angle name>` (only fills missing keys).

## 5. Targeting source layers

| `audience.source` | Targeting effect |
|-------------------|------------------|
| `broad` | Age/gender/geo only, no interest layer |
| `interest_cluster` | `flexible_spec[0]` = interests + behaviors from the matching map cluster |
| `retargeting` / `lookalike` | `custom_audiences:[{id}]` — real resolved id, else `<TBD_id>` placeholder (rejected by gate) |

Geo: a `radius` geo with a ZIP whitelist → `geo_locations.zips`; otherwise country list from
`profile.audience.geo_targets` or `profile.location.country` (default `US`).

## 6. The fail-closed gate ladder

`--execute` proceeds only if ALL pass (exit codes in parentheses):

1. All three handoffs present (2).
2. `strategy_brief.approval.status === "approved"` (3).
3. `accounts.ad_account_id` is not TBD (4).
4. No naming violations (5).
5. `launchPlan.validate(plan, {requireExecutable:true})` passes — every ad has non-null
   `copy_used` with text/headline, no adset references a `<TBD_>` audience (6).

Dry-run reports the same problems but never blocks; it is the diagnostic pass.

## 7. Good vs bad plan

**Good** (executable): every campaign has a budgeted audience, every ad has `copy_used`
populated, `targeting.custom_audiences[].id` are real numeric IDs, names match all three
regexes, `mode: "DRY_RUN"` summary shows `naming_issues: 0`.

**Bad** (blocked): `ads[0].copy_used: null` (the `/creative` handoff missed this angle);
`adsets[0].targeting.custom_audiences[0].id: "<TBD_RT_PIXEL_30d>"` (audience never resolved —
run `--create-audiences` or `/audience-map`); campaign name `conv_lal_2026` (lowercase + 4-digit
date → fails regex). Each is named verbatim in stderr; fix at the source skill, never patch the plan.
