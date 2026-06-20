---
name: capi-setup
description: Use this skill when the user asks to verify, set up, or audit a client's Conversions API integration (typically via `/capi-setup {slug}`). Inspects pixel events, dataset metadata, and event-match quality; optionally fires a test CAPI event; produces a gap report telling the client (or dev) exactly what's missing for full pixel+CAPI redundancy.
---

# /capi-setup — Conversions API Verification & Setup Guide

## Why this matters

iOS 14+ killed ~40% of client-side pixel tracking. Without server-side CAPI, conversion-objective campaigns optimize on broken data. Best-practice is **redundant** setup: the pixel fires client-side AND CAPI fires server-side for the same event, deduplicated via `event_id`.

This skill doesn't *implement* CAPI for the client — that's a dev/Zapier/GTM job — but it tells them exactly what to do and verifies the result.

## Required Context

- `clients/{slug}/client_profile.json` — for `accounts.pixel_id`, `accounts.ad_account_id`, `business.conversion_events`
- `META_ACCESS_TOKEN` env with `ads_management` + `business_management` scopes
- Optionally `--test-event` flag with a `TEST<code>` from Events Manager → Test Events tab

## Workflow

### Pass 1 — Pixel health (existing data)

- `GET /{pixel_id}/stats?start_time=<-7d>` — last 7 days of event firing
- For each event in `business.conversion_events`, mark `firing` / `stale` (no events in 48h) / `never_fired`

### Pass 2 — Dataset / CAPI side

- `GET /{dataset_id}?fields=last_fired_time,first_party_cookie_status,automatic_matching_fields,enable_automatic_matching`
- Read: when did the dataset last receive *any* event? Are first-party cookies enabled? Is Automatic Advanced Matching on?

### Pass 3 — Server-side share

For each event in the last 7d, compare `client` vs `server` source counts. The endpoint:
- `GET /{pixel_id}/stats?aggregation=event_name_and_method&start_time=<-7d>` — returns events bucketed by source (`browser` vs `server`)

Compute `server_share = server / (browser + server)` per event. Recommended thresholds:
- `< 0.05` — CAPI not implemented for this event → critical gap
- `0.05–0.49` — CAPI partial, missing on some traffic → fix
- `≥ 0.5` — CAPI healthy

### Pass 4 — Test event (optional, --test-event TEST<code>)

If `--test-event` provided, fire a synthetic `Lead` event with `test_event_code` so it shows up in Events Manager → Test Events but doesn't pollute production.

### Pass 5 — Gap report

Write `clients/{slug}/capi_report.json`:
```json
{
  "slug": "...",
  "generated_at": "...",
  "pixel_id": "...",
  "events": [
    { "name": "Purchase", "firing": true, "last_fired": "...", "client_count_7d": 0, "server_count_7d": 0, "server_share": 0.0, "status": "healthy|partial|missing|stale" }
  ],
  "dataset": { "last_fired_time": "...", "automatic_matching": true },
  "test_event": { "fired": false, "event_id": null },
  "gaps": [
    "Purchase event has 0 server-side fires — implement CAPI for the checkout success page",
    "AddToCart server_share is 12% — CAPI fires only for logged-in users, add for guests"
  ],
  "next_steps": [
    "Set up a Conversions API Gateway (Stape or self-host) OR add server-side fires from your backend",
    "Send the same event_id from pixel + CAPI for each event to enable deduplication",
    "Re-run /capi-setup in 48h to verify"
  ]
}
```

Print one-line summary: `pixel: N firing · M stale · K missing · CAPI: N healthy · M partial · K missing`.

## Output

- `clients/{slug}/capi_report.json`

## Error Handling

- No pixel_id in profile → halt with "Set accounts.pixel_id first"
- Pixel `/stats` returns empty data → still emit the report with all events marked `never_fired`
- 403 / OAuth gap → tell the user which scope they're missing

## Token Efficiency

- Pure data fetch + local classification; no LLM in the body
- Gap text is templated from the data, not generated
