# brand-visual — I/O Contract

Exact input/output contract for `skills/brand-visual/brand-visual.js`. Read this when
writing `visual.json` or interpreting output. The visual layer is one slice of
`clients/{slug}/brand_profile.json`; the canonical shape lives in
`schemas/brand_profile.js → normalizeVisual()` and is validated by `validate(obj, {stage:"visual"})`.

## CLI

```
node skills/brand-visual/brand-visual.js <slug> --in <visual.json>   # persist the visual layer
node skills/brand-visual/brand-visual.js <slug> --approve-logo       # stamp the human logo gate
```

- `<slug>` — positional arg 0, required.
- `--in <path>` — path to the visual-layer JSON. Supplies the INPUT FILE ONLY; it does not bypass the name gate.
- `--approve-logo` — human-only approval flag. Stamps `visual.logo_approved_at` and sets `status: visual_approved`.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (layer persisted or gate stamped) — JSON summary on stdout |
| 1 | Usage error: missing `<slug>`, or neither `--in` nor `--approve-logo` |
| 2 | `--in` path not found |
| 3 | Fail-closed gate: name not approved (`verbal.name_approved_at` unset), or `--approve-logo` with no `visual.logo.primary_url` |

Stage-validation failures inside `saveBrand` throw an Error (non-zero exit) listing every
missing field — not one of the curated codes above. Fix the input; never bypass.

## Input — `visual.json` schema

Matches `schemas/brand_profile.js → normalizeVisual`. Keys accept lenient aliases
(normalizer maps them); the canonical keys are shown. Required-for-stage-`visual` fields
are marked **R**.

```jsonc
{
  "moodboard_url": "string|null",
  "logo": {
    "primary_url":  "string",   // R  (alias: primary)
    "mark_url":     "string|null", // alias: mark, icon_url
    "wordmark_url": "string|null", // alias: wordmark
    "mono_url":     "string|null", // alias: monochrome_url
    "reverse_url":  "string|null", // alias: white_url
    "svg_url":      "string|null",
    "clear_space":  "string|null", // e.g. "0.5x cap height"
    "min_size":     "string|null"  // e.g. "24px digital / 12mm print"
  },
  "colors": {
    "primary":   "#RRGGBB",      // R
    "secondary": "#RRGGBB|null",
    "accent":    "#RRGGBB|null",
    "neutrals":  ["#RRGGBB", "..."]
  },
  "typography": {
    "heading": "string",          // R  (alias: heading_font)
    "body":    "string|null",     // alias: body_font
    "scale":   "string|null"      // e.g. "1.25 major-third"
  },
  "imagery_style": "string|null",
  "iconography":   "string|null",
  "ai_generated":  false          // set true for any GenAI visual
}
```

`logo_approved_at` is NOT supplied via `--in` — it is set only by `--approve-logo`.

### Example `visual.json`

```json
{
  "moodboard_url": "clients/acme/brand/moodboard-warm-minimal.png",
  "logo": {
    "primary_url": "clients/acme/brand/logo-primary.svg",
    "mark_url": "clients/acme/brand/logo-mark.svg",
    "wordmark_url": "clients/acme/brand/logo-wordmark.svg",
    "mono_url": "clients/acme/brand/logo-mono.svg",
    "reverse_url": "clients/acme/brand/logo-reverse.svg",
    "svg_url": "clients/acme/brand/logo-primary.svg",
    "clear_space": "0.5x cap height",
    "min_size": "24px digital / 12mm print"
  },
  "colors": {
    "primary": "#1B3A2F",
    "secondary": "#C9A227",
    "accent": "#E2553D",
    "neutrals": ["#FAF8F4", "#D8D4CC", "#6B6962", "#1A1A18"]
  },
  "typography": {
    "heading": "Fraunces",
    "body": "Inter",
    "scale": "1.25 major-third"
  },
  "imagery_style": "Warm natural light, candid human moments, muted greens",
  "iconography": "2px stroke, rounded caps, geometric",
  "ai_generated": false
}
```

## Output — stdout summaries

After `--in` (success):

```json
{
  "slug": "acme",
  "layer": "visual",
  "status": "named",
  "logo": "clients/acme/brand/logo-primary.svg",
  "primary_color": "#1B3A2F",
  "ai_generated": false,
  "next": "Present logo options to the client. On approval: --approve-logo"
}
```

After `--approve-logo` (success):

```json
{
  "slug": "acme",
  "gate": "logo",
  "approved_at": "2026-06-22T14:03:11.482Z",
  "status": "visual_approved",
  "next": "/brand-book then /brand-social"
}
```

## Persisted output

- File: `clients/{slug}/brand_profile.json` — the `visual` layer is **deep-merged** into the existing profile (prior layers preserved; `saveBrand` never clobbers).
- After `--in`: `status` reflects the prior value (e.g. `named`); the visual layer is filled but the logo gate is NOT yet stamped.
- After `--approve-logo`: `visual.logo_approved_at` = ISO timestamp; `status` = `visual_approved`.
- Asset files (logo/moodboard) live under `clients/{slug}/brand/` and are referenced by path/URL in the JSON — this skill records references, it does not embed binaries.

## `status` progression

```
draft → positioning_approved → named → visual_approved → complete
                                  ▲           ▲
                          (gate 2: name)  (gate 3: logo, set here)
```

## Edge cases

| Case | Behavior |
|------|----------|
| Name gate unset + `--in` present | Exit 3 before any write. `--in` does not bypass. |
| Re-running `--in` with new values | Deep-merge; provided keys overwrite, omitted keys retain prior values. |
| `--approve-logo` before any `--in` | Exit 3 (`primary_url` empty). |
| Re-running `--approve-logo` | Re-stamps `logo_approved_at` to now; idempotent for downstream gates. |
| Aliased keys (`primary`, `heading_font`, `icon_url`) | Normalized to canonical keys automatically. |
| Stage validation missing `colors.primary` / `typography.heading` / `logo.primary_url` | Throws, naming each missing field; nothing written. |
| `ai_generated` omitted | Coerced to `false` (must be strictly `=== true` to register). |
