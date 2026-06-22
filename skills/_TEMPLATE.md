---
name: <skill-slug-matches-directory>
description: Use this skill to <WHAT it does, one clause>. This skill should be used when <WHEN — the trigger conditions / `/<slug> {args}` invocation>. (Third-person, ≤1024 chars.)
---

# /<slug> — <Title> (<Phase>)

<!--
smOS canonical SKILL.md template. Every skill follows this section order.
KEEP SKILL.md LEAN (<200 lines) — it is loaded into context at runtime.
Push heavy domain knowledge, full schemas, and examples into references/*.md,
which are read ON DEMAND. This satisfies the validator's Progressive Disclosure
+ Modularity criteria while honoring the constitution's Token Efficiency rule.
-->

<2-3 sentence overview: what this skill produces and the value it delivers.>

## What This Skill Does

- <bullet>
- <bullet>

## What This Skill Does NOT Do

- <explicit out-of-scope bullet — name the sibling skill that owns it>

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `<relevant scripts/lib, schemas, templates this skill reuses>` |
| **Conversation** | `<requirements/decisions already stated by the user>` |
| **Skill References** | Domain patterns from `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` + per-client `CLAUDE.md` overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for it.

**Required (must resolve before running):**
1. <user-context question, e.g. which `{slug}`>

**Optional (ask only if relevant):**
2. <nice-to-know question>

## Workflow

1. <imperative step>
2. <imperative step>

## Input / Output Specification

**Inputs:** `<files / args / env>`
**Outputs:** `<canonical contract — file paths + Supabase tables>`
(Full schemas and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| <e.g. KPI targets, audience, voice> | <e.g. scoring rubric, naming rules, safety gates> |

## Domain Standards

### Must Follow
- [ ] <enforceable requirement>

### Must Avoid
- <anti-pattern>

### Output Checklist (verify before delivery)
- [ ] <gate>

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing required input | Halt, name the missing field — never guess |
| Meta API error | Log code/type/fbtrace_id, surface, do not auto-retry |
| <skill-specific failure> | <fail-closed action> |

## Dependencies & Security

- **Reuses:** `<scripts/lib/*.js, schemas/*.js>`
- **External APIs:** `<Meta Graph API v25.0 / Stripe / Dropbox Sign>` (rate limits noted in `references/api-reference.md`)
- **Secrets:** resolved via env / `scripts/lib/tokens.js` — never hardcoded or logged

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| <Official doc> | <https://...> | <what> |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Thresholds, taxonomies, formulas, good/bad examples |
| `references/api-reference.md` | Exact endpoints, fields, version, rate limits |
| `references/io-contract.md` | Full JSON schemas + example payloads + edge cases |
