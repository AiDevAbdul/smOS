---
name: brand-name
description: Use this skill when a client needs a brand name and verbal identity (typically via `/brand-name {slug}`). Generates name candidates, auto-screens each against the THREE independent gates (.com availability, trademark knockout, social-handle availability), and produces tagline + voice + messaging house. Fail-closed on the name gate — never auto-clears trademark; always flags attorney clearance. Requires positioning to be approved first.
---

# /brand-name — Verbal Identity (Phase 0 · step 2 of 5)

The name is the anchor of the brand and must clear three **independent** screens before anything visual starts. AI generates ~60%, human curates ~30%, **legal verification is the ~10% that is never automated** — the trademark knockout is advisory only; a human attorney clears the final mark.

## Precondition (fail-closed)

`brand_profile.json → strategy.positioning_approved_at` must be set. If not, halt: "Run `/brand-strategy {slug}` and get positioning approved before naming." (The schema validator enforces this at stage `verbal`.)

## Required Context

- `clients/{slug}/brand_profile.json` — strategy layer (archetype, positioning, audience inform name tone)

## Workflow

1. **Generate** 15–30 candidates across name types (descriptive / suggestive / abstract / coined / compound). Coined + abstract marks are the most trademark-defensible — bias toward them when the category is crowded.
2. **Shortlist** ~6 on memorability, pronounceability, distinctiveness, cultural soundness.
3. **Screen each shortlisted name** against the three gates (the companion script does this):
   - **`.com` availability** — RDAP/DNS check (authority signal; independent of trademark)
   - **Trademark knockout** — USPTO quick-search for identical/near-identical live marks. This is a *knockout filter only*, never a clearance. ALWAYS set `attorney_clearance_flagged: true`.
   - **Social handles** — Instagram / Facebook / X / TikTok / LinkedIn availability
4. **Present the screened shortlist** to the human with the gate results per name. Recommend one, but the **human picks**.
5. Once chosen, draft the rest of verbal identity: **tagline**, **voice** (3–5 traits + NN/g spectrums + do/don't), **messaging house** (roof/walls/foundation), **elevator pitch**, **boilerplate**.

## Persisting

Screen candidates:
```
node skills/brand-name/brand-name.js {slug} --screen "Acme,Northwind,Lumina"
```
This writes the screening results and prints a per-name gate table. It does NOT pick a name.

Persist the chosen name + verbal layer:
```
node skills/brand-name/brand-name.js {slug} --in verbal.json
```
`verbal.json` matches `schemas/brand_profile.js → verbal` (name, name_candidates[], tagline, voice{traits,spectrums,do,dont}, messaging_house{roof,walls,foundation}, elevator_pitch, boilerplate).

**Approval gate (human only):**
```
node skills/brand-name/brand-name.js {slug} --approve-name
```
Sets `verbal.name_approved_at` + `status: named`. `/brand-visual` refuses to run until this is set. The script refuses to stamp if `attorney_clearance_flagged` is not acknowledged.

## Output

- `clients/{slug}/brand_profile.json` (verbal layer + name gate)

## Safety

- **Trademark is never auto-cleared.** The knockout only rules names OUT; it can never rule one IN. Final clearance is an attorney's call, surfaced as a required human acknowledgement.
- Screening is best-effort: if a registry/RDAP call fails, the field is `null` (unknown), never silently `true`.

## Token Efficiency

- Screening is pure network + classification, no LLM.
- Generation reuses the strategy layer (archetype/positioning), not a cold prompt.
