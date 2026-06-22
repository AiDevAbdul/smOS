# content-plan — I/O Contract

Full input/output contract for `/content-plan`. Self-contained: the JSON schemas,
example payloads, and edge-case behavior. The shape is owned by
`schemas/content_plan.js` (`normalize`, `validate`); this file documents it.

## CLI

```
node skills/content-plan/content-plan.js <slug> [--weeks=N] [--draft]
```

| Token | Meaning |
|-------|---------|
| `<slug>` | Required. Client directory under `clients/`. |
| `--weeks=N` | Optional. Period length in weeks. Default `4`. |
| `--draft` | Optional. Warn instead of HALT on publishable-validation errors; emit a non-publishable skeleton for the creative agent. |

| Exit | Meaning |
|------|---------|
| `0` | Success (or `--draft` skeleton written) |
| `1` | Uncaught fatal exception |
| `2` | Missing `<slug>` arg |
| `3` | `clients/{slug}/client_profile.json` not found |
| `4` | Plan failed publishable validation (default mode) |

## Inputs

**File (required):** `clients/{slug}/client_profile.json`. Fields read (all optional within the file; the builder falls back):

| Path | Used for | Fallback |
|------|----------|----------|
| `business.niche` or `niche` | niche string in keywords/alt_text | `"service"` |
| `seo_keywords` or `voice.keywords` | seed pillar keywords (sliced to 8) | `[niche, "local", "tips"]` |

**Env (optional):** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (loaded via `scripts/lib/load-env.js`). Absent → persistence skipped.

## Output 1 — `clients/{slug}/content_plan.json`

Full normalized plan: `{ client_slug, period, pillars[], items[] }`.

```json
{
  "client_slug": "acme",
  "period": { "start": "2026-06-29", "weeks": 4 },
  "pillars": [
    { "id": "educate", "name": "Educate", "intent": "educate", "cadence_per_week": 2, "keywords": ["roofing", "service"] },
    { "id": "proof", "name": "Social Proof", "intent": "convert", "cadence_per_week": 1, "keywords": ["local", "service"] },
    { "id": "behind", "name": "Behind the Scenes", "intent": "community", "cadence_per_week": 1, "keywords": ["tips", "service"] },
    { "id": "offer", "name": "Offer / CTA", "intent": "convert", "cadence_per_week": 1, "keywords": ["roofing", "service"] }
  ],
  "items": [
    {
      "id": "acme-2026-06-29-educate",
      "pillar_id": "educate",
      "platform": "instagram",
      "format": "reels",
      "publish_at": "2026-06-29T13:00:00.000Z",
      "message": "[Educate] roofing: _(creative agent to write keyword-first caption)_",
      "keywords": ["roofing", "service"],
      "hashtags": ["#roofing", "#service"],
      "alt_text": "Educate reels about roofing for service",
      "status": "pending"
    }
  ]
}
```

### Pillar schema

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | stable pillar key |
| `name` | string | display name |
| `intent` | enum | `educate` \| `inspire` \| `convert` \| `community` |
| `cadence_per_week` | number | posts/week target |
| `keywords` | string[] | SEO keywords |

### Item schema

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `{slug}-{YYYY-MM-DD}-{pillar_id}` |
| `pillar_id` | string | references a pillar |
| `platform` | enum | `facebook` \| `instagram` \| `threads` (default `instagram`) |
| `format` | enum | `post`\|`image`\|`video`\|`reels`\|`carousel`\|`story`\|`text` (default `reels`) |
| `publish_at` | ISO-8601 string | scheduled time |
| `message` | string | keyword-first caption (placeholder body) |
| `keywords` | string[] | Social-SEO |
| `hashtags` | string[] | derived from keywords |
| `alt_text` | string | Social-SEO description |
| `items` | object[] | carousel slides (`{ media_type }`), ≥2 when format=carousel |
| `image_url` / `video_url` | string\|null | required for image / video+reels at publish time |
| `status` | enum | `pending`\|`scheduled`\|`published`\|`error`\|`draft` (starts `pending`) |
| `link`, `published_id`, `published_at`, `error`, `schedule_native` | — | round-trip fields kept lossless for `/publish` |

## Output 2 — `clients/{slug}/content_calendar.json`

Exactly `{ items: plan.items }` — the same items, nothing re-derived. This is the
direct, byte-stable handoff `/publish` reads.

```json
{ "items": [ /* identical to content_plan.json items */ ] }
```

## Validation (`schemas/content_plan.js`)

`validate(plan, { requirePublishable })` returns `{ ok, errors[] }`.

**Always checked:** items non-empty; each item has a non-empty `id`; valid
`platform`, `format`, `status`.

**Additionally when `requirePublishable: true`** (default mode, i.e. `!draft`):
- `publish_at` present
- `image` → `image_url`; `video`/`reels` → `video_url`; `carousel` → ≥2 slides
- non-empty `message` for every format except `story`

Errors name the offending item, e.g.
`items[0] (acme-2026-06-29-educate) reels needs video_url`.

## Edge Cases

| Case | Behavior |
|------|----------|
| Profile missing | exit 3 before any generation — never blank-page |
| Profile has no niche/keywords | falls back to `"service"` / `[niche,"local","tips"]` |
| Default plan has no media URLs | publishable validation fails → exit 4 (default) or warn (`--draft`) |
| `--draft` chosen | writes both files with non-publishable skeleton, exit 0, prints draft warning list |
| `--weeks` non-numeric/absent | coerced; defaults to 4 |
| Re-run same week | identical output (deterministic `nextMonday`, no randomness) |
| Supabase unset / insert error | logged `supabase persist skipped`, files still written, exit 0 |
| `clientIdBySlug` returns null | row inserted with `client_id: null` (best-effort) |

## Keeping Current

The schema in `schemas/content_plan.js` is the contract source of truth — if its
enums or validation rules change, update the tables above. Item generation logic
(ids, slots, formats) lives in `skills/content-plan/content-plan.js`.

**Last verified:** 2026-06-22
