---
name: assets
description: Use this skill to manage a client's creative asset library (the DAM behind /creative and /launch) — registering, version-bumping, content-deduping, tagging, attaching measured performance, and ranking reusable images/videos/carousels by hook-rate, 3s-retention, CTR, or ROAS. This skill should be used when the user runs `/assets {slug}` with a register/metrics/top subcommand, asks to catalog or version a creative asset, attach measured performance to an asset, or find the client's top-performing reusable creatives so winners can be reused instead of re-created.
---

# /assets — Digital Asset Manager (Phase 3.4)

A versioned, tagged, content-addressed library of creative assets with measured performance, so winning hooks and retention can be found and reused instead of re-created each launch. The `asset_id` is the stable join key into ads and `daily_metrics`, making every creative's performance attributable. Backed by `scripts/lib/dam.js` + `schemas/asset.js`.

## What This Skill Does

- Register an asset, normalizing drifted field names to one canonical shape (`schemas/asset.js`).
- Dedupe by content `hash` (sha256): re-registering identical bytes returns the existing asset unchanged.
- Version-bump: re-registering the same `asset_id` with a different `hash` creates `<id>_v<n>` and sets `parent_asset_id`.
- Attach measured performance (`impressions`, `hook_rate`, `retention_3s`, `ctr`, `roas`) to an existing asset.
- Rank assets by any metric (default `hook_rate`), winners first, nulls excluded.
- Enforce the AI-disclosure gate at the source: an `ai_generated` asset must carry `ai_disclosed:true` or registration fails.

## What This Skill Does NOT Do

- Does NOT generate creative copy or design briefs — `/creative` owns that.
- Does NOT build campaign/adset/ad structures or pick which asset runs in an ad — `/launch` owns that.
- Does NOT pull metrics from Meta. Performance numbers are supplied to `metrics` by the caller (e.g. `/analyze` after a `daily_metrics` rollup); this skill only stores them.
- Does NOT persist to Supabase. Storage is the local per-client JSON index only (the lib has no DB writer).
- Does NOT upload bytes. The `uri` must already point at hosted bytes (CDN/Drive); this skill stores metadata, not files.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/dam.js` (register/recordMetrics/topPerformers), `schemas/asset.js` (shape + validate), `scripts/lib/load-env.js` |
| **Conversation** | Which subcommand, the asset JSON / metrics JSON, the rank metric |
| **Skill References** | Metric definitions + taxonomy in `references/domain-standards.md`; full schema in `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` (must exist or the CLI halts), `clients/{slug}/assets.json` (the index, created on first register) |

## Clarifications

> Before asking: check the conversation, the client profile, and the existing `assets.json`.
> Only ask for what cannot be determined. Metric definitions and taxonomy live in
> `references/` — never ask the user for them.

**Required (must resolve before running):**
1. The client `{slug}` (the first CLI argument).
2. The subcommand: `register`, `metrics`, or `top`.
3. For `register`: the asset JSON (must include `asset_id`, `media_type`, `uri`).
4. For `metrics`: the target `asset_id` plus the metrics JSON.

**Optional (ask only if relevant):**
5. For `top`: the rank metric via `--by=<metric>` (default `hook_rate`).
6. Whether a re-register is intended as a new version (different `hash`) or a true dedupe (same `hash`).

## Workflow

1. Confirm `clients/{slug}/client_profile.json` exists (the CLI halts with exit 3 otherwise).
2. **register:** `node skills/assets/assets.js <slug> register '<asset json>'` — normalize, validate, dedupe by hash, version-bump on `asset_id` collision, append to `assets.json`.
3. **metrics:** `node skills/assets/assets.js <slug> metrics <asset_id> '<metrics json>'` — merge measured performance onto the named asset.
4. **top:** `node skills/assets/assets.js <slug> top [--by=<metric>]` — print the ranked winners with their metric value.
5. Read back `clients/{slug}/assets.json` for the canonical state; surface the asset_id/version that changed.

## Input / Output Specification

**Inputs:** CLI args `<slug> <register|metrics|top> [...]`; asset/metrics JSON strings; `clients/{slug}/client_profile.json` (gate); `clients/{slug}/assets.json` (read/write).
**Outputs:** `clients/{slug}/assets.json` — `{ client_slug, assets: [asset…] }` per `schemas/asset.js`; stdout summary line.
(Full schemas, field aliases, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| The assets, their `uri`, tags, `angle_id`, measured metric values | Canonical asset shape + field aliases (`schemas/asset.js`) |
| Which metric to rank by (`--by`) | `MEDIA_TYPES` = image/video/carousel; default rank metric `hook_rate` |
| Whether an asset is AI-generated | AI-disclosure gate (ai_generated ⇒ ai_disclosed) is always enforced |
| Index location per `{slug}` | Dedupe-by-hash + version-bump-by-asset_id semantics |

## Domain Standards

### Must Follow
- [ ] Provide `asset_id`, a valid `media_type` (image/video/carousel), and a non-empty `uri` on register.
- [ ] Set `ai_disclosed:true` on any `ai_generated:true` asset (registration fails otherwise).
- [ ] Pass the content `hash` (sha256) when known, so identical bytes dedupe instead of duplicating.
- [ ] Treat `asset_id` as the join key into ads + `daily_metrics` — keep it stable across versions of the same creative.

### Must Avoid
- Inventing metric values — only attach numbers measured downstream.
- Reusing one `asset_id` for two genuinely different creatives (that triggers a version-bump, not a new asset).
- Pointing `uri` at local/unhosted bytes.

### Output Checklist (verify before delivery)
- [ ] `assets.json` parses and conforms to `schemas/asset.js`.
- [ ] The intended outcome happened: dedupe returned the existing asset, or a new `_v<n>` was created with `parent_asset_id`.
- [ ] AI assets carry `ai_disclosed:true`.
- [ ] `top` ranking matches the requested `--by` metric, nulls excluded.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `slug` or subcommand | CLI prints usage, exits 2 — halt, do not guess |
| `clients/{slug}/client_profile.json` not found | CLI prints `HALT: client {slug} not found.`, exits 3 — run `/intake` first |
| Asset fails schema validation (missing `asset_id`/`uri`, bad `media_type`) | `register` throws, exits 1 with the named field(s) — fix the input |
| `ai_generated` without `ai_disclosed` | Validation rejects (Phase 3.2 disclosure) — set `ai_disclosed:true` |
| `metrics` for an unknown `asset_id` | Throws `recordMetrics: no asset <id>`, exits 1 — register it first |
| Malformed JSON in asset/metrics arg | `JSON.parse` throws, exits 1 — fix the JSON |
| Unknown subcommand | Prints `unknown subcommand`, exits 2 |

## Dependencies & Security

- **Reuses:** `scripts/lib/dam.js`, `schemas/asset.js` (+ `schemas/_shared.js`), `scripts/lib/load-env.js`.
- **Runtime:** Node.js with ES modules; standard lib only (`node:fs`, `node:crypto`). No external API calls.
- **Secrets:** none required for this skill; `loadEnv({silent:true})` is called but no token is used. Never hardcode or log secrets.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Meta AI Disclosures policy | https://transparency.meta.com/policies/other-policies/meta-AI-disclosures | The disclosure rule the `ai_generated ⇒ ai_disclosed` gate enforces |
| Labeling AI-Generated Content (announcement) | https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/ | Effective dates / label-vs-remove rationale |
| Media Insights (IG) | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | Source of `views`/retention metrics that feed `metrics` |
| Meta Ads Guide (creative specs) | https://www.facebook.com/business/ads-guide | Placement-by-placement specs for the assets being cataloged |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Metric definitions/formulas (hook_rate, retention_3s), media-type taxonomy, ranking rules, good/bad register examples |
| `references/dam-mechanics.md` | How dedupe-by-hash and version-bump-by-asset_id work; the join into ads + daily_metrics; storage model (no Supabase) |
| `references/io-contract.md` | Full asset JSON schema, field aliases, example register/metrics/top payloads, edge cases |
