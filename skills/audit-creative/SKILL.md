---
name: audit-creative
description: Use this skill when the user asks to review or score a client's creative quality (typically via `/audit-creative {slug}` or as a follow-on to `/audit`). It collects the last 90 days of organic posts and ad creatives, scores each with Claude vision across visual quality, brand consistency, CTA presence, text density, and messaging clarity, then aggregates per-format averages, top/bottom performers, and brand-voice violations into the client's `audit_report.md`.
---

# /audit-creative — Creative Quality Audit (Phase 1 · Audit)

Score a client's existing creative output so the agency knows what to replicate and what
to replace before building new campaigns. The companion script gathers assets and computes
aggregates deterministically; Claude supplies the vision scores in the middle. Produces a
creative-health section appended to the immutable `/audit` baseline.

## What This Skill Does

- Collects the last 90 days of organic Page posts (`/{page_id}/posts`) and ad creatives (`/act_<id>/adcreatives`) via the guarded Graph client, classifies each as image/video/carousel, and excludes status-only posts.
- Pre-checks each asset's copy against the client's restricted words (`voice.restricted_words` + `voice.avoid`).
- Emits `creative_assets.json` with batched (6-per-batch) vision prompts and blank `vision_scores` for Claude to fill.
- After Claude fills scores, aggregates per-format averages, an overall 0–10 health score, top-3 / bottom-3 weighted performers, and brand-voice violations.
- Writes `creative_audit_summary.json` and patches the `{{CREATIVE_AUDIT_SECTION}}` slot in `audit_report.md`.

## What This Skill Does NOT Do

- Does **not** fetch performance metrics (spend/CTR/ROAS) — that is `/analyze` and `/audit`.
- Does **not** write new ad copy or creative — that is `/creative`.
- Does **not** produce the full account baseline or the immutable snapshot — that is `/audit`; this skill only appends a section to its report.
- Does **not** compute before/after deltas — that is `/before-after`.
- Does **not** enforce AI-disclosure or brand-kit gates on new creatives — that is the `ai-disclosure` / `brand-compliance` guards at launch time.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`), `scripts/lib/load-env.js`, sibling `skills/audit/` for report-slot convention |
| **Conversation** | Whether `/audit` already ran (the report + `{{CREATIVE_AUDIT_SECTION}}` slot exist) |
| **Skill References** | Scoring rubric, thresholds, weighting formula in `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` — `accounts.page_id`/`ad_account_id`, `assets.brand_colors`, `voice.restricted_words`, `voice.avoid` |

**Zero-shot defaults — run even when profile fields are absent (do not ask the user):**

- **Missing `accounts.page_id` (or it is TBD):** the organic source returns `[]`. Score only ad
  creatives; note "no Page connected — organic skipped" in the section. Same for a missing
  `ad_account_id` (ads skipped). If BOTH are absent, emit the stub "no creatives to audit yet"
  section and recommend `/setup-accounts` / posting content first. Never invent an id.
- **Missing `voice.restricted_words` AND `voice.avoid`:** the script treats the restricted list as
  empty (`restricted = []`), every asset's `restricted_word_hits` is `[]`, and the report's
  brand-voice line renders **"none"**. This is the correct zero-shot behavior — a client with no
  declared avoid-words simply has zero violations; do NOT prompt the user to supply words. (Identical
  tolerance to the missing-`page_id` path: absence degrades gracefully, never halts.)
- **Missing `assets.brand_colors` (and `voice.brand_colors`):** `brand_consistency` is still scored,
  but the vision prompt injects "not specified" for colors — judge consistency on internal coherence
  (consistent palette/typography across the set) rather than against a named brand palette.

## Clarifications

> Before asking: check the conversation, the client profile, and whether `audit_report.md`
> already exists. Only ask for what cannot be determined. Domain knowledge (rubric,
> thresholds, formulas) is embedded in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}`? (must match a directory under `clients/`)

**Optional (ask only if relevant):**
2. Should video assets be scored on thumbnail only? (default: yes — thumbnail scored with `format=video`)
3. Score only the current creative set, or re-collect first after a recent content push? (default: score the current set — this is a once-per-baseline audit)
4. Does this client have more than 50 organic posts in the last 90 days that must all be sampled? (default: no — the script caps at 50 most-recent; see Variability Analysis extension path)

## Workflow

1. Run `node skills/audit-creative/audit-creative.js {slug} collect`. It reads the profile, fetches organic + ad creatives in parallel via the guarded Graph client, filters, and writes `clients/{slug}/creative_assets.json`.
2. Read `creative_assets.json`. For each `batches[]` entry, send Claude vision the `vision_prompt` plus that batch's image URLs as image content blocks (do not download — Meta CDN URLs are signed).
3. Merge each returned JSON array into the matching `assets[].vision_scores`, preserving order and `asset_id` alignment. Write the file back.
4. Run `node skills/audit-creative/audit-creative.js {slug} aggregate`. It computes per-format stats, overall score, top/bottom performers, violations, patches `audit_report.md`, and writes `creative_audit_summary.json`.
5. If `audit_report.md` lacks the slot, the script appends the section instead — confirm placement.

## Input / Output Specification

**Inputs:** `{slug} collect|aggregate` (CLI args); `clients/{slug}/client_profile.json`; env from `scripts/lib/load-env.js` (Meta token / app secret).
**Outputs:** `clients/{slug}/creative_assets.json` (collect), `clients/{slug}/creative_audit_summary.json` + patched `clients/{slug}/audit_report.md` (aggregate). Both modes print a JSON status object to stdout.
(Full schemas and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Brand colors, restricted words, voice avoid-list | Six scoring dimensions + their 1–10 / 0–100 / boolean ranges |
| `page_id`, `ad_account_id`, asset count | `BATCH_SIZE = 6`, `MAX_AGE_DAYS = 90`, `TEXT_DENSITY_BEST = 20`, fetch `limit = 50` per edge |
| Which formats exist (image/video/carousel) | Weighted-score formula and overall-health aggregation |
| Number/content of vision batches (scales with asset count) | Output file names, report slot `{{CREATIVE_AUDIT_SECTION}}` |

**Extension paths — when a run exceeds the encoded constants:**

- **More than 50 organic posts in 90 days (or >50 ad creatives):** the script fetches a single
  page with `limit=50` per edge — an intentional most-recent sampling decision, *not* a hard
  ceiling. A high-volume client that needs the full window must switch the fetch from
  `graph.get(...)` to the client's `graph.paginate(path, params, max)` helper (already exported
  from `scripts/lib/meta-graph.js`, cursor-following). This is a one-line `.js` change documented
  in `references/api-reference.md` §1; everything downstream (batching, scoring, aggregation) is
  asset-count-agnostic and absorbs the larger set unchanged.
- **Add / remove a scoring dimension at runtime:** the six dimensions are fixed in code, not
  user-configurable per run. To change them, edit `buildVisionPrompt` + the aggregate formulas in
  `audit-creative.js` and the rubric in `references/domain-standards.md` together (see that file's
  "Keeping current"). Do not improvise extra fields in the vision response — `aggregate` only reads
  the six it knows.

## Domain Standards

### Must Follow
- [ ] Run `collect` before `aggregate` — `aggregate` halts if `creative_assets.json` is absent.
- [ ] Batch vision calls at 6 images (the script's `BATCH_SIZE`); larger batches degrade per-image attention.
- [ ] Return one vision object per image, in input order, aligned to `asset_id`.
- [ ] Pass image URLs as content blocks — never re-download Meta CDN assets.
- [ ] Treat text density `< 20%` as the compliance threshold.

### Must Avoid
- Re-fetching creatives Claude already scored, or re-running collect after scores are filled (it blanks them).
- Inventing scores for unreachable images — leave `null`.
- Editing the `.js`, schemas, or `scripts/lib/*` from this skill.

### Output Checklist (verify before delivery)
- [ ] Every batch's `vision_scores` filled (or explicitly `null` for unreachable assets).
- [ ] `aggregate` ran and reported a non-null `overall_score`.
- [ ] `audit_report.md` shows the Creative Audit table (patched, not duplicated).
- [ ] `creative_audit_summary.json` written with `top3`, `bottom3`, `violations`.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `client_profile.json` | Script throws `Profile not found` and exits 1 — halt, do not guess the slug |
| `page_id`/`ad_account_id` missing or TBD (`isTbd`) | That source returns `[]`; skill notes the gap, scores what exists |
| Meta API error on fetch | Logged to stderr (`organic/ad fetch failed`), returns `[]`; do not auto-retry (client handles transient retries) |
| Token expired (code 190) | Graph client throws `TokenExpiredError` — surface, prompt re-auth, do not loop |
| Image URL 404s in vision | Score that asset `null`, note "unreachable"; continue the batch |
| Vision batch returns non-JSON | Retry once with "respond ONLY with valid JSON"; if still bad, skip the batch |
| `aggregate` before `collect` | Throws `Run collect first` — run collect |
| No scores filled at aggregate | Throws `No assets have vision_scores filled` — fill them first |
| Zero creatives found | Output a stub section: "no creatives to audit yet"; recommend posting content first |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (guarded `createGraph`, `isTbd`, `API_VERSION` v25.0, retry/backoff), `scripts/lib/load-env.js`.
- **External APIs:** Meta Graph API v25.0 — `/{page_id}/posts`, `/act_<id>/adcreatives` (read-only; rate limits + fields in `references/api-reference.md`).
- **Secrets:** Meta token + `META_APP_SECRET` resolved via env / `load-env.js` (`appsecret_proof` auto-attached) — never hardcoded or logged. The script reads only; no account mutation.

## Documentation & References

All URLs are Meta's **versioned, stable** documentation (pinned to Graph API v25.0, current since
2026-02-18). Meta keeps a doc page per API version, so a cited v25.0 reference does not silently
shift under us; re-verify per the cadence below.

| Resource | URL | Use For | Last verified |
|----------|-----|---------|---------------|
| Page `/feed` & posts edge | https://developers.facebook.com/docs/graph-api/reference/page/feed/ | Organic post fields (`message`, `full_picture`, `attachments`) | 2026-06-22 |
| Pages API — Posts | https://developers.facebook.com/docs/pages-api/posts/ | Page-token read scopes (`pages_read_engagement`) | 2026-06-22 |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | `adcreatives` edge + `object_story_spec` shape | 2026-06-22 |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/page limits; `X-App-Usage` header; codes 4/17/613 | 2026-06-22 |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code semantics; `fbtrace_id`; code 190 token expiry | 2026-06-22 |
| Meta Ads Guide (creative specs) | https://www.facebook.com/business/ads-guide | Text-density / dimension best practice underpinning thresholds | 2026-06-22 |

### Fetching an uncovered endpoint (worked example)

If a run needs a field or edge not in the table above — say a client asks to also score Instagram
feed media, which has no row here — do NOT guess the path or version. Fetch the official doc, then
apply this skill's existing conventions:

1. Find the canonical URL in `skills/references-shared.md` (here: §9 Instagram Platform →
   *Media Insights* / IG-User Media — `https://developers.facebook.com/docs/instagram-platform/`).
2. `WebFetch` that page and confirm the exact edge, fields, and any v25.0 enum changes (e.g. IG
   `impressions` → `views` for media created on/after 2024-07-02 — a known v25.0 gotcha).
3. Apply this skill's conventions unchanged: route through `scripts/lib/meta-graph.js` (never a raw
   `fetch` — that bypasses retry/backoff + `appsecret_proof`), select only the fields you map, keep
   `limit=50` single-page sampling, and feed results into the same `classifyFormat` →
   `BATCH_SIZE`-batched vision flow.
4. Add the new endpoint as a row in `references/api-reference.md` with its own verified date, then
   stamp a new "Last verified" date below. Doc the field map there — never inline it in `.js` only.

For any pattern not covered here, follow those four steps. `skills/references-shared.md` is the
canonical doc-URL map; cite from it so URLs stay consistent across skills.

**Last verified:** 2026-06-22 (Graph API v25.0; re-verify on each Meta version bump or quarterly).

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Scoring rubric, thresholds, weighting + overall-health formulas, good/bad creative examples |
| `references/api-reference.md` | Exact Graph endpoints/fields/version, read scopes, rate limits, error codes |
| `references/io-contract.md` | Full `creative_assets.json` / `creative_audit_summary.json` schemas, vision-array shape, example payloads, edge cases |
