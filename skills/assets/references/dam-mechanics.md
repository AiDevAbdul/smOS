# /assets — DAM Mechanics

How the Digital Asset Manager stores, dedupes, versions, and attributes assets. This skill has **no external API**, so this file documents the internal contract instead. Read it when you need to predict what `register` will do on a collision, or how performance attribution joins back to ads. Self-contained.

## Storage model

- One JSON index per client: `clients/{slug}/assets.json`, shape `{ client_slug, assets: [...] }`.
- Created lazily on first `register`; `loadIndex` returns an empty index `{ client_slug, assets: [] }` if the file is absent or unparseable (never throws).
- Bytes are NOT stored here — `uri` points at hosted bytes (CDN/Drive). The DAM stores metadata + measured performance only.
- **No Supabase mirror.** `scripts/lib/dam.js` writes the local file only; there is no DB writer in the lib. Do not claim Supabase persistence.

## Content-addressed dedupe (`hash`)

`hash` is an sha256 hex digest of the asset's bytes (or a stable descriptor). `dam.js` exposes `hashBytes(bufOrString)` to compute it.

On `register`:
- If an existing asset shares the same `hash`, the existing asset is returned **unchanged** — true dedupe, no new row, no version bump.
- If no `hash` is supplied, dedupe is skipped (identical bytes can then duplicate — always pass a hash when known).

## Version-bump (`asset_id` collision)

If the incoming `asset_id` already exists in the index **and** the hash did not dedupe:
- `version` becomes `max(existing versions) + 1`.
- `parent_asset_id` is set to the prior asset's id (lineage).
- `asset_id` is rewritten to `<asset_id>_v<version>` and appended.

So the same logical creative re-registered with edited bytes produces `myid`, `myid_v2`, `myid_v3`… each linked by `parent_asset_id`. The original keeps its id; only later versions get the `_v<n>` suffix.

## Validation gate (fail-closed)

`schema.validate` runs inside `register` before any write. It rejects when:
- `asset_id` is missing/empty,
- `media_type` ∉ {image, video, carousel},
- `uri` is missing/empty,
- `ai_generated === true` but `ai_disclosed !== true` (Phase 3.2 AI-disclosure, enforced at the source so off-policy creatives never enter the library).

On failure `register` throws and the CLI exits 1 with the named field(s).

## Attaching performance (`recordMetrics`)

`metrics <asset_id> '<json>'` merges the supplied keys onto the asset's existing `metrics` object (`{ ...a.metrics, ...metrics }`) — partial updates are fine; unspecified keys are preserved. Unknown `asset_id` throws `recordMetrics: no asset <id>`.

## Attribution join

`asset_id` is the stable join key into:
- the `ads` table (which ad ran which asset), and
- `daily_metrics` (per-day performance).

This is why `asset_id` must stay stable across versions of the same creative: it lets `/analyze` roll up daily performance per asset and feed `hook_rate`/`retention_3s`/`ctr`/`roas` back via `metrics`, so `top` surfaces re-usable winners for `/creative` and `/launch`.

## Sequence (typical lifecycle)

1. `/creative` or `/launch` produces a creative ⇒ `register` it (with `hash`).
2. `/launch` attaches the `asset_id` to the ad it builds.
3. After spend, `/analyze` rolls up `daily_metrics` ⇒ `metrics <asset_id> {...}`.
4. Next planning cycle, `top --by=hook_rate` surfaces winners to reuse.

## Keeping current

If `scripts/lib/dam.js` gains a Supabase writer, update the "No Supabase mirror" note here and in `SKILL.md`. If validation rules in `schemas/asset.js` change, mirror them in the "Validation gate" list.
