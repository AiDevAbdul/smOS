# brand-social — I/O Contract

Full input/output schemas, example payloads, exit codes, and edge cases for
`node skills/brand-social/brand-social.js {slug} --in social.json`.

## 1. Invocation

```
node skills/brand-social/brand-social.js <slug> --in social.json
```

- `<slug>` (positional, required) — client slug; resolves `clients/<slug>/brand_profile.json`.
- `--in <path>` (required) — path to the `social.json` payload below.

## 2. Reads

| File | Purpose |
|------|---------|
| `clients/{slug}/brand_profile.json` | Existing profile; must have `visual.logo_approved_at` set |
| `<--in path>` | The `social` layer payload |

(`client_profile.json` is consulted by the operator when authoring bios; the script itself
only reads `brand_profile.json` and the `--in` file.)

## 3. `social.json` schema

Matches `schemas/brand_profile.js → normalizeSocial`. Schema-required for `status: complete`:
`profile_picture_url` and `bios.instagram` (enforced by `validate`).

```jsonc
{
  "profile_picture_url": "clients/greenleaf/brand/social/profile_320.png",  // required
  "fb_cover_url":        "clients/greenleaf/brand/social/fb_cover_851x315.png",
  "ig_highlight_covers": [                       // matching set, icons in center 720×720
    { "label": "About",   "url": "clients/greenleaf/brand/social/hl_about.png" },
    { "label": "Shop",    "url": "clients/greenleaf/brand/social/hl_shop.png" },
    { "label": "Reviews", "url": "clients/greenleaf/brand/social/hl_reviews.png" }
  ],
  "templates": [                                 // quote|tip|promo|testimonial|story-CTA
    { "name": "quote",       "url": "clients/greenleaf/brand/social/tpl_quote.png" },
    { "name": "story-CTA",   "url": "clients/greenleaf/brand/social/tpl_story_cta.png" }
  ],
  "link_in_bio": {
    "destinations": [
      { "label": "Shop bestsellers", "url": "https://greenleaf.com/shop" },
      { "label": "Newsletter",       "url": "https://greenleaf.com/news" }
    ]
  },
  "bios": {
    "instagram": "Plant-based skincare 🌿 Dermatologist-tested · cruelty-free\n👇 Shop the bestsellers",  // required
    "facebook":  "Tired of skincare that irritates? GreenLeaf is plant-based, dermatologist-tested, cruelty-free. Shop the line →"
  },
  "branded_hashtag": "#GreenLeafGlow"
}
```

Unlisted fields are dropped by `normalizeSocial`. `ig_highlight_covers`, `templates`,
`link_in_bio.destinations` accept arbitrary item shapes (stored as-is via `asArray`).

## 4. Outputs

### File
`clients/{slug}/brand_profile.json` — the `social` layer deep-merged into the existing
profile (prior layers preserved). When the **whole** artifact validates at stage `complete`,
`status` is set to `complete` and re-written.

### stdout (JSON)
```jsonc
{
  "slug": "greenleaf",
  "layer": "social",
  "status": "complete",          // or the prior status if not yet complete
  "profile_picture": "clients/greenleaf/brand/social/profile_320.png",
  "ig_bio": "Plant-based skincare 🌿 ...",
  "complete": true,
  "next": "Brand is fully built. Run /setup-accounts to create the real Page/IG/ad account and upload these assets."
}
```
When `complete: false`, `next` lists the missing fields, e.g.
`"Still missing: visual.logo.primary_url is missing; verbal.name is missing"`.

## 5. Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (profile written; may or may not be `complete`) |
| 1 | Usage error — missing `<slug>` or missing `--in` flag |
| 2 | `--in` file not found |
| 3 | `visual.logo_approved_at` not set (logo gate not cleared) |
| (throws) | `saveBrand` validation failure at stage `social` — fail-closed, lists every missing field, no partial write |

## 6. Edge cases

- **Re-run / idempotency:** safe to re-run; `saveBrand` deep-merges, so re-supplying `social`
  overwrites only the `social` layer and leaves strategy/verbal/visual/guidelines intact.
- **Partial social payload:** if `profile_picture_url` or `bios.instagram` is absent, the
  stage-`social` validation in `saveBrand` throws before writing — fix the payload, do not
  partial-persist.
- **Logo gate stamped after a failed run:** the gate is a human action (`/brand-visual
  --approve-logo`); this skill never stamps it. Re-run after the operator stamps it.
- **Already complete:** re-running with a valid payload keeps `status: complete`.
- **AI-generated asset:** ensure `visual.ai_generated` is `true` upstream; this skill does not
  set it.
