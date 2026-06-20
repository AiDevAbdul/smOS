---
name: publish
description: Use this skill when the user asks to publish, schedule, or run the content calendar for a client (typically via `/publish {slug}`). Reads `content_calendar.json`, publishes/schedules items whose `publish_at` is now or in the past, and updates the calendar with the resulting media IDs.
---

# /publish — Organic Content Calendar Runner

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.facebook_page_id`, `accounts.instagram_business_id`
- `clients/{slug}/content_calendar.json` — the content queue (see schema below)
- `META_ACCESS_TOKEN` env (user token for IG, and a Page access token for FB publishing)
- `META_PAGE_TOKEN_<SLUG_UPPER>` env if the client has its own page token (else the script falls back to `META_PAGE_TOKEN`)

## Content calendar schema

`clients/{slug}/content_calendar.json`:

```json
{
  "items": [
    {
      "id": "post-2026-06-22-fb-1",
      "platform": "facebook" | "instagram",
      "format": "post" | "image" | "video" | "reels" | "carousel",
      "publish_at": "2026-06-22T13:00:00Z",
      "message": "Caption / Facebook copy",
      "link": "https://...",                     // FB link posts only
      "image_url": "https://...",                // single-image FB or IG
      "video_url": "https://...",                // IG VIDEO/REELS
      "items": [{...}],                          // IG carousel slides
      "status": "pending" | "scheduled" | "published" | "error",
      "published_id": null,
      "published_at": null,
      "error": null,
      "schedule_native": false                   // true → use FB native scheduling instead of just-in-time publish
    }
  ]
}
```

## Workflow

1. Load calendar; halt with a clear error if missing.
2. Select items where `status == "pending"` and `publish_at <= now`.
3. For each, dispatch by `platform` + `format`:
   - **facebook post / image** → POST `/{page_id}/feed` or `/{page_id}/photos` with a page access token
   - **instagram image / video / reels** → 2-step container then `/media_publish`
   - **instagram carousel** → child containers → parent CAROUSEL → publish
4. For FB items with `schedule_native: true`, post with `published=false` + `scheduled_publish_time` (Meta schedules on its servers; this script returns immediately).
5. Mutate the item in place: `status`, `published_id`, `published_at`, `error`.
6. Rewrite the calendar atomically (write to `.tmp` then rename).
7. Print a one-line summary: `published N · scheduled M · errors E`.

## Output

- Updated `clients/{slug}/content_calendar.json`
- One row per published item in `publish_log.json` (append-only)

## Error Handling

- Missing page token → halt before publishing anything. Don't half-publish a calendar.
- IG container `ERROR`/`EXPIRED` status → mark item `error` with the Meta error string, continue.
- 100-calls-per-day IG limit hit (Meta returns a specific error) → stop IG publishing for the run, finish FB items, report.
- Network/transient errors → mark `error`, do not retry inside the run. The next `/publish` invocation picks it up if you reset `status` to `pending`.

## Token Efficiency

- No LLM calls — pure dispatch
- Calendar is the single source of truth; this script reads + writes it, nothing else
- IG container polling has a hard 60s timeout per item to avoid runaway runs

## Hours / safety

- FB native scheduling requires `publish_at` ≥ 10 min in the future (Meta rejects sooner). The script enforces this and surfaces the violation.
- Comment moderation is not part of this skill — use the `moderate_comments` MCP tool directly.
