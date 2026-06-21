---
name: portal
description: Use this skill to generate a client-facing dashboard (`/portal {slug}`) — a self-contained white-label HTML page blending paid performance (daily_metrics) and organic activity (inbox, content, listening) for the client to view.
---

# /portal — Client Portal + White-Label Reporting (Phase 2.5)

A per-client, read-only dashboard that blends paid + organic into one view, reusing
the Phase 1.4 persistence and Phase 1.7 design tokens. Output is a single
self-contained HTML file (no external assets) that can be hosted or emailed.

## Required Context

- `clients/{slug}/client_profile.json` — name, branding
- Data sources (any available, offline-safe):
  - Supabase `daily_metrics` (paid) or local `performance_analysis.json`
  - `inbox.json` (organic engagement), `content_plan.json` (calendar), `listening_snapshot.json`

## Output

- `clients/{slug}/portal.html` — self-contained dashboard (white-label: client name/brand)
- Best-effort persist a pointer to Supabase `reports` (report_type-style row)

## Workflow

1. Load the profile + whatever artifacts exist (degrade gracefully; show "no data yet" cards).
2. Build sections: Paid Performance, Organic Engagement, Content Calendar, Listening.
3. Render with the shared `md_to_html` design tokens → one self-contained HTML.

## Safety / privacy

- Read-only: the portal never triggers an action.
- White-label: no smOS branding leaks; uses the client's name from the profile.
