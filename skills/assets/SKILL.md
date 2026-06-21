---
name: assets
description: Use this skill to manage the client's creative asset library (`/assets {slug}`) — register, version, tag, and rank reusable images/videos by hook-rate and 3s-retention. The DAM behind /creative and /launch.
---

# /assets — Digital Asset Manager (Phase 3.4)

A versioned, tagged, content-addressed library of creative assets with measured
performance, so winning hooks/retention can be found and reused instead of
re-created each launch. Backed by `scripts/lib/dam.js` + `schemas/asset.js`.

## Required Context

- `clients/{slug}/client_profile.json`
- `clients/{slug}/assets.json` — the per-client asset index (created on first register)

## Subcommands

- `register <json>` — add/version an asset (deduped by sha256 `hash`)
- `metrics <asset_id> <json>` — attach measured hook_rate/retention_3s/ctr/roas
- `top [--by hook_rate]` — rank winners

## Output (canonical contract)

- `clients/{slug}/assets.json` — array of `schemas/asset.js` objects
- Best-effort persist to Supabase `assets`

## Safety tie-in

- An `ai_generated` asset must carry `ai_disclosed:true` (validate rejects otherwise) —
  the same Phase 3.2 disclosure rule the launch guard enforces, applied at the source.
- `asset_id` is the join key into ads + `daily_metrics` so performance is attributable.
