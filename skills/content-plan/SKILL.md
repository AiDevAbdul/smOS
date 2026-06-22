---
name: content-plan
description: Use this skill to generate an organic content strategy — content pillars plus a Reels-first, Social-SEO calendar — for a client. This skill should be used when the user asks to build an organic content plan, content calendar, posting plan, or pillar strategy for a client, typically via `/content-plan {slug}`. It produces the `content_plan.json` + `content_calendar.json` that `/publish` consumes downstream.
---

# /content-plan — Organic Content Strategy Engine (Phase 2.2)

Generate the organic content layer smOS was missing: 3–5 content pillars and a
Reels-first calendar derived from the client profile. Every calendar item carries
keyword-first captions and alt text (Social-SEO, Phase 2.6) and is shaped exactly
as `/publish` reads it — so `/content-plan` → `/publish` is a guaranteed-correct,
un-re-derived handoff.

## What This Skill Does

- Derive 3–5 pillars (intent + weekly cadence + SEO keywords) from voice, niche, and audience.
- Build a Reels-first calendar (≥50% reels) over a default 4-week period, Mon/Wed/Fri slots.
- Fill keyword-first `message`, `hashtags`, and `alt_text` on every item (Social-SEO).
- Validate the plan with `contentPlan.validate(plan, { requirePublishable: true })` and HALT (exit 4) on any error, naming the failing field — unless `--draft` is set, which warns instead.
- Write `content_plan.json` + `content_calendar.json`; best-effort persist to Supabase `content_plans`.

## What This Skill Does NOT Do

- Does NOT publish, schedule natively, or touch the Meta API — that is `/publish`.
- Does NOT write final marketing copy; it emits placeholder captions for the creative agent — `/creative` owns finished copy.
- Does NOT pull live engagement/cadence metrics — that is `/audit` / `/analyze`.
- Does NOT generate competitor angles — that is `/research` (consumed here only if present).

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `schemas/content_plan.js` (contract), `scripts/lib/supabase.js`, `scripts/lib/load-env.js`, sibling `skills/publish/` (consumer) |
| **Conversation** | Period length, platform focus, pillar overrides the user already stated |
| **Skill References** | Pillar taxonomy, cadence/Reels-first rules, SEO rules (`references/domain-standards.md`) |
| **Client Profile** | `clients/{slug}/client_profile.json` — `business.niche`, `voice`, `seo_keywords`, `accounts` |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for pillar definitions, cadence, or SEO rules.

**Required (must resolve before running):**
1. Which client `{slug}`? (Must have `clients/{slug}/client_profile.json` from `/intake`.)

**Optional (ask only if relevant):**
2. How many weeks? (`--weeks=N`, default 4.)
3. Is this a draft skeleton for the creative agent to enrich, or a publishable plan? (`--draft` vs default.)

## Workflow

1. Run `node skills/content-plan/content-plan.js <slug> [--weeks=N] [--draft]`.
2. The script loads the profile and HALTS (exit 3) if `client_profile.json` is missing — never blank-page generate.
3. `buildPlan` derives pillars and a deterministic Reels-first calendar (start = next Monday, 13:00 UTC).
4. The plan is validated `requirePublishable: !draft`. On error: default HALTS exit 4 naming the field; `--draft` only warns.
5. Writes `content_plan.json` (full `{ pillars, items }`) and `content_calendar.json` (`{ items }` for `/publish`).
6. Best-effort inserts a row into Supabase `content_plans` (silently skipped if env unset).

## Input / Output Specification

**Inputs:** arg `<slug>`; flags `--weeks=N`, `--draft`; file `clients/{slug}/client_profile.json`; env (optional) `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
**Outputs:** `clients/{slug}/content_plan.json`, `clients/{slug}/content_calendar.json`; Supabase `content_plans` row (best-effort).
**Exit codes:** `0` ok · `1` fatal · `2` missing slug arg · `3` missing profile · `4` failed publishable validation.
(Full schemas, payloads, and edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Niche, voice, SEO keywords, audience (from profile) | 4 default pillars (Educate / Social Proof / Behind / Offer) |
| `--weeks` period length (default 4) | Reels-first ≥50%; format-by-pillar map |
| Pillar keywords (seeded from profile) | Mon/Wed/Fri post days, 13:00 UTC slot |
| Whether output is publishable or `--draft` | Social-SEO required (keywords + alt_text per item) |
| Supabase presence (best-effort persist) | Schema contract from `schemas/content_plan.js` |

## Domain Standards

### Must Follow
- [ ] ≥50% of calendar items are `reels` format (Reels-first mandate).
- [ ] Every item carries `keywords`, `hashtags`, and `alt_text` (Social-SEO non-optional).
- [ ] Every item starts `status: pending` — nothing is marked published by this skill.
- [ ] `content_calendar.json` items match exactly what `/publish` reads (no re-derivation).
- [ ] Default run fails closed: an unpublishable plan HALTS rather than emitting.

### Must Avoid
- Emitting a calendar that `/publish` cannot post (missing media URLs) without `--draft`.
- Using `Math.random` / non-deterministic dates — re-runs must be stable.
- Writing finished marketing copy here (captions are placeholders for `/creative`).

### Output Checklist (verify before delivery)
- [ ] `content_plan.json` and `content_calendar.json` both written.
- [ ] Validation passed (or `--draft` explicitly chosen and warned).
- [ ] Reels share ≥50%; every item has SEO fields.
- [ ] Pillars number 3–5 with cadence + keywords.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `<slug>` arg | Print usage, exit 2 |
| `client_profile.json` not found | `HALT: … not found — run /intake first.`, exit 3 |
| Plan fails publishable validation (default) | Print each failing field, advise `--draft`, exit 4 |
| Plan invalid but `--draft` set | Warn with field list, continue, write skeleton, exit 0 |
| Supabase env unset or insert fails | Log `supabase persist skipped`, continue — never block deliverable |
| Unexpected exception | `[content-plan] FATAL: <msg>`, exit 1 |

## Dependencies & Security

- **Reuses:** `schemas/content_plan.js` (normalize + validate contract), `scripts/lib/supabase.js`, `scripts/lib/load-env.js`.
- **External APIs:** none directly. Downstream `/publish` uses Meta Graph API v25.0 / IG Content Publishing (see `references/api-reference.md` for the handoff target).
- **Secrets:** Supabase keys resolved via env / `scripts/lib/load-env.js` — never hardcoded or logged. Persistence is best-effort and degrades silently offline.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| IG Content Publishing guide | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | Format/two-step flow the calendar feeds into; 100 posts/24h |
| IG Content Publishing Limit | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/ | Live posting quota `/publish` must respect |
| Pages API — Posts | https://developers.facebook.com/docs/pages-api/posts/ | FB-platform items (`POST /{page-id}/feed`) |
| IG Media Insights | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | `impressions`→`views` change informing pillar targets |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Pillar taxonomy, cadence + Reels-first formula, Social-SEO rules, good/bad calendar examples |
| `references/api-reference.md` | Downstream `/publish` endpoints/fields/version/limits the calendar must satisfy (IG + Pages) |
| `references/io-contract.md` | Full `content_plan` / `content_calendar` JSON schemas, example payloads, edge cases, exit codes |
