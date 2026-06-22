# /creative — CLI & Interface Reference

`creative.js` has **no external API at runtime** — all scoring and checks are local and
deterministic. The "interface" is its two-mode CLI plus the Meta-sourced enums it encodes.
This file is the exact command contract. (Meta doc URLs that *source* the enums are at the end.)

## Invocation

```
node skills/creative/creative.js <slug> <skeleton|lint> [--draft PATH]
```

| Arg | Required | Meaning |
|-----|----------|---------|
| `<slug>` | yes | Client directory under `clients/` |
| `<mode>` | yes | `skeleton` or `lint` (any other value throws) |
| `--draft PATH` | no (lint only) | Override the default `clients/<slug>/ad_copy_draft.json` |

Both modes first load `clients/<slug>/client_profile.json`.

## Mode: `skeleton`

- Loads `strategy_brief.json`, reads `creative_angles` (or `angles`).
- Writes `clients/<slug>/ad_copy_draft.json` with one entry per angle, each carrying
  `angle_id`, `name`, `hook_archetype`, `format`, `direction`, and **5 empty hook stubs**
  (each with empty `primary_text[3]`, `headlines[3]`, `ctas[3]`).
- **Refuses to overwrite** an existing draft → exits `2`.
- Prints `{ slug, mode, draft_path, angles, next }` JSON.

```
node skills/creative/creative.js acme skeleton
```

## Mode: `lint`

- Loads `strategy_brief.json`; if `approval.status`/`status` is present and ≠ `approved`,
  prints a stderr **WARN** and continues (does not halt; `/launch` must still be blocked).
- Loads the draft (default path or `--draft`); throws if missing → exit `1`.
- Per variant: `checkLength`, `checkCompliance` (restricted words + `voice.avoid`),
  `scoreVariant`; per CTA: enum validity. Picks `best_combo` per hook, one `top_pick` per angle.
- Builds the output, runs `assertValid("ad_copy", normalize(out), validate)` — **throws and
  writes nothing** if the shape is invalid.
- Writes `clients/<slug>/ad_copy.json`; prints a JSON summary with `top_picks`,
  `total_variants`, `non_compliant`, `over_limit`, and `issues_first_5`.

```
node skills/creative/creative.js acme lint
node skills/creative/creative.js acme lint --draft /tmp/filled.json
```

## Exit codes

| Code | Cause |
|------|-------|
| `0` | Success |
| `1` | Bad usage, missing profile/brief/draft, unknown mode, or schema-validation throw |
| `2` | `skeleton`: draft already exists (refuses to overwrite) |

## Stdout shape

Both modes emit a single pretty-printed JSON object to stdout (parse-friendly). `lint`'s
`top_picks` array gives `{ angle, hook, overall }` per angle. `issues_first_5` is a preview
of `summary.issues` (full list lives inside `ad_copy.json`).

## Meta sources behind the encoded enums

The CTA set and creative sizes are Meta-defined; the script hardcodes them for offline
determinism. Verify on the cadence in SKILL.md:

| Resource | URL | Sources | What to extract on fetch |
|----------|-----|---------|--------------------------|
| Meta Ads Guide | https://www.facebook.com/business/ads-guide | CTA enum values, placement sizes (1080×1080, 1080×1920, 1200×628) | Open a placement → **Call to action** dropdown: read the live button list, diff against `VALID_CTAS` (31). Read recommended-resolution rows → confirm the three sizes and ~125-char primary truncation. |
| Ad node (Marketing API) | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ | How `creative` (copy + CTA) attaches to an ad in `/launch` | Read the `creative` field → confirm primary/headline/CTA still map onto `object_story_spec`. |
| Outcome objectives (ODAX) | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | Funnel-stage → CTA alignment | Read the six `OUTCOME_*` enums → map each to a CTA tier. |

If any fetched value differs from what `creative.js` encodes, change the code first
(`VALID_CTAS` / `LIMITS`), then mirror docs, then bump the canonical date.

**Verification date:** see the single canonical **Last verified** line in `../SKILL.md`
(Documentation & References). This file does not carry its own date.
