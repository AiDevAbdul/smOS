---
name: brand-name
description: Use this skill to generate a brand name and verbal identity, auto-screen each candidate against three independent gates (.com availability, USPTO trademark knockout, social-handle availability), and produce tagline/voice/messaging house. This skill should be used when a brand-new client needs naming and verbal identity in Phase 0 zero-start onboarding (typically via `/brand-name {slug}`), after positioning has been approved. Fail-closed on the name gate — never auto-clears trademark; always flags attorney clearance.
---

# /brand-name — Verbal Identity (Phase 0 · step 2 of 5)

Generate brand-name candidates, screen each against three independent legal/availability gates, then build the verbal identity (tagline, voice, messaging house). The name is the brand anchor and must clear all three screens before any visual work begins. AI generates and screens; a human curates and picks; an attorney clears the mark — that last 10% is never automated.

## What This Skill Does

- Generate 15–30 name candidates across five name types (see `references/domain-standards.md`).
- Screen shortlisted names via `brand-name.js --screen` against three gates: `.com` (DNS/RDAP), USPTO trademark knockout, social handles (IG/FB/X/TikTok/LinkedIn).
- Present the screened shortlist with per-name gate results; recommend one but let the **human pick**.
- Draft tagline, voice (traits + spectrums + do/don't), messaging house, elevator pitch, boilerplate; persist via `--in verbal.json`.
- Stamp the name gate via `--approve-name` (human-only), advancing `status` to `named` and unblocking `/brand-visual`.

## What This Skill Does NOT Do

- Does NOT clear trademark — the knockout only rules names OUT; final clearance is a human attorney's call (always flagged).
- Does NOT pick the name — generation and screening are advisory; the human selects.
- Does NOT define positioning/archetype/persona — that is `/brand-strategy` (must be approved first).
- Does NOT produce logo, color, or type — that is `/brand-visual`.
- Does NOT register a domain or create accounts — that is `/setup-web` and `/setup-accounts`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/brand.js` (load/merge/save/stampGate), `schemas/brand_profile.js` (verbal layer + gate rules), `skills/brand-name/brand-name.js` (screen/persist/approve) |
| **Conversation** | Category, tone, any names the client likes/rejects, must-avoid words |
| **Skill References** | Name taxonomy, screening semantics, voice/messaging frameworks in `references/` (table below) |
| **Client Profile** | `clients/{slug}/brand_profile.json → strategy` (archetype, positioning, persona inform name tone) |

## Clarifications

> Before asking: read `clients/{slug}/brand_profile.json` and the conversation. Only ask for
> what cannot be determined. Domain knowledge (name types, screening rules, voice frameworks)
> lives in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. The client `{slug}`.
2. Confirmation the human wants to proceed to `--approve-name` (gate stamp is human-only).

**Optional (ask only if relevant):**
3. Category-specific naming constraints (e.g. regulated terms, geographic scope, multilingual reach).
4. Whether a `USPTO_ODP_API_KEY` is available to automate the knockout (else it returns `null`/manual).

## Workflow

1. Verify `strategy.positioning_approved_at` is set; if not, halt and route to `/brand-strategy`.
2. Generate 15–30 candidates across name types; bias toward coined/abstract in crowded categories (most trademark-defensible).
3. Shortlist ~6 on memorability, pronounceability, distinctiveness, cultural soundness.
4. Run `node skills/brand-name/brand-name.js {slug} --screen "Name1,Name2,..."`; read the per-name gate table.
5. Present the screened shortlist to the human with gate results; recommend one. The human picks.
6. Draft the verbal layer for the chosen name into `verbal.json`; persist with `--in verbal.json`.
7. Confirm attorney clearance with the human, then stamp the gate with `--approve-name`.

## Input / Output Specification

**Inputs:** `{slug}` (positional); one mode flag — `--screen "A,B,C"`, `--in verbal.json`, or `--approve-name`. Optional env `USPTO_ODP_API_KEY`. Reads `clients/{slug}/brand_profile.json`.
**Outputs:** updates `clients/{slug}/brand_profile.json` (verbal layer + `name_candidates[]` screen rows + `name_screening` + `name_approved_at`); prints a JSON result to stdout.
(Full schemas, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Candidate names, category, tone, chosen name | Three-gate screening model (.com / trademark / handles) |
| Voice traits, spectrums, taglines, messaging | Five name-type taxonomy; coined/abstract = defensible |
| Whether `USPTO_ODP_API_KEY` is set | Fail-open-to-`null` semantics (never silent `true`) |
| Number of candidates / shortlist size | `attorney_clearance_flagged` always `true`; gate is human-only |

## Domain Standards

### Must Follow
- [ ] Confirm `positioning_approved_at` is stamped before naming.
- [ ] Screen every shortlisted name through all three gates before presenting.
- [ ] Report unknown availability as `null`, never as available.
- [ ] Keep `attorney_clearance_flagged: true` on every candidate; require human ack before `--approve-name`.
- [ ] Let the human pick the name and stamp the gate — AI only recommends.

### Must Avoid
- Treating "no trademark hit" as clearance (it is a knockout only).
- Marking a social handle "taken" from an unauthenticated 200 response.
- Auto-running `--approve-name`, or stamping without attorney acknowledgement.
- Generating verbal identity from a cold prompt instead of reusing the strategy layer.

### Output Checklist (verify before delivery)
- [ ] Shortlist presented with per-name gate results and a clear recommendation.
- [ ] Chosen name's screen row carried onto `verbal.name_screening`.
- [ ] `verbal.json` matches the `verbal` schema (name, tagline, voice, messaging_house, pitch, boilerplate).
- [ ] Gate stamped only after human confirmation; `status: named`; next step `/brand-visual` named.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` | Print usage, exit 1 |
| Positioning not approved (non-screen modes) | Halt with route to `/brand-strategy`, exit 3 |
| `--approve-name` but `verbal.name` empty | Halt: persist `--in verbal.json` first, exit 3 |
| `--approve-name` but `attorney_clearance_flagged` not set | Refuse to stamp, exit 4 |
| `--in` path missing | Halt, exit 2 |
| RDAP/DNS/handle/USPTO call fails or unparseable | Field set to `null` (unknown) with a manual-verify note — never `true` |
| No `USPTO_ODP_API_KEY` | `trademark_knockout_clear: null` + manual USPTO search URL |
| Schema validation fails on `--in` | `saveBrand` throws fail-closed naming each missing field; do not write partial |

## Dependencies & Security

- **Reuses:** `scripts/lib/brand.js` (`loadBrand`, `saveBrand`, `stampGate`), `schemas/brand_profile.js` (normalize/validate, verbal stage).
- **External APIs:** USPTO Open Data Portal (`api.uspto.gov`); public DNS; unauthenticated GETs to IG/FB/X/TikTok/LinkedIn. Details + rate limits in `references/api-reference.md`.
- **Secrets:** `USPTO_ODP_API_KEY` from env only — never hardcoded or logged. Absence is handled gracefully (manual fallback).
- **Runtime:** Node ≥ 18 (uses global `fetch`, `node:dns`).

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| USPTO Open Data Portal | https://developer.uspto.gov | Trademark search API key + endpoints |
| USPTO Trademark Search (manual) | https://tmsearch.uspto.gov | Human knockout/clearance fallback |
| RDAP (ICANN) | https://www.icann.org/rdap | Authoritative domain registration lookup |
| WCAG SC 1.4.3 Contrast | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | Verbal handoff to visual deliverables |

For patterns not covered here, fetch the official docs above, then apply the same conventions.
See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Name-type taxonomy, screening thresholds, voice/messaging frameworks, good/bad examples |
| `references/api-reference.md` | Exact USPTO/DNS/handle endpoints, env key, version, rate limits, fail-open semantics |
| `references/io-contract.md` | Full JSON schemas, exit codes, example `verbal.json` + screen payloads, edge cases |
