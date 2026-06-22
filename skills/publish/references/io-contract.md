# /publish — Input / Output Contract

Full schemas, example payloads, and edge-case handling for the publish runner. Readable
independently of the other reference files.

## CLI

```
node skills/publish/publish.js <slug> [--dry-run]
```

| Arg | Required | Meaning |
|-----|----------|---------|
| `<slug>` | yes | Client directory under `clients/` |
| `--dry-run` | no | Print the due list as JSON; make **no** API calls and **no** writes |

### Exit codes
| Code | Meaning |
|------|---------|
| `0` | Run completed (some items may still be `error` — check the summary) |
| `1` | Missing `<slug>` arg, or uncaught fatal |
| `2` | `client_profile.json` not found |
| `3` | `content_calendar.json` not found |

## Environment

| Var | Required | Use |
|-----|----------|-----|
| `META_ACCESS_TOKEN` | yes | Graph client (IG publishing + container polling) |
| `META_PAGE_TOKEN_<SLUG_UPPER>` | for FB | Per-client Page token; slug uppercased, non-alphanumerics → `_` |
| `META_PAGE_TOKEN` | fallback | Used if the per-client var is unset |
| `META_APP_SECRET` | optional | Enables `appsecret_proof` |

Loaded via `scripts/lib/load-env.js` from `~/.config/smos/.env`, repo `.env`, or `SMOS_ENV_FILE`.

## Input — `clients/{slug}/client_profile.json` (fields read)

```json
{ "accounts": { "facebook_page_id": "1234567890", "instagram_business_id": "1789..." } }
```
Either ID may be `TBD` (or absent); `isTbd()` flags it and the matching items error.

## Input/Output — `clients/{slug}/content_calendar.json`

The runner reads this and rewrites it in place (atomic: write `.tmp` → rename).

```json
{
  "items": [
    {
      "id": "post-2026-06-22-fb-1",
      "platform": "facebook | instagram",
      "format": "post | image | video | reels | carousel",
      "publish_at": "2026-06-22T13:00:00Z",
      "message": "Caption / Facebook copy",
      "link": "https://...",                 // FB link posts only
      "image_url": "https://...",            // FB image / IG image
      "video_url": "https://...",            // IG video / reels
      "cover_url": "https://...",            // IG reels (optional)
      "share_to_feed": true,                 // IG reels (default true)
      "items": [                             // IG carousel slides (2–10)
        { "format": "image", "image_url": "https://..." },
        { "media_type": "VIDEO", "video_url": "https://..." }
      ],
      "schedule_native": false,              // FB only → server-side scheduling
      "status": "pending | scheduled | published | error",
      "published_id": null,
      "published_at": null,
      "error": null
    }
  ]
}
```

### Field semantics
- `status`: only `pending` items are processed. Set by the run to `published`, `scheduled`
  (FB native only), or `error`.
- `published_id`: FB `id`/`post_id`; IG single → media ID; IG carousel → parent media ID.
- `published_at`: ISO timestamp, set on `published` (not on `scheduled`).
- `error`: verbatim Meta/validation message on failure.

## Output — `clients/{slug}/publish_log.json` (append-only, JSONL)

One line per attempt. Success:
```json
{"ts":"2026-06-22T13:00:01Z","item_id":"post-...","platform":"facebook","format":"post","published_id":"123_456"}
```
Failure:
```json
{"ts":"2026-06-22T13:00:02Z","item_id":"ig-...","error":"instagram image requires image_url"}
```

## Output — stdout run summary (live run)

```json
{ "slug": "acme", "published": 3, "scheduled": 1, "errors": 1,
  "ig_limit_reached": false,
  "calendar": "/abs/.../content_calendar.json",
  "log": "/abs/.../publish_log.json" }
```

Dry-run output:
```json
{ "slug": "acme", "mode": "DRY_RUN",
  "due": [ { "id": "...", "platform": "instagram", "format": "reels", "publish_at": "..." } ] }
```

Progress lines (`[publish] ...`) go to **stderr**; the JSON summary goes to **stdout** — parse stdout only.

## Edge Cases

| Case | Behavior |
|------|----------|
| `items` array absent | Treated as empty; 0 due |
| `publish_at` absent on a pending item | Treated as due now |
| FB `image` with no `image_url` | Falls back to `/feed` (text/link post) |
| IG `image`/`video`/`reels` missing its media URL | Item errors with a precise message |
| IG carousel slide unknown type | Item errors `unknown carousel slide format: …` |
| Unknown `platform` | Item errors `unknown platform: …` |
| `facebook_page_id`/`instagram_business_id` is `TBD` | Item errors; run `/setup-accounts` |
| IG limit error mid-run | `ig_limit_reached=true`; remaining IG items error "skipped"; FB continues |
| Container never reaches FINISHED in 60 s | Item errors with timeout message |
| `--dry-run` | No API calls, no calendar/log writes |
