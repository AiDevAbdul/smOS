---
name: audience-map
description: Use this skill to build a Meta audience targeting plan (audience_map.json) for a client — interest clusters, behavior segments, retargeting layers, lookalike strategy, and exclusions. This skill should be used when the user asks to build an audience map, targeting plan, or audience architecture for a client, typically via `/audience-map {slug}`. It resolves live interests from the Graph API, picks a lookalike seed from existing custom audiences, and emits the canonical handoff JSON that feeds `/strategy-brief` and `/launch`.
---

# /audience-map — Audience Targeting Architecture (Phase 3)

Build the audience targeting plan for a client from their profile plus live Meta signals. Output a single canonical `audience_map.json` (interest clusters, behavior segments, retargeting layers, lookalike strategy, exclusions) that `/strategy-brief` and `/launch` consume to construct ad-set targeting.

## What This Skill Does

- Derive 15–25 seed interest terms from the client profile (product description, USP, pain points, explicit interests).
- Resolve seeds to real Meta interests via Graph `/search?type=adinterest` (parallel), then size-filter and dedup.
- Cluster resolved interests by Meta taxonomy path into up to 5 themed clusters.
- Pick 2–4 behavior segments by `business.business_model`.
- Build a 4–5 layer retargeting plan (pixel 30/90/180d, page+IG 365d, optional ATC-non-purchaser).
- Pull existing custom audiences and pick the strongest lookalike seed (purchaser-priority), recommend 1%/3%/5% sizes.
- Build default exclusions, normalize to the canonical schema, run a soft schema check, and write `clients/{slug}/audience_map.json`.

## What This Skill Does NOT Do

- Does NOT create or upload custom/lookalike audiences on Meta — it only recommends. Audience creation happens at `/launch`.
- Does NOT build the campaign/adset/ad tree or write targeting specs to Meta — that is `/launch`.
- Does NOT synthesize the strategy or rank audiences against budget — that is `/strategy-brief`.
- Does NOT write ad copy or creative — that is `/creative`.
- Does NOT pull or store performance metrics — that is `/analyze` / `/audit`.
- Does NOT write a Supabase row. Persistence is the JSON file only; the orchestrating agent records reports.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`), `scripts/lib/load-env.js`, `schemas/audience_map.js` (`normalize`/`validate`) |
| **Conversation** | Target `{slug}`; whether the run should be `--offline`; any interests the user explicitly named |
| **Skill References** | Seed/cluster/lookalike rules in `references/domain-standards.md`; endpoint/field details in `references/api-reference.md`; schema in `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` — reads `business.product_description/usp/business_model/conversion_event`, `audience.*`, `accounts.*`, `voice.restricted_words`, `location.*` |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for thresholds, taxonomies, or sizing rules.

**Required (must resolve before running):**
1. Which client `{slug}` (must have `clients/{slug}/client_profile.json`).

**Optional (ask only if relevant):**
2. Run live or `--offline`? (Offline skips all Graph calls and emits structure only — default is live when `accounts.ad_account_id` is a real, non-TBD ID.)
3. Any seed interests the user wants forced in (added to `audience.interests` in the profile).

## Workflow

1. Resolve `{slug}`; halt if `clients/{slug}/client_profile.json` is missing.
2. Run: `node skills/audience-map/audience-map.js <slug> [--offline]`.
3. The script auto-selects mode: live if `accounts.ad_account_id` is real, else offline. Interest resolution and custom-audience pull only run live.
4. Read the printed JSON summary and inspect `diagnostics.issues` — surface any (sub-3-cluster, TBD account, schema gaps) to the user.
5. Confirm `clients/{slug}/audience_map.json` exists and passes the canonical schema before handing off to `/strategy-brief`.

## Input / Output Specification

**Inputs:** arg `<slug>` (required), flag `--offline` (optional); reads `clients/{slug}/client_profile.json`; env `META_ACCESS_TOKEN` (live only, resolved by `load-env.js`).
**Outputs:** `clients/{slug}/audience_map.json` (canonical shape via `audienceMap.normalize`); stdout one-object JSON summary (mode, counts, lookalike seed/health, issues, output path).
**Exit codes:** `0` success · `1` no slug / fatal error · `2` profile not found.
(Full schemas and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Seed terms, interests, cluster labels, geo, age/gender | Size filters 100k–50M, 25-seed cap, ≤5 clusters, 8 interests/cluster |
| Behavior segments (by business model) | Behavior-by-model mapping; default `Engaged Shoppers` fallback |
| Lookalike seed name/size/health, custom-audience inventory | Purchaser→buyer→customer→ATC→video→engagement priority order; 1/3/5% sizes |
| Retargeting source IDs, ATC layer presence | 4-base-layer structure; `RT_<source>_<window>` naming; ATC only if purchase-like conversion |
| Live vs offline mode | Graph endpoint, API version, normalize/validate contract, fail-closed guards |

## Domain Standards

### Must Follow
- [ ] Keep only interests with `audience_size_lower ≥ 100k` and `audience_size_upper ≤ 50M`.
- [ ] Name retargeting layers `RT_<SOURCE>_<WINDOW>` (e.g. `RT_PIX_30D`); cluster IDs `INT_<LABEL>`.
- [ ] Prefer a purchaser-tagged custom audience as the lookalike seed; only fall back when none exists.
- [ ] Add the ATC-non-purchaser retargeting layer only when `conversion_event` is purchase-like.
- [ ] Normalize through `audienceMap.normalize` before writing; record schema gaps in `diagnostics.issues`.

### Must Avoid
- Inventing interest IDs/sizes — every interest must come from a live `/search` result.
- Faking custom audiences or marking a `missing`/`degraded` seed as `healthy`.
- Hard-failing an offline run on schema gaps — surface in diagnostics; the `/launch` gate enforces hard.
- Asking the user for thresholds/taxonomies/sizing — these are embedded in `references/`.

### Output Checklist (verify before delivery)
- [ ] `audience_map.json` written and parses; `clusters[].id` and `clusters[].interest_stack` populated.
- [ ] `geo.primary` is a non-empty string (schema requirement).
- [ ] `lookalike_strategy.health` is one of healthy/degraded/missing/skipped_offline and matches reality.
- [ ] `diagnostics.issues` reviewed and any blockers surfaced to the user.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` arg | Print usage, exit 1 — never guess a client |
| `client_profile.json` not found | Print path, exit 2 — halt, do not fabricate a profile |
| No seed terms derivable | Throw fatal (exit 1) — profile lacks product/audience text |
| `accounts.ad_account_id` is TBD | Auto-run offline; add a `diagnostics.issues` note to rerun once real ID is set |
| `/search` returns nothing for a seed | Drop the seed silently; only flag if `<3` clusters assemble |
| `<3` clusters assembled (live) | Add issue: broaden product description or add explicit interests; do not halt |
| Custom-audience pull fails / empty | Set lookalike `health: missing` + `fallback_note`; continue |
| Meta API error | `meta-graph.js` logs `code/type/fbtrace_id`, retries transient codes (4/17/613/5xx) with backoff, surfaces non-retryable; token code 190 → `TokenExpiredError` (no retry) |
| Schema validation fails | Append `schema:` notes to `diagnostics.issues` (soft); hard gate is `/launch` |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `scripts/lib/load-env.js`, `schemas/audience_map.js`, `schemas/index.js`.
- **External APIs:** Meta Graph API **v25.0** — `/search?type=adinterest` and `/act_<id>/customaudiences` (read-only). Rate limits + fields in `references/api-reference.md`.
- **Runtime:** Node ≥18 (ESM), `axios` (via meta-graph), `dotenv` (via load-env).
- **Secrets:** `META_ACCESS_TOKEN` (and optional `META_APP_SECRET` for appsecret_proof) resolved from `~/.config/smos/.env` or `SMOS_ENV_FILE` — never hardcoded or logged. No writes to Meta; read-only calls only.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API root | https://developers.facebook.com/docs/graph-api/ | Nodes/edges/fields; how `/search` is shaped |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current (released 2026-02-18) |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Targeting concepts, custom/lookalike audiences |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits; codes 4 / 17 / 613 |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Seed-extraction rules, size thresholds, cluster taxonomy, behavior-by-model map, lookalike seed priority, retargeting/exclusion conventions, good/bad examples |
| `references/api-reference.md` | Exact Graph endpoints, query params, returned fields, v25.0 version pin, rate-limit codes, offline-mode behavior |
| `references/io-contract.md` | Full input profile fields read, raw + normalized `audience_map.json` schema, example payloads, edge-case handling |
