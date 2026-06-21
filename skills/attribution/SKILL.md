---
name: attribution
description: Use this skill when the user asks about incrementality, conversion lift, or "are the ads actually causing sales" for a client (`/attribution {slug}`). Shifts reporting off naive last-click toward measured incrementality and emits an attribution report (HTML+PDF).
---

# /attribution — Incrementality / Conversion Lift (Phase 3.1)

Moves smOS off last-click. Ingests Meta's Incremental Attribution column / lift-study
output and presents incremental conversions, incremental CPA, and the gap vs last-click,
per campaign — with the measurement method attached (no unsourced "lift" numbers).

## Required Context

- `clients/{slug}/client_profile.json` — `accounts.ad_account_id`
- Meta insights with the incremental columns, or a lift-study export

## Output (canonical contract)

- `clients/{slug}/attribution_report.json` — `schemas/attribution_report.js` shape
  (`method`, `rows[]` with `incremental_conversions` / `incrementality_factor`)
- `clients/{slug}/attribution_report.html` + `.pdf` (shared design tokens; every
  client-facing report ships HTML+PDF per CLAUDE.md)
- Best-effort persist to Supabase `lift_studies`

## Workflow

1. Pull insights with `action_attribution_windows` + the incremental attribution column
   (or load a provided lift-study export).
2. For each campaign, compute last-click vs incremental, incremental CPA, factor.
3. Validate with `attributionReport.validate` — **halt** if any row has no incremental
   figure (refuse to silently degrade to last-click) and if `method` is missing.
4. Render HTML+PDF; persist.

## Safety / honesty

- An incrementality claim must declare its method (`meta_lift_study`, `geo_holdout`, …).
- Rows without a measured incremental figure are rejected, not back-filled from last-click.
