---
name: leads
description: Use this skill when the user asks to pull, sync, or analyze a client's Meta lead-gen leads (typically via `/leads {slug}` or `/leads {slug} sync`). Lists forms, retrieves new leads since the last sync, scores quality (filters junk), and outputs CSV + JSON ready for CRM handoff.
---

# /leads — Lead Retrieval & Quality Scoring

## Why this exists

Meta lead-gen forms collect leads server-side. They expire from Meta's storage after 90 days. Without CRM webhook integration, clients lose leads they didn't pull in time. This skill is the safety net: pull regularly, score, hand off.

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.facebook_page_id`
- A Page access token: env `META_PAGE_TOKEN_<SLUG_UPPER>` or `META_PAGE_TOKEN`
- Optional: `clients/{slug}/leads_state.json` — tracks last-synced timestamp per form

## Modes

`node skills/leads/leads.js <slug> <mode> [args]`

- `list` — Show all lead-gen forms on the page
- `sync` — Pull leads created since the last sync timestamp; update state file
- `pull <form_id> [--since ISO_DATE]` — Force-pull a specific form
- `score <form_id>` — Re-score all leads for a form (read-only; doesn't refetch)

## Workflow (`sync` mode)

1. List active lead forms via `GET /{page_id}/leadgen_forms?fields=id,name,status,leads_count`
2. Load `leads_state.json` (or default to last 7 days for first run)
3. For each form, `GET /{form_id}/leads?since=<state.last_synced>&limit=500`
4. Normalize `field_data` arrays into flat objects: `[{name:"email", values:["x@y.com"]}]` → `{email: "x@y.com"}`
5. Score each lead — see Quality Scoring below
6. Append to `clients/{slug}/leads/<form_id>.jsonl` (append-only, one lead per line)
7. Also write a flat `leads_export.csv` for CRM upload
8. Update `leads_state.json` with `last_synced` per form

## Quality scoring

Each lead gets a 0–100 score. Anything < 40 is flagged `junk`, 40–69 `review`, ≥ 70 `qualified`.

| Signal | Score impact |
|---|---|
| Email matches `*@(gmail|yahoo|hotmail|outlook|icloud).com` | +0 (neutral) |
| Email matches `*@<known disposable>` | −50 |
| Email is malformed (no `@`, missing TLD) | −60 |
| Full name has < 2 characters per word OR is all-lowercase like `asdf asdf` | −30 |
| Phone is < 7 or > 15 digits | −30 |
| Phone has obvious repeats (`1111111111`, `1234567890`) | −40 |
| All-caps fields | −10 |
| Submitted in < 5 seconds since ad click (Meta provides `submitted_at` minus `created_time` of click — when available) | −20 |
| Lead is `is_organic: true` (came through the form directly, not via paid ad) | +10 |
| Base score | 70 |

Score is clamped to [0, 100]. Reasons are kept on the lead row so a human can audit.

## Output

- `clients/{slug}/leads/<form_id>.jsonl` — append-only canonical store
- `clients/{slug}/leads_export.csv` — flat CSV ready for CRM upload (overwrites)
- `clients/{slug}/leads_state.json` — sync state
- One-line summary: `pulled N · qualified Q · review R · junk J`

## Error Handling

- Missing page token → halt with which env var to set
- Lead expired (Meta returns 100) → log + continue
- Webhook subscription gap → suggest running `subscribe_lead_webhook` MCP tool

## Token Efficiency

- Pure data fetch + local scoring; no LLM in the body
- Append-only JSONL — never re-fetches what's stored
