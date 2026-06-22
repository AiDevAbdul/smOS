---
name: brand-strategy
description: Use this skill to build the strategic foundation of a zero-start brand — purpose, mission/vision/values, persona, archetype, value proposition, differentiation, and the positioning statement — before any name, logo, or ad exists. This skill should be used when a brand-new client needs Phase 0 step 1 (typically via `/brand-strategy {slug}`), or to stamp the human-owned positioning gate that unblocks `/brand-name`. It persists a strategy layer into clients/{slug}/brand_profile.json and never auto-clears the positioning gate.
---

# /brand-strategy — Brand Strategy (Phase 0 · step 1 of 5)

Build the strategic "why" that every later brand layer hangs from. The AI drafts the strategy from intake + research; the human owns the positioning call — the single load-bearing gate of this skill. The companion `brand-strategy.js` persists the strategy layer (merge, never clobber) and, only on an explicit human flag, stamps the positioning gate that unblocks `/brand-name`.

## What This Skill Does

- Synthesize discovery from `client_profile.json` (+ optional competitor intel / pre-audit) — never re-research.
- Draft the brand core: purpose, mission, vision, 3–5 values.
- Draft the persona (demographics + psychographics: motivations, fears, triggers).
- Identify the competitive gap and differentiation.
- Write the positioning statement (internal anchor, not a public slogan).
- Recommend ONE primary archetype (of the 12) + optional secondary, with rationale.
- Draft value proposition, 3–5 messaging pillars, essence, and promise.
- Persist the strategy layer via `brand-strategy.js --in strategy.json` (merges into `brand_profile.json`).
- Stamp the positioning gate via `--approve-positioning` ONLY after explicit human approval.

## What This Skill Does NOT Do

- Generate the brand name, taglines, voice, or messaging house — owned by `/brand-name`.
- Generate logo, color, or type — owned by `/brand-visual`.
- Assemble guidelines (HTML+PDF) — owned by `/brand-book`.
- Produce social profile assets/bios — owned by `/brand-social`.
- Write ad copy or launch campaigns — owned by `/creative` and `/launch`.
- Auto-approve positioning — the human alone clears the gate via `--approve-positioning`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather | If absent (quality impact) |
|--------|--------|----------------------------|
| **Codebase** | `scripts/lib/brand.js` (load/merge/save/stampGate), `schemas/brand_profile.js` (strategy shape + ARCHETYPES + stage validator), `schemas/_shared.js` | Hard dependency — never proceed without them; the CLI imports them |
| **Conversation** | Positioning intent, audience, category, differentiators already stated | Fall back to the client profile; strategy is still produced |
| **Skill References** | Archetype taxonomy, positioning formula, persona model from `references/` (see table below) | Hard dependency — embedded expertise; never improvise the formula or archetype set |
| **Client Profile** | `clients/{slug}/client_profile.json` (required), per-client `CLAUDE.md` overrides | **Required — halt and route to `/intake` if missing; never blank-page a strategy** |
| **Competitor intel** | `clients/{slug}/competitor_intel.json` (optional) | Differentiation/counter-positioning is weaker and less defensible; proceed with a noted gap |
| **Pre-audit** | `clients/{slug}/pre_audit` artifacts (optional) | Persona psychographics rely more on intake alone; flag lower confidence |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge (archetypes, positioning
> formula, persona model) is embedded in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}` to build strategy for (must have `clients/{slug}/client_profile.json` from `/intake`).

**Optional (ask only if relevant):**
2. A preferred or excluded archetype the founder feels strongly about.
3. Non-negotiable values, or a specific competitor the brand must explicitly counter-position against.

> The positioning approval is a **human gate, not a clarifying question.** Do not "ask" for
> it as input — present the finished positioning statement and wait for the human to
> explicitly approve, then run `--approve-positioning`. The AI never self-clears it.

## Workflow

Produce the strategy layer in dependency order. Do NOT generate a name or any visual here.

1. Load and read `client_profile.json` (+ competitor intel / pre-audit if present). If no profile exists, halt: "Run `/intake {slug}` first — never blank-page a strategy."
2. Synthesize discovery; draft the brand core (purpose, mission, vision, 3–5 values).
3. Draft the persona (demographics + psychographics).
4. Identify the competitive gap and differentiation.
5. Write the positioning statement using the formula in `references/domain-standards.md`.
6. Recommend ONE primary archetype (of the 12) + optional secondary, with rationale.
7. Draft value proposition, 3–5 messaging pillars, essence, promise.
8. Write `strategy.json`, persist with `--in`, then present the positioning statement prominently for human approval. Do NOT proceed to `/brand-name` until approved.
9. On explicit human approval only, run `--approve-positioning` to stamp the gate.

## Input / Output Specification

**Inputs:** `clients/{slug}/client_profile.json` (required); `competitor_intel.json`, `pre_audit` (optional); a `strategy.json` you author matching `brand_profile.js`→`strategy`.
**CLI (companion `brand-strategy.js`):**
- `node skills/brand-strategy/brand-strategy.js {slug} --in strategy.json` — merge + validate the strategy layer.
- `node skills/brand-strategy/brand-strategy.js {slug} --approve-positioning` — stamp the positioning gate (human only).
**Outputs:** `clients/{slug}/brand_profile.json` (strategy layer + positioning gate; `status: positioning_approved` once stamped).
(Full schemas, example payloads, and exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Purpose, mission, vision, values, persona, differentiation, positioning text | The positioning-statement formula and required strategy fields |
| Chosen archetype(s) | The fixed set of 12 valid archetypes (`schemas/brand_profile.js` ARCHETYPES) |
| Messaging pillars, value prop, essence, promise | Merge-not-clobber persistence; fail-closed stage validation |
| Whether competitor intel / pre-audit exists | The positioning gate is human-only; never auto-stamped |

## Domain Standards

### Must Follow
- [ ] Base strategy on existing intake/research outputs; do not re-derive market data.
- [ ] Set `archetype.primary` to one of the 12 (lowercase) or validation rejects it.
- [ ] Write a positioning statement that follows the canonical 5-part formula (internal anchor, not a public slogan).
- [ ] Include 3–5 values (`values` must be non-empty) and 3–5 messaging pillars.
- [ ] Present the positioning to the human and obtain explicit approval before `--approve-positioning`.

### Must Avoid
- Blank-page generation when no profile exists — halt and route to `/intake`.
- Generating name/visual content (out of scope; later gates depend on this one).
- Stamping the positioning gate without explicit human confirmation.
- Clobbering other brand layers — always merge via `brand-strategy.js`.

### Output Checklist (verify before delivery)
- [ ] `strategy.json` validates against `brand_profile.js`→`strategy` (run `--in`).
- [ ] `positioning_statement` is present and non-empty (required by stage validator).
- [ ] `archetype.primary` is one of the 12 archetypes.
- [ ] Positioning shown prominently to the human; gate left unstamped until approved.
- [ ] After approval, `brand_profile.json.status == positioning_approved`.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Halt: "Run `/intake {slug}` first" — never guess a strategy |
| No `--in` and no `--approve-positioning` | CLI exits 1 (usage) — pass one of the two |
| `--in` path not found | CLI exits 2 — fix the path to `strategy.json` |
| `--approve-positioning` with empty `positioning_statement` | CLI exits 3, refuses to stamp — write the strategy first |
| Strategy fails stage validation (empty values, bad archetype, no positioning) | `saveBrand` throws fail-closed; fix the named field and re-run |
| Asked to stamp without human approval | Refuse — the positioning gate is human-only |

## Dependencies & Security

- **Reuses:** `scripts/lib/brand.js` (`loadBrand`, `saveBrand`, `stampGate`), `schemas/brand_profile.js` (strategy normalize + fail-closed `validate`), `schemas/_shared.js` (`pick`/`asArray`/`isNonEmptyString`/`result`).
- **Runtime:** Node.js (ESM); no network calls, no external API.
- **External APIs:** none. No tokens or secrets are read or written — this skill is purely local file persistence.
- **Filesystem:** writes only `clients/{slug}/brand_profile.json`.

## Documentation & References

This skill calls **no external API of its own** — it is local file persistence. The
sources below are the canonical contracts it depends on, plus the two downstream Meta/
accessibility policies that any later AI-generated brand asset inherits from this layer.

| Resource | URL | Use For | Last verified |
|----------|-----|---------|---------------|
| smOS brand schema | `schemas/brand_profile.js` (in-repo) | Canonical `strategy` shape, the 12 `ARCHETYPES`, fail-closed stage validator | 2026-06-22 |
| smOS brand persistence | `scripts/lib/brand.js` (in-repo) | Merge-not-clobber `saveBrand` + human-gate `stampGate` semantics | 2026-06-22 |
| smOS shared doc map | `skills/references-shared.md` (in-repo) | Canonical official-URL map reused by all skills | 2026-06-22 |
| WCAG 2.1 SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | Accessibility baseline the value-prop/positioning must respect downstream when `/brand-visual` chooses brand colors (4.5:1 normal / 3:1 large) | 2026-06-22 |
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | The AI-disclosure obligation any later AI-generated brand asset inherits via `visual.ai_generated` → ad `ai_disclosed` | 2026-06-22 |

For patterns not covered here, fetch the official docs above and apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | The 12 archetypes + how to pick one, the positioning-statement formula, persona model, value-prop/pillars/essence definitions, and good/bad examples |
| `references/process-reference.md` | Step-by-step strategy method, the human positioning gate, persistence semantics, and how this layer hands off to `/brand-name` / `/brand-visual` (this skill has no external API — this file substitutes for an api-reference) |
| `references/io-contract.md` | Full `strategy` JSON schema, example `strategy.json` + persisted `brand_profile.json`, CLI exit codes, and edge-case handling |
