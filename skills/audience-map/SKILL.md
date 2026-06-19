---
name: audience-map
description: Use this skill when the user asks to build an audience targeting plan or audience map for a client (typically via `/audience-map {slug}`). Produces an `audience_map.json` covering interest clusters, behavior segments, retargeting layers, lookalike strategy, and exclusions — feeds `/strategy-brief`.
---

# /audience-map — Audience Targeting Architecture

## Required Context

- `clients/{slug}/client_profile.json` — for `audience`, `business`, `accounts.pixel_id`, `accounts.ad_account_id`
- Meta MCP server — `search_interests`, `get_custom_audiences`, `estimate_audience_overlap`, `check_pixel_health`
- Supabase connector — for the `reports` row

Halt if `pixel_id` or `ad_account_id` is missing.

## Workflow

### Pass 1 — Seed terms from the profile

Derive a seed list of 15–25 candidate interest keywords from:
- `business.product_description` (extract product nouns and adjacent categories)
- `audience.pain_points`
- Any explicit interests the user wrote into the profile

### Pass 2 — Resolve interests

For each seed term, call `search_interests({ q: term })`. Keep results where:
- `audience_size_lower_bound` ≥ 100k (too narrow otherwise)
- `audience_size_upper_bound` ≤ 50M (too broad otherwise)
- Path/topic is clearly related to the product

Run all `search_interests` calls in parallel.

### Pass 3 — Cluster into 3–5 themed groups

Group the resolved interests by theme — e.g. for a fitness supplement: `Strength Training`, `Endurance / Cardio`, `Nutrition & Macros`, `Recovery & Sleep`, `Aesthetic Goals`.

Each cluster: 4–8 interests, mixed audience sizes (one or two anchors >5M, the rest narrower).

Use `estimate_audience_overlap` on the largest interest pairs across clusters to flag clusters that collapse into each other; merge anything >40% overlap.

### Pass 4 — Behavior segments

Identify Meta behavior segments relevant to the product (e.g. `Engaged Shoppers`, `Frequent Travelers`, `Small Business Owners`, `New Movers`, `Anniversary within 30 days`). Pick 2–4 that match `audience` + `business.business_model`.

### Pass 5 — Retargeting layers

Build a standard four-layer warm pool (use the client's actual asset IDs where applicable):

1. **Website visitors — 30 / 90 / 180 day** windows, off `pixel_id`
2. **Page engagers — 365 day** (Facebook + Instagram), off `page_id` and `ig_account_id`
3. **Video viewers — 50% / 75%** thresholds, off any video assets surfaced in the audit
4. **Add-to-cart / view-content non-purchasers** — 30 day, off `pixel_id` (only if `conversion_event` in profile is purchase-like)

For each layer, write the audience name following naming convention: `RT_<source>_<window>` (e.g. `RT_PIX_30D`).

### Pass 6 — Lookalike strategy

Pick the strongest seed available:
- Best seed = `purchasers_365d` if a healthy purchase custom audience exists (>1000 members)
- Otherwise = highest-quality engagement source (page engagers / video 75% / ATC)

Recommend three sizes: **1%**, **3%**, **5%** of the geo footprint from `audience.geo_targets`.

Check `get_custom_audiences({ ad_account_id })` to confirm the seed exists and is healthy (`operation_status` 200). If the strongest seed is broken or missing, recommend a fallback and flag it.

### Pass 7 — Exclusions

Default exclusions:
- All-time purchasers (avoid re-prospecting buyers)
- Current employees / brand insiders custom audience (if the profile names one)
- Anything in `voice.restricted_words` that maps to an interest or behavior

Plus product-specific exclusions inferred from `audience.geo_targets` (e.g. exclude Alaska/Hawaii for US-shipping clients with surcharges, but only if the profile flags it).

### Pass 8 — Persistence

1. Write `clients/{slug}/audience_map.json`:
   ```json
   {
     "generated_at": "...",
     "interest_clusters": [
       { "name": "...", "interests": [{ "id": "...", "name": "...", "size_lower": 0, "size_upper": 0 }] }
     ],
     "behavior_segments": [{ "id": "...", "name": "...", "rationale": "..." }],
     "retargeting_layers": [
       { "name": "RT_PIX_30D", "source": "pixel", "window_days": 30, "rationale": "..." }
     ],
     "lookalike_strategy": {
       "seed": { "audience_id": "...", "name": "...", "size": 0, "health": "healthy|broken|missing" },
       "sizes": [1, 3, 5],
       "countries": ["..."],
       "fallback_note": "..."
     },
     "exclusions": [{ "type": "custom_audience|interest|geo", "value": "...", "rationale": "..." }]
   }
   ```
2. Insert row in Supabase `reports`: `client_id`, `type: 'audience_map'`, `summary_json` (cluster names + sizes + seed name).
3. Print a one-line summary: `N clusters · M behaviors · K retargeting layers · lookalike seed: <name>.`

## Output

- `clients/{slug}/audience_map.json`
- Row in `reports` table

## Error Handling

- `search_interests` returns nothing for a seed → drop the seed silently; only halt if fewer than 3 clusters can be assembled
- `get_custom_audiences` returns broken seed → fall back to the next-best engagement source and note in `fallback_note`
- Pixel health failure (`check_pixel_health`) → continue but flag retargeting layers as `unverified` in the JSON

## Token Efficiency

- All `search_interests` calls run in parallel
- Reuse the audit's custom-audience list if `/audit` ran recently — read from Supabase instead of re-calling `get_custom_audiences`
