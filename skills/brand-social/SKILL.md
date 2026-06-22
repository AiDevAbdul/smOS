---
name: brand-social
description: Use this skill to dress a brand's social profiles once its visual identity is locked — producing the applied social surface (profile picture, Facebook cover, Instagram highlight covers, post/story templates, link-in-bio, and platform-correct bio copy) into brand_profile.json at 2026 specs. This skill should be used when a brand-new Page/IG needs to look like a real brand on day one, typically via `/brand-social {slug}` and after `/brand-visual` has approved the logo. It is Phase 0 step 5 of 5 and feeds /assets, /publish, and /content-plan.
---

# /brand-social — Social Brand Assets (Phase 0 · step 5 of 5)

Build the applied social surface — the layer that derives entirely from the locked brand book. This is what makes a brand-new Page/IG look like a real brand on day one. Produce both the visual asset specs and the platform-correct copy, then persist them into the `social` layer of `brand_profile.json`.

## What This Skill Does

- Design the profile picture (logo mark on brand color), Facebook cover, and a matching Instagram highlight-cover set to 2026 mobile-first specs.
- Build the post/story template family (quote, tip/carousel cover, promo, testimonial, story-CTA) using locked fonts/colors/logo.
- Write Instagram and Facebook bios using platform formulas in the brand voice, respecting `client_profile.voice.restricted_words`.
- Define the link-in-bio structure and a branded hashtag.
- Persist the `social` layer via `brand-social.js`, which marks `brand_profile.json` `status: complete` once the full artifact validates.

## What This Skill Does NOT Do

- Does NOT create the strategy, name, or visual identity — owned by `/brand-strategy`, `/brand-name`, `/brand-visual` (this skill consumes their locked output).
- Does NOT assemble the guidelines doc — owned by `/brand-book`.
- Does NOT create real accounts or upload assets to a live Page/IG — owned by `/setup-accounts`.
- Does NOT schedule or publish content — owned by `/publish` and `/content-plan`.
- Does NOT version assets in the DAM — owned by `/assets`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/brand.js` (load/merge/save/gate), `schemas/brand_profile.js` (`social` shape + `validate`) |
| **Conversation** | Any asset/bio direction or restricted-word changes the user already stated |
| **Skill References** | Specs, bio formulas, taxonomies — `references/domain-standards.md`; persistence I/O — `references/io-contract.md`; live upload specs — `references/api-reference.md` |
| **Client Profile** | `clients/{slug}/brand_profile.json` (logo, colors, type, voice, name, tagline) + `clients/{slug}/client_profile.json` (business + audience for bio copy) |

## Clarifications

> Before asking: check the conversation, the client profile, and `brand_profile.json`.
> Only ask for what cannot be determined. Domain knowledge (specs, formulas) is in
> `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}`?

**Optional (ask only if relevant):**
2. Any preferred highlight-cover categories or link-in-bio destinations beyond the defaults?
3. Is the profile picture or cover AI-generated? (If so, `visual.ai_generated` must be true upstream.)

## Workflow

1. Load the brand profile via `loadBrand(slug)`; confirm `visual.logo_approved_at` is set (else halt — see Error Handling).
2. Produce the profile picture, FB cover, matching IG highlight-cover set, and template family to the specs in `references/domain-standards.md`. Save asset files under `clients/{slug}/brand/social/` and reference them by path/URL.
3. Write IG + FB bios using the formulas in the brand voice, respecting `client_profile.voice.restricted_words`.
4. Define the link-in-bio structure (lead with the highest-value action) and a branded hashtag.
5. Assemble the `social` JSON matching the schema and persist it via `brand-social.js`.
6. Report the resulting `status`; if `complete: false`, surface the named missing fields.

## Input / Output Specification

**Inputs:** `{slug}` (positional), `--in social.json` (required) where `social.json` matches `schemas/brand_profile.js → normalizeSocial`. Reads `clients/{slug}/brand_profile.json` + `clients/{slug}/client_profile.json`.
**Run:** `node skills/brand-social/brand-social.js {slug} --in social.json`
**Outputs:** `clients/{slug}/brand_profile.json` (merged `social` layer; `status: complete` once the whole artifact validates) + asset files under `clients/{slug}/brand/social/`. Prints a JSON summary `{slug, layer, status, profile_picture, ig_bio, complete, next}` to stdout.
(Full schemas, example payloads, and exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Logo, colors, type, name, tagline, voice, audience, restricted words | The five brand layers + their dependency order |
| Bio copy, highlight categories, link-in-bio destinations, branded hashtag | Bio formulas (IG 3-line; FB problem→solution→reward) |
| Which assets are AI-generated | 2026 platform dimensions + safe zones |
| Template content | Template family taxonomy (quote/tip/promo/testimonial/story-CTA) |
| | The fail-closed logo gate + `social` schema shape |

## Domain Standards

### Must Follow
- [ ] Confirm `visual.logo_approved_at` is set before producing any asset.
- [ ] Build every asset to the 2026 dimensions and safe zones in `references/domain-standards.md`.
- [ ] Use only locked fonts/colors/logo from the `visual` layer — no off-brand additions.
- [ ] Front-load the FB bio's first ~155 chars; put the IG keyword in the indexed Name field.
- [ ] Strip any word in `client_profile.voice.restricted_words` from all copy.
- [ ] Fill templates/bios from `brand_profile.json` + voice — never blank-page generate.

### Must Avoid
- Auto-stamping or fabricating `visual.logo_approved_at` — it is a human gate.
- Re-deriving assets that `/assets` already versions, or clobbering a prior brand layer.
- Hardcoding the IG publish quota or platform dimensions outside the reference file.

### Output Checklist (verify before delivery)
- [ ] `social.profile_picture_url` and `social.bios.instagram` are set (schema-required).
- [ ] FB cover at 851×315 with content centered; IG highlight icons within the center 720×720 safe zone.
- [ ] Bios pass restricted-word screen and match platform formulas.
- [ ] Persisted profile validates; `status` is `complete` or the missing fields are surfaced.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` arg | Print usage, exit 1 — never guess |
| Missing `--in` flag | Print "Provide --in social.json", exit 1 |
| `visual.logo_approved_at` not set | Halt: "Approve the logo in `/brand-visual` first." (exit 3) — never auto-clear the gate |
| `--in` file not found | Print "Input not found: <path>", exit 2 |
| `social` layer fails schema validation | `saveBrand` throws fail-closed listing every missing field; surface, do not partial-write |
| Full artifact incomplete | Keep `status` as-is, report `complete: false` + named missing fields in `next` |
| Asset is AI-generated but `visual.ai_generated` false | Halt; set `visual.ai_generated` upstream in `/brand-visual` so `/launch`'s ai-disclosure guard carries through |

## Dependencies & Security

- **Reuses:** `scripts/lib/brand.js` (`loadBrand`, `saveBrand`, `brandPath`), `schemas/brand_profile.js` (`normalizeSocial`, `validate`).
- **Runtime:** Node.js (ES modules); no external API calls in this skill. Live upload happens later in `/setup-accounts` against Meta Graph API v25.0 (see `references/api-reference.md`).
- **Secrets:** none used here. When `/setup-accounts` uploads these assets it resolves per-client tokens via `scripts/lib/tokens.js` — never hardcoded or logged.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Meta Ads Guide (creative specs) | https://www.facebook.com/business/ads-guide | Official placement-by-placement image/video specs |
| Meta Business Help Center | https://www.facebook.com/business/help | Authoritative Page profile/cover guidance |
| IG Content Publishing guide | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | Two-step publish flow + 100 posts/24h limit (used downstream) |
| WCAG 2.1 SC 1.4.3 Contrast | https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html | 4.5:1 / 3:1 AA contrast for logo-on-color profile pics |
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | When a profile pic/cover is AI-generated |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | 2026 platform dimensions, safe zones, bio formulas, template taxonomy, restricted-word handling, good/bad examples |
| `references/api-reference.md` | Downstream live-upload endpoints/fields/specs (Meta Graph API v25.0) used by `/setup-accounts`; rate limits |
| `references/io-contract.md` | Full `social` JSON schema, example `social.json` + stdout payloads, exit codes, edge cases |
