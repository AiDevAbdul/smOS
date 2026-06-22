---
name: creative
description: Use this skill to generate, score, and lint a client ad-copy package (hooks, primary text, headlines, CTAs, design brief) from an approved strategy brief. This skill should be used when the user asks to write ad copy, generate creative variants, or produce a creative package for a client — typically via `/creative {slug}`. It runs a two-mode Node companion (`skeleton` to scaffold, `lint` to score + voice-check) and outputs `ad_copy.json` for `/launch`. Never auto-rewrites copy; surfaces voice/length violations for human review.
---

# /creative — Ad Copy Package (Phase 4 — Creative)

Turn an approved `strategy_brief.json` into a launch-ready, scored, voice-checked ad-copy
package. Claude writes the hooks/text; a deterministic Node companion enforces length,
restricted-word, CTA-enum, and scoring rules — then writes the canonical `ad_copy.json` that
`/launch` consumes. The companion never edits copy: it surfaces violations for a human to fix.

## What This Skill Does

- Scaffold a fill-in draft (`ad_copy_draft.json`) from the brief's creative angles (`skeleton` mode).
- Have Claude write 5 hooks per angle, each with 3 primary-text / 3 headline / 3 CTA variants in the client's voice.
- Run deterministic length, restricted-word (`voice.restricted_words` + `voice.avoid`), engagement-bait, and Meta CTA-enum checks (`lint` mode).
- Score every variant 0–10 on clarity / specificity / emotional_trigger / cta_strength, pick the top combo per angle, and write canonical `ad_copy.json`.

## What This Skill Does NOT Do

- **Build the campaign tree / push to Meta** — that is `/launch`.
- **Generate audiences or angles** — those come from `/audience-map` and `/strategy-brief`.
- **Produce final imagery/video** — this writes a *design brief*; asset production is `/assets`.
- **Score live ads or organic posts** — that is `/audit-creative`.
- **Auto-rewrite off-brand copy** — by design it only flags; the human edits the draft and re-lints.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/creative/creative.js`; `schemas/ad_copy.js` (canonical shape, `selectTopCopy`); `schemas/_shared.js` (`angleId`, `assertValid`) |
| **Conversation** | Any angle/offer/tone decisions the user already stated |
| **Skill References** | Scoring rubric, taxonomies, CTA enum, I/O shape — see Reference Files table |
| **Client Profile** | `clients/{slug}/client_profile.json` → `voice.tone`, `voice.restricted_words`, `voice.avoid`, `audience.pain_points`, `assets.brand_colors` |
| **Prior handoff** | `clients/{slug}/strategy_brief.json` → `creative_angles[]` (`angle_id`, `hook`, `format`) + approval status |

## Clarifications

> Before asking: check the conversation, the client profile, and the strategy brief.
> Only ask for what cannot be determined. Domain knowledge (rubric, limits, CTA enum) lives in
> `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}`?

**Optional (ask only if relevant):**
2. A non-default draft path (`--draft`) if the filled draft lives outside `clients/{slug}/ad_copy_draft.json`.
3. Whether to proceed when the brief is not yet `approved` (the companion warns but does not halt on lint).

## Workflow

1. Confirm `clients/{slug}/strategy_brief.json` exists and its Supabase `strategy_briefs` row is `approved`. If not approved, do not advance to `/launch`.
2. Run `node skills/creative/creative.js {slug} skeleton` → writes `ad_copy_draft.json` (refuses if one already exists).
3. Claude fills each angle's empty arrays: 5 hooks, and per hook 3 `primary_text`, 3 `headlines`, 3 `ctas` (Meta CTA enum). Follow the limits and voice in `references/domain-standards.md`.
4. Run `node skills/creative/creative.js {slug} lint` → scores variants, runs all checks, picks top combos, validates against `schemas/ad_copy.js`, writes `ad_copy.json`.
5. If `summary.non_compliant > 0` or `over_limit > 0`: edit the draft to fix the flagged variants, then re-lint. Do not hand off until clean.
6. Report top picks + issue count; point to `/launch`.

## Input / Output Specification

**Inputs:** `{slug}` arg; mode (`skeleton` | `lint`); optional `--draft PATH`. Reads `client_profile.json` (both modes) and `strategy_brief.json`.
**Outputs:** `clients/{slug}/ad_copy_draft.json` (skeleton); `clients/{slug}/ad_copy.json` (lint, schema-validated). Both modes print a single pretty-printed JSON summary to stdout.

**Exit-0 "done / clean" contract** (what success means before handing off to `/launch`):
- `skeleton` exits `0` only after writing a fresh `ad_copy_draft.json` (exits `2` if one already exists — never overwrites).
- `lint` exits `0` only after `assertValid("ad_copy", …)` passes and `ad_copy.json` is written. Exit 0 does **not** imply zero issues — also confirm `summary.non_compliant == 0` **and** `summary.over_limit == 0` before handoff. A non-zero count means edit the draft and re-lint.
- Any non-zero exit (`1` bad input / unknown mode / schema throw, `2` draft exists) means nothing valid was produced — fix and rerun.

The `ad_copy` Supabase row is written by the agent after a clean lint, not by the script.
(Full schemas, example payloads, edge cases, and the full stdout shape: `references/io-contract.md` and `references/api-reference.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Voice/tone, `restricted_words`, `avoid` list | Length limits (hook 60 / primary 500 / headline 40 / desc 30) |
| Audience pain points (drive emotional scoring) | 0–10 four-axis scoring rubric + composite = average |
| Number of angles + their `format` (from brief) | Valid Meta CTA enum set (31 values) |
| Brand colors / formats (feed design brief) | Engagement-bait blocklist; design-brief sizes 1080×1080 / 1080×1920 / 1200×628 |
| Hook archetypes used | `angle_id` join-key derivation; fail-closed schema gate |

## Domain Standards

### Must Follow
- [ ] Strategy brief must exist and be `approved` before `/launch`; `skeleton` requires the brief.
- [ ] Every variant respects its length limit (see `references/domain-standards.md`).
- [ ] Every CTA is a value in the Meta CTA enum set.
- [ ] Carry `angle_id` from brief → draft → `ad_copy.json` unchanged (it is the `/launch` join key).
- [ ] Restricted-word / `voice.avoid` hits are surfaced, never silently rewritten.

### Must Avoid
- Overwriting an existing `ad_copy_draft.json` (skeleton refuses with exit 2).
- Engagement bait ("tag a friend", "comment below", "share if", etc.).
- Inventing CTA strings outside the enum.
- Hand-editing `ad_copy.json` instead of editing the draft and re-linting.

### Output Checklist (verify before delivery)
- [ ] `lint` exited 0 and `ad_copy.json` passed `assertValid("ad_copy", …)`.
- [ ] `summary.non_compliant == 0` and `summary.over_limit == 0`.
- [ ] Each angle has exactly one `top_pick: true` hook.
- [ ] Every angle has a usable `angle_id`, `name`, and copy.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` or mode | Print usage, exit 1 — never guess |
| `client_profile.json` not found | Throw `Profile not found`, exit 1 |
| `strategy_brief.json` not found | Throw `Strategy brief not found`, exit 1 |
| Draft already exists (skeleton) | Refuse to overwrite, exit 2 |
| Draft missing (lint) | Throw `Draft not found — run skeleton mode first`, exit 1 |
| Brief status ≠ `approved` (lint) | WARN to stderr, lint anyway, but block `/launch` until approved |
| Unknown mode | Throw `Unknown mode` — only `skeleton` / `lint` |
| Output fails schema validation | `assertValid` throws naming the bad field; do not write — fix copy |
| Restricted-word / over-limit hits | Recorded in `summary.issues`; surface for human edit, do not auto-rewrite |

## Dependencies & Security

- **Reuses:** `schemas/ad_copy.js` (`normalize`/`validate`/`selectTopCopy`), `schemas/_shared.js` (`angleId`, `assertValid`), Node built-ins (`fs`, `path`, `url`).
- **External APIs:** none at runtime — all checks are local/deterministic. CTA enum and limits are sourced from the Meta Ads Guide (see references).
- **Secrets:** none read by the script. The agent's Supabase write uses the connector's env-resolved key — never hardcoded or logged.

## Documentation & References

| Resource | URL | Use For | What to extract on fetch |
|----------|-----|---------|--------------------------|
| Meta Ads Guide (creative specs) | https://www.facebook.com/business/ads-guide | CTA enum + placement copy/size specs behind the design brief | Open a Feed/Reels/Stories placement → "Call to action" dropdown: read the **current CTA button list**, diff it against `VALID_CTAS` (31 values). Read the **recommended resolution / aspect ratio** rows → confirm 1080×1080 (1:1), 1080×1920 (9:16), 1200×628 (1.91:1) and the ~125-char primary-text truncation are unchanged. |
| Outcome objectives (ODAX) | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | Funnel-stage alignment of CTA to objective | Read the six `OUTCOME_*` enums → map each to the CTA tier in `references/domain-standards.md` (awareness→`LEARN_MORE`, consideration→`SIGN_UP`, conversion→`SHOP_NOW`/`BUY_NOW`). |
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | When the design brief implies AI imagery (handoff to `/launch` `ai_disclosed`) | Read the **what-must-be-disclosed** scope → confirm photorealistic AI imagery/video still requires self-disclosure so the design brief flags it for `/launch`. |
| Ad node (creative field) | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ | How copy maps onto the ad creative in `/launch` | Read the `creative` field on the Ad node → confirm primary text / headline / CTA still map onto `object_story_spec` the way `/launch` expects. |

For patterns not covered here, fetch the official docs above and extract exactly the
fields named in the right-hand column. If the CTA list, sizes, or truncation differ from
what `creative.js` encodes, update the code (`VALID_CTAS` / `LIMITS`) first, then mirror it
into `references/domain-standards.md`, then bump the canonical date below — never edit docs
alone. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22 — this is the single source-of-truth date for this skill.
`references/domain-standards.md`, `references/api-reference.md`, and `references/io-contract.md`
defer to this line rather than carrying independent dates; re-verify all together and bump only here.

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Writing copy: length limits, CTA enum, scoring rubric + formulas, archetypes, engagement-bait list, good/bad examples |
| `references/api-reference.md` | The two CLI modes — exact commands, flags, exit codes, stdout shape, and the Meta CTA/spec sourcing |
| `references/io-contract.md` | Full draft + `ad_copy.json` schemas, example payloads, the `angle_id` join key, and edge-case handling |
