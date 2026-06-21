---
name: listening
description: Use this skill for social listening and ORGANIC competitor benchmarking (`/listening {slug}`) — brand mentions/keywords plus competitor follower growth, posting cadence, and engagement (the organic complement to the ads-only competitor tracking in /research).
---

# /listening — Social Listening + Organic Competitor Benchmarking (Phase 3.3)

Today competitor tracking is ads-only (Ad Library). This adds the organic side and
brand mentions, captured as time-stamped snapshots so trends (follower growth,
cadence, engagement) can be charted and fed into the next `/strategy-brief`.

## Required Context

- `clients/{slug}/client_profile.json` — competitor handles, tracked keywords
- IG/FB public data via MCP (`get_mentions`, public page fields); third-party listening optional

## Output (canonical contract)

- `clients/{slug}/listening_snapshot.json` — `schemas/listening_snapshot.js`
  (`captured_at`, `keywords[]`, `mentions[]`, `competitors[]` with growth/cadence/engagement)
- Best-effort persist to Supabase `listening_snapshots` (append-only → trendable)

## Workflow

1. Load competitor handles + tracked keywords from the profile.
2. Capture each competitor's followers, follower_growth_30d, posts_per_week, engagement_rate.
3. Capture brand mentions for the tracked keywords with sentiment.
4. Validate (`listeningSnapshot.validate`) — a snapshot must be timestamped and contain
   at least one competitor or mention.
5. Persist append-only; the brief skill reads the latest snapshot.

## Honesty

- Metrics not retrievable are `null`, never invented.
