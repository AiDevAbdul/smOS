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
2. Build sections: **Your Plan**, **Billing**, **Awaiting Your Approval**, Paid Performance, Community, Content Calendar, Listening.
3. Render with the shared `md_to_html` design tokens → one self-contained HTML.

## Phase 5 commercial layer

- **Your Plan** — the client's retainer + whether an agreement is on file (from the CRM deal).
- **Billing** — the invoice ledger (`billing/{slug}/ledger.json`): each invoice's period, amount, status, and a **Pay now** link when a Stripe hosted URL exists; plus the outstanding balance.
- **Awaiting Your Approval** — pending `content_plan` items with **no-login** Approve / Request-changes actions. These are `mailto:` links to the agency email (from `config/services.json`), so approval works from a static, self-contained file with no backend. A hosted version can swap the action for a POST.

## Safety / privacy

- Read-only on the marketing side: the portal never triggers a paid/organic action. Approvals are client-initiated emails the operator then records.
- White-label: no smOS branding leaks; uses the client's name from the profile and the agency identity from the catalog.
- Internal-only data (pipeline forecast, other clients) never appears — the portal shows only this client's plan, invoices, and work.
