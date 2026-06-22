# Audience-Map I/O Contract

Full input/output contract for `node skills/audience-map/audience-map.js <slug> [--offline]`.
Readable standalone.

---

## Inputs

### CLI
- `<slug>` — required positional. Maps to `clients/<slug>/client_profile.json`.
- `--offline` — optional flag. Forces structure-only mode (no Graph calls).

### Environment (live mode only)
- `META_ACCESS_TOKEN` — required for Graph calls; resolved by `load-env.js`
  (`~/.config/smos/.env`, `SMOS_ENV_FILE`, or repo `.env`).
- `META_APP_SECRET` — optional; enables `appsecret_proof`.

### Client profile fields read
`clients/<slug>/client_profile.json`:

| Path | Used for |
|------|----------|
| `business.product_description`, `business.usp` | Seed extraction |
| `business.business_model` | Behavior-segment mapping |
| `business.conversion_event` / `business.conversion_events[0]` | Whether to add the ATC retargeting layer |
| `audience.pain_points[]`, `audience.interests[]` | Seed extraction (interests = forced seeds) |
| `audience.age_low/age_high` or `audience.age_range[]` | Age band (default 18–65) |
| `audience.gender` | `["all"]` if all/balanced, else `[gender]` |
| `audience.geo_targets[]` | Geo + lookalike countries |
| `accounts.ad_account_id` | Mode gate + custom-audience pull |
| `accounts.pixel_id`, `accounts.page_id`/`facebook_page_id`, `accounts.ig_account_id`/`instagram_business_id` | Retargeting layer source IDs + `verified` flag |
| `voice.restricted_words[]` | Creative-constraint exclusion |
| `location.country`, `location.city`, `location.state`, `location.service_radius_miles` | Geo fallback/center/radius |

Missing optional fields fall back to documented defaults; a missing profile file → exit 2.

---

## Output: `clients/<slug>/audience_map.json`

The raw object the script builds is passed through `audienceMap.normalize`
(`schemas/audience_map.js`) before writing — so the file is already in canonical shape:
`interest_clusters` → `clusters`, `cluster.interests` → `interest_stack`, `geo.targets` plus
a derived `geo.primary`.

### Canonical shape (post-normalize)

```json
{
  "client_slug": "blue-rose-auto",
  "generated_at": "2026-06-22T10:00:00.000Z",
  "mode": "live",
  "geo": {
    "primary": "US",
    "targets": ["US"],
    "radius": null,
    "center": "Austin, TX"
  },
  "age_gender": { "age_min": 25, "age_max": 54, "genders": ["all"] },
  "seed_terms_used": ["auto detailing", "ceramic coating", "paint correction"],
  "clusters": [
    {
      "id": "INT_VEHICLES",
      "label": "Vehicles",
      "interest_stack": ["Car detailing", "Auto detailing", "Ceramic coating"],
      "behavioral_add_ons": [],
      "size_estimate_lower": 4200000,
      "size_estimate_upper": 9800000,
      "anchor_index": 0,
      "interests": [
        { "id": "6003...", "name": "Car detailing", "size_lower": 1500000, "size_upper": 3200000 }
      ]
    }
  ],
  "behavior_segments": [
    { "name": "Engaged Shoppers", "rationale": "DTC — high purchase intent" }
  ],
  "retargeting_layers": [
    { "name": "RT_PIX_30D", "source": "pixel", "source_id": "123", "window_days": 30,
      "rationale": "Recent site visitors — highest warm intent", "verified": true }
  ],
  "lookalike_strategy": {
    "seed": { "audience_id": "234", "name": "Purchasers 365d", "size_lower": 1100, "size_upper": 1200, "subtype": "CUSTOM" },
    "health": "healthy",
    "fallback_note": null,
    "sizes_pct": [1, 3, 5],
    "countries": ["US"]
  },
  "exclusions": [
    { "type": "custom_audience", "name": "all_time_purchasers", "rationale": "Avoid re-prospecting buyers in cold campaigns" }
  ],
  "diagnostics": {
    "seed_count": 18,
    "cluster_count": 3,
    "custom_audiences_found": 5,
    "issues": []
  }
}
```

### Schema requirements (`audienceMap.validate` — hard at `/launch`)
- `clusters` is a non-empty array.
- Each `clusters[i].id` is a non-empty string (join key for launch targeting).
- Each `clusters[i].interest_stack` is a non-empty array.
- `geo.primary` is a non-empty string.

In `/audience-map` this check is **soft**: failures append `schema: <msg>` to
`diagnostics.issues` rather than aborting (so offline/structure-only runs still write).
`/launch` enforces it hard.

---

## Output: stdout summary

A single pretty-printed JSON object:

```json
{
  "slug": "blue-rose-auto",
  "mode": "live",
  "seeds": 18,
  "clusters": 3,
  "behaviors": 1,
  "retargeting_layers": 4,
  "lookalike_seed": "Purchasers 365d",
  "lookalike_health": "healthy",
  "issues": [],
  "output": "/abs/path/clients/blue-rose-auto/audience_map.json"
}
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success — file written |
| 1 | No `<slug>` arg, or fatal error (e.g. no seed terms derivable) |
| 2 | `client_profile.json` not found |

---

## Edge cases

| Case | Behavior |
|------|----------|
| `ad_account_id` is TBD/empty | Auto-offline; `mode = "live"` field still set by builder but no Graph calls; diagnostics note added |
| `--offline` | No Graph calls; `mode = "offline_structure_only"`; `clusters: []`; lookalike `skipped_offline` |
| Seed search all empty | `clusters: []`; if live and `<3` clusters, diagnostics note added |
| No custom audiences | `lookalike_strategy.seed = null`, `health: "missing"`, fallback note set |
| No `geo_targets` and no `location.country` | Geo defaults to `["US"]` |
| Cluster paths missing | Interests bucket under `topic` or `General` (low-quality cluster — see domain-standards §3) |

**Last verified:** 2026-06-22
