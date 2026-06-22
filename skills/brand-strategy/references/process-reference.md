# Brand Strategy — Process & Handoff Reference

`/brand-strategy` has **no external API** — it is purely local file persistence. This
file (`process-reference.md`) stands in for an api-reference: it documents the strategy
method, the human positioning gate, the persistence semantics of `scripts/lib/brand.js`,
and how this layer hands off down the Phase 0 chain. Readable independently.

Last verified: 2026-06-22.

---

## 1. Where this skill sits

```
/intake (no account ids)
  → /brand-strategy   ──★ positioning approved (HUMAN)   ← THIS SKILL
  → /brand-name       ──★ name approved (HUMAN)
  → /brand-visual     ──★ logo approved (HUMAN)
  → /brand-book → /brand-social → /setup-accounts → … → existing pipeline
```

Each later stage refuses to validate until the prior human gate timestamp is stamped.
`/brand-strategy` owns the **first** of the three load-bearing gates: `positioning`.

---

## 2. The strategy method (order matters)

1. **Synthesize, don't research.** Read `clients/{slug}/client_profile.json` (from
   `/intake`), plus `competitor_intel.json` and `pre_audit` artifacts if present. Do not
   re-pull market data — `/research` and `/pre-audit` already did.
2. **Brand core first:** purpose → mission → vision → values (3–5). These constrain
   everything below.
3. **Persona:** demographics + psychographics (see `domain-standards.md` §4).
4. **Gap + differentiation:** where the competitive set is weak/absent.
5. **Positioning statement:** the 5-part formula (`domain-standards.md` §2). This is the
   anchor the human approves.
6. **Archetype:** one primary of 12 (+ optional secondary) with rationale.
7. **Value prop, pillars (3–5), essence, promise.**
8. **Persist → present → approve.**

---

## 3. The positioning gate (human-only)

The gate is the entire point of the skill's safety model. Two distinct CLI actions:

| Action | Command | Who | Effect |
|--------|---------|-----|--------|
| Persist strategy | `node skills/brand-strategy/brand-strategy.js {slug} --in strategy.json` | AI | Merges strategy layer, validates fail-closed, leaves gate UNSTAMPED |
| Stamp gate | `node skills/brand-strategy/brand-strategy.js {slug} --approve-positioning` | **HUMAN** | Sets `strategy.positioning_approved_at` + `status: positioning_approved` |

Rules:
- AI never runs `--approve-positioning` on its own. Present the positioning prominently;
  wait for explicit human confirmation; only then stamp.
- `--approve-positioning` refuses (exit 3) if `positioning_statement` is empty — you
  cannot approve a strategy that was never written.
- The gate mirrors smOS's constitution: humans approve consequential decisions.

---

## 4. Persistence semantics (via `scripts/lib/brand.js`)

- `loadBrand(slug)` returns a normalized profile (or a fresh draft skeleton).
- `saveBrand(slug, {strategy}, {stage:"strategy"})` **deep-merges** the patch into the
  existing profile (never clobbers `verbal`/`visual`/`guidelines`/`social`), normalizes,
  then runs the fail-closed stage validator before writing.
- `stampGate(slug, "positioning")` writes the timestamp + status. It does not re-validate
  the whole profile — it only stamps.
- The file written is `clients/{slug}/brand_profile.json`.

---

## 5. Handoff contract to `/brand-name`

`/brand-name` calls `validate(profile, {stage:"verbal"})`, which asserts
`strategy.positioning_approved_at` is set before it will produce a name. So:

- If positioning is **unstamped**, `/brand-name` halts with "(/brand-name requires
  strategy.positioning_approved_at to be set first — prior human gate not cleared)".
- The fix is never to fake the timestamp — it is to get the human to approve, then run
  `--approve-positioning`.

Downstream, `/creative`, `/content-plan`, `/setup-web`, and `/brand-social` all read this
same `brand_profile.json`, so a clean strategy layer protects the whole chain.

---

## 6. Keeping current

This skill cites no versioned external API, so its references rarely change. Revisit if:
- `schemas/brand_profile.js` adds/renames a `strategy` field or changes `ARCHETYPES`.
- `scripts/lib/brand.js` changes merge or gate semantics.
- The constitution's human-gate policy changes.

When any of these change, update `domain-standards.md` (fields/archetypes) and
`io-contract.md` (schema/exit codes) in the same edit. Last verified: 2026-06-22.
