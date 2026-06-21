---
name: brand-strategy
description: Use this skill when a zero-start client needs a brand foundation before any name, logo, or ads exist (typically via `/brand-strategy {slug}`). Produces the strategic core — purpose, mission/vision/values, persona, archetype, value proposition, differentiation, and the positioning statement — into brand_profile.json. This is Phase 0, step 1; everything downstream (naming, visual, creative) depends on the positioning gate it sets.
---

# /brand-strategy — Brand Strategy (Phase 0 · step 1 of 5)

The strategic "why" that every later layer hangs from. AI drafts; **the human owns the positioning call** — the single load-bearing gate of this skill. Nothing visual or verbal may start until positioning is approved.

## Required Context

- `clients/{slug}/client_profile.json` — business, audience, competitors (from `/intake`)
- `clients/{slug}/competitor_intel.json` (optional) — market gaps to position against
- `clients/{slug}/pre_audit` artifacts (optional) — public signal if `/pre-audit` ran

If no profile exists, halt: "Run `/intake {slug}` first — never blank-page a strategy."

## Workflow

Produce the strategy layer in dependency order (research → core → persona/gap → **positioning** → archetype/voice inputs → essence). Do NOT generate a name or any visual here.

1. **Synthesize discovery** from the profile + competitor intel (don't re-research what `/research` already pulled).
2. Draft the **brand core**: purpose, mission, vision, 3–5 values.
3. Draft the **persona** (demographics + psychographics: motivations, fears, triggers).
4. Identify the **competitive gap** and **differentiation**.
5. Write the **positioning statement** (internal anchor, not a public slogan):
   *"For [audience] who [need], [brand] is the [category] that [benefit], because [reason to believe]."*
6. Recommend ONE **archetype** (of the 12) + optional secondary, with the rationale.
7. Draft **value proposition**, 3–5 **messaging pillars**, **essence** + **promise**.
8. Persist as a draft and **present the positioning statement to the human for approval** — show it prominently. Do not proceed to `/brand-name` until approved.

## Persisting

Write the strategy layer (merges into `brand_profile.json`, never clobbers other layers):

```
node skills/brand-strategy/brand-strategy.js {slug} --in strategy.json
```

`strategy.json` matches `schemas/brand_profile.js` → `strategy` (purpose, mission, vision, values[], persona, archetype_primary, archetype_secondary, value_proposition, differentiation, positioning_statement, messaging_pillars[], essence, promise).

**Approval gate (human only):** once the operator confirms the positioning, stamp it:

```
node skills/brand-strategy/brand-strategy.js {slug} --approve-positioning
```

This sets `strategy.positioning_approved_at` and `status: positioning_approved`. `/brand-name` fail-closed refuses to run until this is set.

## Output

- `clients/{slug}/brand_profile.json` (strategy layer + positioning gate)

## Safety

- The skill NEVER stamps the positioning gate on its own — only on an explicit `--approve-positioning` from the human. This mirrors smOS's "human approves consequential decisions" pattern.
- Archetype must be one of the 12 (`schemas/brand_profile.js` ARCHETYPES) or validation rejects it.

## Token Efficiency

- Reuses `/intake` + `/research` outputs; does not re-derive market data.
- Strategy is template-shaped from the profile, not blank-page generated.
