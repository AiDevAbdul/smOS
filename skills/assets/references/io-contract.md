# /assets — I/O Contract

The exact input/output shapes for the DAM CLI. Read this when constructing a `register`/`metrics` payload or parsing `assets.json`. Mirrors `schemas/asset.js` exactly. Self-contained.

## CLI surface

```
node skills/assets/assets.js <slug> register '<asset json>'
node skills/assets/assets.js <slug> metrics <asset_id> '<metrics json>'
node skills/assets/assets.js <slug> top [--by=<metric>]
```

Exit codes: `0` success · `1` runtime/validation error (message on stderr) · `2` bad usage / unknown subcommand · `3` client not found.

stdout summaries:
- register → `registered <asset_id> (v<version>, <media_type>)`
- metrics → `updated metrics for <asset_id>: <metrics json>`
- top → `<N> assets · top by <metric>:` then numbered `  i. <asset_id> — <metric>=<value>`

## Asset schema (canonical, after `normalize`)

| Field | Type | Required | Default | Aliases accepted on input |
|---|---|---|---|---|
| `asset_id` | string | yes | — | `id` |
| `client_slug` | string | yes (injected from CLI slug) | — | `slug` |
| `media_type` | enum image\|video\|carousel | yes | `image` | `type` (lowercased) |
| `version` | integer ≥ 1 | no | `1` | — |
| `parent_asset_id` | string\|null | no | `null` | `derived_from` |
| `uri` | string | yes | `null` | `url`, `image_url`, `video_url` |
| `hash` | string\|null | no | `null` | `sha256` |
| `angle_id` | string\|null | no | `null` | `angle` |
| `tags` | string[] | no | `[]` | scalar coerced to 1-element array |
| `alt_text` | string\|null | no | `null` | — |
| `ai_generated` | boolean | no | `false` | strict `=== true` |
| `ai_disclosed` | boolean | no | `false` | strict `=== true` |
| `metrics` | object (below) | no | zeros/nulls | metric keys also read at top level |
| `created_at` | string\|null | no | `null` | — |

### `metrics` sub-object

| Field | Type | Default |
|---|---|---|
| `impressions` | integer | `0` |
| `hook_rate` | number 0–1 \| null | `null` |
| `retention_3s` | number 0–1 \| null | `null` |
| `ctr` | number 0–1 \| null | `null` |
| `roas` | number \| null | `null` |

Metric keys may be supplied either nested under `metrics` or at the top level of the input (normalize reads `r.metrics || r`). Non-finite values normalize to `null` (or `0` for `impressions`).

### Required-field validation

`validate` fails (CLI exit 1) if: `asset_id` empty, `media_type` not in the enum, `uri` empty, or `ai_generated && !ai_disclosed`.

## Index file (`clients/{slug}/assets.json`)

```json
{
  "client_slug": "acme",
  "assets": [ { /* one normalized asset object … */ } ]
}
```

## Example payloads

### register (new video)
```bash
node skills/assets/assets.js acme register '{
  "asset_id":"vid_pain_001","media_type":"video",
  "uri":"https://cdn.example.com/vid_pain_001.mp4",
  "hash":"9f2c4a…","angle_id":"PAIN","tags":["ugc","video"],
  "alt_text":"Customer states the problem"
}'
# → registered vid_pain_001 (v1, video)
```

### register again, edited bytes (version bump)
```bash
node skills/assets/assets.js acme register '{
  "asset_id":"vid_pain_001","media_type":"video",
  "uri":"https://cdn.example.com/vid_pain_001_b.mp4","hash":"aa11…"
}'
# → registered vid_pain_001_v2 (v2, video)   parent_asset_id = vid_pain_001
```

### register identical bytes (dedupe)
```bash
# same hash as an existing asset → returns the existing asset unchanged
node skills/assets/assets.js acme register '{"asset_id":"x","media_type":"video","uri":"…","hash":"9f2c4a…"}'
# → registered vid_pain_001 (v1, video)   (the original; no new row)
```

### metrics
```bash
node skills/assets/assets.js acme metrics vid_pain_001 '{"impressions":48210,"hook_rate":0.34,"retention_3s":0.27,"ctr":0.012,"roas":3.6}'
# → updated metrics for vid_pain_001: {"impressions":48210,"hook_rate":0.34,...}
```

### top
```bash
node skills/assets/assets.js acme top --by=hook_rate
# → 12 assets · top by hook_rate:
#     1. vid_pain_001 — hook_rate=0.34
#     2. vid_proof_004 — hook_rate=0.29
```

## Edge cases

| Case | Behavior |
|---|---|
| No `assets.json` yet | Treated as empty index; first register creates the file |
| Corrupt/unparseable `assets.json` | `loadIndex` returns empty index (does not throw); next save overwrites |
| `register` with no `hash` | Dedupe skipped; may create a duplicate — always pass `hash` when known |
| `metrics` partial object | Merges onto existing `metrics`; unspecified keys preserved |
| `top --by=<unknown>` | Empty ranking (all values null), exit 0 — not an error |
| Metric supplied as a percent (e.g. `34`) | Stored verbatim as `34` — supply decimals (`0.34`); see `domain-standards.md` |
| `tags` given as a string | Coerced to a 1-element array |
