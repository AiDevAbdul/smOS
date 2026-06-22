# Creative Audit — I/O Contract

Full schemas, example payloads, and edge-case handling for `/audit-creative`. Read this when
filling vision scores or when consuming the skill's outputs downstream.

## Inputs

| Input | Source | Notes |
|-------|--------|-------|
| `{slug}` | CLI arg 1 | Must match a `clients/{slug}/` directory |
| `collect` \| `aggregate` | CLI arg 2 | Mode; any other value throws `Unknown mode` |
| `client_profile.json` | `clients/{slug}/` | Reads `accounts.{page_id,facebook_page_id,ad_account_id}`, `assets.brand_colors`, `voice.{brand_colors,restricted_words,avoid}` |
| Meta token / `META_APP_SECRET` | env via `load-env.js` | For the read-only Graph pulls |

## Output 1 — `clients/{slug}/creative_assets.json` (after `collect`)

```json
{
  "client_slug": "acme-fitness",
  "generated_at": "2026-06-22T10:00:00.000Z",
  "brand_colors": ["#0A7E8C", "#F4A300"],
  "restricted_words": ["cheap", "guaranteed"],
  "asset_count": 12,
  "organic_count": 8,
  "ad_count": 4,
  "batches": [
    {
      "batch_id": 0,
      "asset_ids": ["1789_2233", "1789_2234", "..."],
      "vision_prompt": "For each image in this batch, score on: ..."
    }
  ],
  "assets": [
    {
      "asset_id": "1789_2233",
      "type": "organic",
      "format": "image",
      "image_url": "https://scontent.xx.fbcdn.net/...signed...",
      "permalink": "https://www.facebook.com/...",
      "copy": "New summer plan is live",
      "created_at": "2026-06-01T12:00:00+0000",
      "copy_length": 24,
      "restricted_word_hits": [],
      "vision_scores": {
        "visual_quality": null,
        "brand_consistency": null,
        "cta_present": null,
        "text_density_pct": null,
        "messaging_clarity": null,
        "notes": null
      }
    }
  ],
  "instructions": "For each batch, send the vision_prompt + the batch's image URLs to Claude..."
}
```

Ad-creative assets have `permalink` absent and `created_at: null`.

## Claude's job — fill `vision_scores`

For each `batches[i]`, send the `vision_prompt` and that batch's image URLs (as image content
blocks). Claude returns a **JSON array, one object per image, in input order**:

```json
[
  { "visual_quality": 8, "brand_consistency": 7, "cta_present": true,
    "text_density_pct": 15, "messaging_clarity": 8, "notes": "Strong hero, on-brand teal" },
  { "visual_quality": 4, "brand_consistency": 3, "cta_present": false,
    "text_density_pct": 48, "messaging_clarity": 4, "notes": "Cluttered stock photo" }
]
```

Merge element `k` into `assets[]` for the asset whose `asset_id` is `batches[i].asset_ids[k]`
(order is the alignment key). Write the file back, then run `aggregate`.

## Output 2 — `clients/{slug}/creative_audit_summary.json` (after `aggregate`)

```json
{
  "client_slug": "acme-fitness",
  "generated_at": "2026-06-22T10:30:00.000Z",
  "overall_score": 6.4,
  "formats": {
    "image":   { "count": 7, "visual_quality": 6.8, "brand_consistency": 6.1,
                 "cta_present_pct": 57, "text_density_compliant_pct": 71, "messaging_clarity": 6.5 },
    "video":   { "count": 3, "visual_quality": 7.0, "brand_consistency": 6.7,
                 "cta_present_pct": 33, "text_density_compliant_pct": 100, "messaging_clarity": 6.0 },
    "carousel":{ "count": 2, "visual_quality": null, "brand_consistency": null,
                 "cta_present_pct": null, "text_density_compliant_pct": null, "messaging_clarity": null }
  },
  "top3":    [ { "asset_id": "1789_2233", "permalink": "https://...", "weighted": 9.3, "notes": "..." } ],
  "bottom3": [ { "asset_id": "1789_2240", "permalink": "https://...", "weighted": 3.7, "notes": "..." } ],
  "violations": [ { "asset_id": "act_99_5", "hits": ["guaranteed"] } ],
  "scored_count": 10,
  "total_count": 12
}
```

`null` in a format block means no scored assets of that format — render as `—`, never `0`.

## Output 3 — patched `clients/{slug}/audit_report.md`

The `{{CREATIVE_AUDIT_SECTION}}` placeholder is replaced with a markdown block: an
"Assets scored" line, overall health score, a Format × dimension table, top-3 / bottom-3
lists (permalink or asset_id + notes + weighted), and a brand-voice-violations line. If the
placeholder is absent, the section is appended to the end of the file instead.

## stdout status objects

`collect` → `{ slug, mode:"collect", asset_count, organic, ads, batches, output, next }`
`aggregate` → `{ slug, mode:"aggregate", overall_score, scored, total, top_pick, worst_pick, violation_count, audit_report_patched, summary_path }`

## Edge cases

| Case | Behavior |
|------|----------|
| No `page_id` and no `ad_account_id` | Both sources `[]` → `asset_count: 0`; emit a stub "no creatives to audit yet" section |
| Asset with no `image_url` | Dropped at collect (status posts) |
| `created_at` older than 90 days | Dropped (organic); ad creatives (`created_at: null`) always kept |
| Image unreachable in vision | Leave its `vision_scores` `null` + `notes: "unreachable"`; excluded from averages, `weighted = -1` |
| Vision returns prose / bad JSON | Retry once "respond ONLY with valid JSON"; if still bad, skip that batch |
| `aggregate` with zero filled scores | Throws `No assets have vision_scores filled` — fill first |
| Fewer than 3 scored assets | `top3`/`bottom3` simply contain fewer entries (slice is safe) |
| `audit_report.md` absent | Summary JSON still written; `audit_report_patched: false` — note that `/audit` should run first |
| More than 50 posts/creatives in window | Only the newest 50 per edge are sampled (`limit=50`); to score the full window, swap `graph.get` for `graph.paginate` per `api-reference.md` §1 — downstream schema is unchanged |
