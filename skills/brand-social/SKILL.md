---
name: brand-social
description: Use this skill when a brand's identity is locked and its social profiles need to be dressed (typically via `/brand-social {slug}`). Produces the applied social surface — profile picture, FB cover, IG highlight covers, post/story templates, link-in-bio, and platform-correct bio copy — into brand_profile.json at 2026 specs. Requires the logo to be approved first. Feeds /assets (DAM), /publish, and /content-plan.
---

# /brand-social — Social Brand Assets (Phase 0 · step 5 of 5)

The applied surface, built last — it derives entirely from the locked brand book. This is what makes a brand-new Page/IG look like a real brand on day one. Produces both the visual asset specs and the copy.

## Precondition (fail-closed)

`brand_profile.json → visual.logo_approved_at` must be set. Otherwise halt: "Approve the logo in `/brand-visual` first." (Enforced at schema stage `social`.)

## Required Context

- `clients/{slug}/brand_profile.json` — logo, colors, type, voice, name, tagline
- `clients/{slug}/client_profile.json` — business + audience for bio copy

## 2026 specs (build to these — vertical/mobile-first)

- **Facebook:** profile 320×320 · cover **851×315** (keep content centered, desktop/mobile crop differently)
- **Instagram:** profile 320×320 (renders ~110px circle) · feed **1080×1350 (4:5)** · story/reels 1080×1920
- **IG highlight covers:** design at 1080×1920 but keep the icon in the **center 720×720** safe zone; matching set
- **Templates:** quote, tip/carousel cover, promo, testimonial, story-CTA — locked fonts/colors/logo; story safe margins (top ~250px / bottom ~310px)

## Bio formulas

- **Instagram (3-line):** Identity + Value + CTA — put the keyword in the indexed Name field
- **Facebook:** Problem → Solution → Reward — front-load the first ~155 chars, set the CTA button

## Workflow

1. Validate the brand profile at stage `social`.
2. Produce profile picture (logo mark on brand color), FB cover, a matching IG highlight-cover set, and the template family — to the specs above. Save assets under `clients/{slug}/brand/social/` and reference by path/URL.
3. Write IG + FB bios using the formulas, in the brand voice, respecting `client_profile.voice.restricted_words`.
4. Define the **link-in-bio** structure (lead with the highest-value action) and a branded hashtag.
5. If any asset is AI-generated, ensure `visual.ai_generated` is true upstream.

## Persisting

```
node skills/brand-social/brand-social.js {slug} --in social.json
```
`social.json` matches `schemas/brand_profile.js → social` (profile_picture_url, fb_cover_url, ig_highlight_covers[], templates[], link_in_bio, bios{instagram,facebook}, branded_hashtag).

## Output

- `clients/{slug}/brand_profile.json` (social layer; `status: complete` once valid)
- Asset files under `clients/{slug}/brand/social/`

## Handoffs

- `/setup-accounts` uploads the profile picture + cover to the real Page/IG once they exist.
- `/assets` (DAM) versions these templates; `/content-plan` + `/publish` reuse them — no re-derivation.

## Token Efficiency

- Templates + bios are filled from `brand_profile.json` + voice, not blank-page generated.
