---
name: publish
description: Use this skill when the user asks to publish, schedule, or run the content calendar for a client (typically via `/publish {slug}`). It reads `clients/{slug}/content_calendar.json`, publishes or natively-schedules every item whose `publish_at` is now-or-past and whose status is `pending` (Facebook feed/photo posts and Instagram image/video/reels/carousel via the two-step container flow), writes the resulting media IDs back into the calendar atomically, and appends one row per attempt to `publish_log.json`.
---

# /publish — Organic Content Calendar Runner (Phase 2 · Organic OS)

Run the organic content queue. This skill drains `content_calendar.json`: for every
due, pending item it publishes (or natively schedules) to Facebook or Instagram, records
the returned media/post ID back into the calendar, and logs each attempt. It is a pure
dispatcher — no copywriting, no LLM calls — so it is safe to run on a schedule.

## What This Skill Does

- Run `skills/publish/publish.js <slug> [--dry-run]`; never reimplement the dispatch in prose.
- Select calendar items where `status == "pending"` and (`publish_at` absent or `<= now`).
- Publish Facebook `post`/`image` via `POST /{page_id}/feed` or `/{page_id}/photos` with a Page token.
- Publish Instagram `image`/`video`/`reels` via the two-step `/media` container → `/media_publish` flow.
- Publish Instagram `carousel`: 2–10 child containers → parent `CAROUSEL` container → publish.
- Natively schedule Facebook items flagged `schedule_native: true` (`published=false` + `scheduled_publish_time`).
- Mutate each item in place (`status`, `published_id`, `published_at`, `error`) and rewrite the calendar atomically.
- Append-only audit row per attempt to `clients/{slug}/publish_log.json`.

## What This Skill Does NOT Do

- Generate captions, hooks, or creative — that is `/creative` and `/content-plan`.
- Build or sequence the calendar — `/content-plan` owns `content_calendar.json` creation.
- Reply to comments/DMs or moderate — `/inbox` owns engagement; use the `moderate_comments` MCP tool directly.
- Upload media bytes to a host — items must carry already-hosted `image_url`/`video_url`.
- Touch paid ads (campaign/adset/ad). Paid publishing is `/launch`.
- Retry failed items inside a run — reset `status` to `pending` and re-invoke.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/publish/publish.js`; `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, retry/guard); `scripts/lib/load-env.js` |
| **Conversation** | The `{slug}`; whether the user wants a dry-run preview vs a live run |
| **Skill References** | `references/` (see table below) — calendar schema, IG container flow, limits |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.facebook_page_id`, `accounts.instagram_business_id` |

## Clarifications

> Before asking: check the conversation, the client profile, and `content_calendar.json`.
> Only ask for what cannot be determined. Domain knowledge is in `references/` —
> never ask the user for the calendar schema or IG flow.

**Required (must resolve before running):**
1. Which client `{slug}` to run.

**Optional (ask only if relevant):**
2. Dry-run first? (Default to `--dry-run` if the user wants to preview what is due before posting live.)

## Workflow

1. Resolve `{slug}`. Confirm `clients/{slug}/client_profile.json` and `content_calendar.json` exist.
2. To preview, run `node skills/publish/publish.js <slug> --dry-run` and report the due list.
3. To publish live, run `node skills/publish/publish.js <slug>`.
4. Read the printed JSON summary (`published`, `scheduled`, `errors`, `ig_limit_reached`).
5. If any item errored, surface the `error` strings; suggest resetting `status` to `pending` for transient ones, then re-run.
6. Do not edit the calendar by hand mid-run — the script owns the atomic rewrite.

## Input / Output Specification

**Inputs:** CLI `<slug>` (required) + `--dry-run` flag; `clients/{slug}/client_profile.json`;
`clients/{slug}/content_calendar.json`; env `META_ACCESS_TOKEN` (IG + Graph client) and a Page
token via `META_PAGE_TOKEN_<SLUG_UPPER>` (falls back to `META_PAGE_TOKEN`).
**Outputs:** rewritten `content_calendar.json` (items mutated in place); append-only
`publish_log.json`; stdout JSON run summary; stderr progress lines. Exit codes: `1` usage/fatal,
`2` missing profile, `3` missing calendar.
(Full schemas, every field, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| `{slug}`, page/IG IDs, tokens | Two-step IG container → publish flow |
| Calendar item count, formats, copy, media URLs | Due-selection rule (`pending` + `publish_at <= now`) |
| Which items are `schedule_native` | 10-min-future floor for FB native scheduling |
| Per-client KPIs / posting cadence (in `/content-plan`) | 60 s container poll timeout; 3 s poll interval |
| Number of carousel slides (2–10) | Carousel slide bounds; CAROUSEL parent assembly |

## Domain Standards

### Must Follow
- [ ] Run the `.js`; treat the calendar as the single source of truth (read + write only it).
- [ ] Halt before publishing anything if no Page token resolves — never half-publish.
- [ ] Keep failures isolated: mark the item `error`, continue the run.
- [ ] Stop IG publishing for the run once the 100-posts/24h limit error is detected; finish FB items.
- [ ] Enforce the 10-min-future floor on FB native scheduling (Meta rejects sooner).

### Must Avoid
- Auto-retrying failed items inside a run (next invocation re-picks reset items).
- Publishing IG without polling the container to `FINISHED` (video/reels/carousel).
- Hand-editing the calendar mid-run or hardcoding tokens/IDs.
- Treating a `TBD` page/IG ID as valid — `isTbd()` blocks it.

### Output Checklist (verify before delivery)
- [ ] Summary JSON reported (`published`/`scheduled`/`errors`/`ig_limit_reached`).
- [ ] Calendar rewritten atomically; every due item has a terminal `status`.
- [ ] `publish_log.json` has one row per attempt.
- [ ] Any errors surfaced verbatim with a remediation note.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `{slug}` arg | Print usage, exit `1` |
| Missing `client_profile.json` | Print path, exit `2` — never guess IDs |
| Missing `content_calendar.json` | Print message, exit `3` |
| No Page token for a FB item | Throw before posting; mark item `error`, do not half-publish |
| `facebook_page_id`/`instagram_business_id` is `TBD` | Mark item `error` (`isTbd` guard); run `/setup-accounts` first |
| IG container `ERROR`/`EXPIRED` or 60 s timeout | Mark item `error` with Meta status string, continue |
| IG 100-posts/24h limit hit | Set `ig_limit_reached`, skip remaining IG, finish FB, report |
| Token expired (Meta code 190) | `meta-graph.js` throws non-retryable `TokenExpiredError`; re-auth |
| Rate limit / 5xx / network blip | `meta-graph.js` retries with backoff+jitter; persistent → item `error` |
| FB `schedule_native` < 10 min ahead | Throw; mark item `error` with the violation |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph` — guarded writes, retry/backoff, `appsecret_proof`, `TokenExpiredError`; `isTbd`), `scripts/lib/load-env.js` (`loadEnv`).
- **External APIs:** Meta Graph API **v25.0** — Pages `/feed`, `/photos`; Instagram `/media`, `/media_publish`. Rate limits + endpoints in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN`, `META_PAGE_TOKEN[_<SLUG>]`, optional `META_APP_SECRET` (appsecret_proof) — resolved from env via `loadEnv`; never hardcoded or logged.
- **Runtime:** Node 18+ (ESM, `node:fs`), `axios`, `dotenv`.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| IG Content Publishing guide | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | Two-step container flow; 100 posts/24h limit |
| IG Create Media container | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/ | `/media` params (image/video/reels/carousel) |
| IG Publish Media | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish/ | Publish a finished container |
| IG Content Publishing Limit | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/ | Read live quota before bulk runs |
| Pages API — Posts | https://developers.facebook.com/docs/pages-api/posts/ | FB `POST /{page-id}/feed` with a Page token |
| Page `/feed` edge | https://developers.facebook.com/docs/graph-api/reference/page/feed/ | `scheduled_publish_time`, `published`, `link` |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4 / 17 / 613; usage headers |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Publishing limits, scheduling floors, format taxonomy, container-poll timing, good/bad calendar items |
| `references/api-reference.md` | Exact Meta endpoints/params/version, IG container flow, rate-limit codes + headers (cited URLs) |
| `references/io-contract.md` | Full `content_calendar.json` + `publish_log.json` schemas, example payloads, edge cases, exit codes |
