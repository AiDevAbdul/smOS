---
name: image-gen
description: Use this skill to generate branded poster imagery — a Krea AI background composited with the client's logo and a contact/handle bar (phone, website, @handles) — for both organic content and paid ad creative. This skill should be used when the user asks to generate images/posters/creative for a client's content calendar or ad angles, typically via `node skills/image-gen/image-gen.js {slug}` (organic, fills `content_calendar.json` items) or `node skills/image-gen/image-gen-ads.js {slug}` (paid, fills `ad_copy.json` angles for `/launch`). Requires an approved brand kit (`/brand-visual`) and at least one contact/handle field on `client_profile.contact` — fails closed otherwise.
---

# /image-gen — Branded Poster Generation (Organic + Paid)

Generate a background/hero image via Krea, then deterministically composite a full,
professional ad layout onto it — **eyebrow, headline, sub-headline, benefit bullets, a CTA
button, the client's logo, and a streamlined contact strip** — so every poster is a real
ad, not just a branded photo. Krea only ever renders the background; all text/brand elements
are drawn pixel-exact from the approved brand kit, because diffusion models render
logos/small text unreliably.

**How the marketing copy is sourced (no new manual input):** `scripts/lib/poster_spec.js`
resolves the on-poster copy from artifacts that already exist — a paid `ad_copy.json` angle
(best-scored `headlines`/`descriptions`/`ctas`) or an organic `content_calendar.json` item
(`message`/`keywords`/`pillar_id`). If there isn't enough to make an ad (no headline), the
compositor falls back to the legacy logo + contact-bar-only layout.

**Rendering (deterministic branding):** the text layer is built with **Satori** (HTML/CSS →
SVG) and rasterized with **resvg-js**, using brand fonts bundled in-repo
(`scripts/lib/poster_fonts/`, loaded by `scripts/lib/poster_fonts.js`). This replaces the old
librsvg SVG-text path, whose fonts resolved against whatever the host machine had installed
(non-deterministic). The photo background, brand-color wash, and a bottom-to-top legibility
scrim stay in `scripts/lib/poster_compose.js` (sharp).

**Fonts follow the client's own brand kit, not one house default.** `poster_fonts.js` reads
`brand_profile.json`'s `visual.typography.heading`/`.body` (free-text brand-kit descriptions,
e.g. `"Fraunces (serif) — matches the wordmark"`) and matches known font names against a
small in-repo registry — falling back to the house default (Oswald display / Inter body)
only when the brand kit names a font we don't have bundled bytes for (a system font like "SF
Pro Text" with no redistributable license, or a generic description like "sans-serif"). Every
poster is still fully deterministic — same brand always resolves to the same bundled files.
**Adding a client whose brand kit names a new font:** `npm pack @fontsource/<name>`, copy its
500/600-weight latin `.woff` files into `scripts/lib/poster_fonts/`, add an entry to
`FONT_REGISTRY` in `poster_fonts.js` (OFL-licensed fonts only, matching the existing bundle).

## Layout Rules (fixed in the library — never re-litigate per poster)

These are encoded in `scripts/lib/poster_compose.js` / `poster_text_layer.js` so every
future poster inherits them automatically. Found via critique of the first
`abdulwahabai` "Introduction to Agentic AI" posters (2026-07-21) — do not regress them:

- **Logo never collides with the subject.** The logo is capped on BOTH height (`0.12` of
  the short edge) and width (`0.44` of full width, `fit:"inside"`) — sizing by height alone
  let a wide wordmark bleed across the canvas into a centered face/subject. A top-band
  scrim (`topScrimBuffer`, ~30% of height, darkest at the very top) always sits under the
  logo so it separates from a busy or light background, whatever the photo behind it.
- **Contact strip is corner-anchored, not centered.** Phone pins to the bottom-left corner,
  website to the bottom-right corner (`justify-content: space-between` when both are
  present) — never one centered "phone · website" run-on line. This is what the user
  explicitly asked to standardize; don't revert to a centered strip.
- **CTA shadow is tight, not a neon glow.** `boxShadow` on the CTA button is a low-spread,
  low-opacity lift (`0 6px 16px` at ~0.26 alpha) — not a wide, saturated bloom, which reads
  as a dated 2016-landing-page effect.
- **Square (1:1) vs vertical (4:5/9:16) use the same compositor** but a square canvas gives
  less headroom before text meets the subject's face — if a client's background photo is a
  centered portrait, prefer 4:5/9:16 for text-heavy copy (3 benefit bullets + CTA), or ask
  for a background crop with the subject off-center before using 1:1.
- **`composePoster({ ..., position })`** re-frames a `cover`-fit crop away from center (sharp's
  `position` values, e.g. `"left"`/`"right"`) — use it when a centered-portrait background
  would otherwise sit directly under the top-left logo; default (unset) is unchanged center
  framing for every other caller.

## What This Skill Does

- **Organic** (`image-gen.js`): fills missing `image_url` on `content_calendar.json` items
  (format `"image"`) produced by `/content-plan`.
- **Paid** (`image-gen-ads.js`): fills missing `image_url` on `ad_copy.json` angles produced
  by `/creative`, so `/launch`'s `readAssetRef()` (scripts/lib/launch_media.js) has a real
  creative instead of shipping a link-only ad. No changes to `/launch` are needed — it
  already reads the flat `angle.image_url` field this writes.
- Composites logo + contact/handle bar via `scripts/lib/poster_compose.js` (sharp), hosts
  the result on Supabase Storage (`scripts/lib/media_storage.js`) as the canonical `image_url`,
  ALSO saves a local copy under `clients/{slug}/generated/{id}.png` (`local_path` field) for
  fast review without a network round trip, and registers it in the client's DAM
  (`scripts/lib/dam.js`).
- Tags every generated image `ai_generated:true` / `ai_disclosed:true` / `brand_kit:{colors,logo_url}`
  so the ai-disclosure and brand-compliance guards (`scripts/lib/guards.js`) have what they
  need before `/publish` or `/launch` ship it.

## What This Skill Does NOT Do

- **Write ad copy or captions** — that's `/creative` (paid) and `/content-plan` (organic).
- **Generate carousel, reels, or video assets** — v1 is single-image only; both scripts
  report unsupported items/sizes as explicitly skipped, never silently dropped.
- **Publish or launch anything** — `/publish` and `/launch` consume the `image_url` this
  writes; this skill never touches the Meta API.
- **Design or approve the logo/brand kit** — that's `/brand-visual`; this skill only reads
  an already-approved kit and fails closed if one isn't set.
- **Use smOS's own "Cupertino" report design system** — that system is for smOS's internal
  HTML/PDF client deliverables only. Posters use the *client's* brand colors/logo.

## Before Implementation

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/poster_compose.js` (compositing), `scripts/lib/poster_pipeline.js` (shared generate→composite→host→DAM sequence), `scripts/lib/guards.js` `checkPosterInputs` (preflight) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `contact.{phone, website_display, social_handles}`, `business.product_description` |
| **Brand Profile** | `clients/{slug}/brand_profile.json` → `visual.logo.{primary_url,reverse_url}` (must be logo-approved), `visual.colors` |
| **Prior handoff (organic)** | `clients/{slug}/content_calendar.json` — items with `format:"image"` and no `image_url` |
| **Prior handoff (paid)** | `clients/{slug}/ad_copy.json` — angles with no `image_url`, `design_brief.visual_direction`/`sizes` |

## Clarifications

**Required (must resolve before running):**
1. Which client `{slug}`?
2. Organic, paid, or both?

**Before running, verify (the script fails closed if not):**
3. `brand_profile.json` has an approved logo (`visual.logo_approved_at` set) — if not, run `/brand-visual` first.
4. `client_profile.contact` has at least one of `phone` / `website_display` / `social_handles.{instagram,facebook,tiktok}` set — if not, ask the user for at least one and add it before generating.

## Workflow

1. Confirm the brand kit is approved and contact info is set (see Clarifications above) — the script's preflight will name exactly what's missing if not.
2. Organic: `node skills/image-gen/image-gen.js {slug} [--dry-run]` — review the dry-run prompts, then rerun live.
3. Paid: `node skills/image-gen/image-gen-ads.js {slug} [--dry-run]` — same pattern, targets `ad_copy.json` angles.
4. Report generated `image_url`s, any errors, and any skipped items/sizes back to the user. Point organic output to `/publish`, paid output to `/launch`.
