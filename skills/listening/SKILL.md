---
name: listening
description: Use this skill to capture a timestamped social-listening + ORGANIC competitor-benchmark snapshot for a client (`/listening {slug}`) — per-competitor followers, follower growth, posting cadence, engagement rate, top formats, plus brand mentions/keywords with sentiment. This skill should be used when the user asks to benchmark competitors organically, track brand mentions/keywords, or build trendable listening data that feeds the next `/strategy-brief`. It is the organic complement to ads-only competitor tracking in `/research`.
---

# /listening — Social Listening + Organic Competitor Benchmarking (Phase 3.3)

Existing competitor tracking is ads-only (Meta Ad Library, via `/research`). This skill adds the organic side: it captures one append-only, timestamped `listening_snapshot.json` per run — competitor follower counts, growth, cadence, engagement, and top formats from IG Business Discovery, plus brand mentions for tracked keywords. Stacked over time the snapshots become trends that feed the next strategy brief.

## What This Skill Does

- Read competitor handles + tracked keywords from `clients/{slug}/client_profile.json`.
- Pull each competitor's followers + recent media via IG Business Discovery (public business/creator accounts, from the client's own IG id — no scraping).
- Derive `engagement_rate`, `posts_per_week`, and `top_formats` from recent media (`scripts/lib/organic_bench.js`).
- Pull brand mentions (the client's IG `/tags` edge) with source/url/timestamp.
- Normalize + validate against `schemas/listening_snapshot.js`, write `listening_snapshot.json`, append to Supabase `listening_snapshots`.

## What This Skill Does NOT Do

- Ads / Ad Library competitor tracking — owned by `/research` and `/creative-intel`.
- Replying to mentions or DMs — owned by `/inbox`.
- Synthesizing the snapshot into a campaign plan — owned by `/strategy-brief` (it consumes the latest snapshot).
- Conversion-lift / incrementality — owned by `/attribution`.
- Publishing content — owned by `/publish`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `schemas/listening_snapshot.js`, `scripts/lib/organic_bench.js`, `scripts/lib/tokens.js`, `scripts/lib/meta-graph.js`, `scripts/lib/supabase.js` |
| **Conversation** | Which `{slug}`; whether a manual `listening_capture.json` was supplied |
| **Skill References** | Benchmark formulas + thresholds in `references/domain-standards.md`; endpoints in `references/api-reference.md`; shapes in `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` — `competitors[]`/`competitor_handles`, `tracked_keywords`/`seo_keywords`, `accounts.instagram_business_id` |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for it.

**Required (must resolve before running):**
1. The client `{slug}` (must have `clients/{slug}/client_profile.json`).

**Optional (ask only if relevant):**
2. Should the run be offline/stub-only (`SMOS_OFFLINE=1`) — e.g. for a dry run or when no IG token exists.
3. Is there a manually prepared `listening_capture.json` (third-party-tool export) to merge instead of a live pull.

## Workflow

1. Run `node skills/listening/listening.js <slug>` (the script is the single execution path).
2. The script loads the profile, resolves competitor handles + tracked keywords.
3. If online with a page token + IG id and no `listening_capture.json` competitors: pull live via Business Discovery + `/tags`; otherwise seed competitor stubs from handles.
4. Normalize → validate → write `listening_snapshot.json` → append to Supabase (best-effort).
5. Hand the latest snapshot to `/strategy-brief`.

## Input / Output Specification

**Inputs:** arg `<slug>`; `clients/{slug}/client_profile.json`; optional `clients/{slug}/listening_capture.json`; env `SMOS_OFFLINE`, page/IG token (`scripts/lib/tokens.js`), Supabase env.
**Outputs:** `clients/{slug}/listening_snapshot.json` (schema `listening_snapshot.js`); append-only row in Supabase `listening_snapshots`; stdout one-line summary.
(Full schemas, field-by-field semantics, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Competitor handles, tracked keywords, client IG id | Snapshot schema + required fields (must be timestamped; ≥1 competitor or mention) |
| Which metrics resolve live vs `null` | Benchmark formulas (engagement_rate, posts_per_week, top_formats) |
| Number of competitors / mentions captured | Business Discovery field expansion + `/tags` mention source |
| Online vs offline (`SMOS_OFFLINE`), token presence | Append-only persistence; fail-closed validation; metrics never invented |

## Domain Standards

### Must Follow
- [ ] Stamp every snapshot with an ISO `captured_at` — it is required to trend the data.
- [ ] Persist append-only — never overwrite or update prior `listening_snapshots` rows.
- [ ] Set unretrievable metrics to `null` (private account, typo handle, API error) — never invent a number.
- [ ] Strip a leading `@` and trim each handle before Business Discovery.
- [ ] Let a single failed handle fall through to a stub; never let it abort the whole snapshot.

### Must Avoid
- Scraping HTML or using unofficial endpoints — use IG Business Discovery only.
- Hardcoding the global page token — resolve per-client via `scripts/lib/tokens.js`.
- Treating zero competitors AND zero mentions as success (validation fails — nothing was captured).

### Output Checklist (verify before delivery)
- [ ] `listening_snapshot.json` exists and validates (`schema.validate(...).ok`).
- [ ] `captured_at` is a non-empty ISO timestamp.
- [ ] At least one competitor (with a `handle`) or one mention is present.
- [ ] Supabase append attempted when configured (failure logged, non-fatal).

## Error Handling

| Scenario | Action |
|----------|--------|
| No `<slug>` arg | Exit 2, print usage — never guess a slug |
| `client_profile.json` missing | Exit 3 `HALT: ... not found.` — halt, do not fabricate a profile |
| Schema validation fails (no timestamp / nothing captured / handle missing) | Exit 4, print each error; write nothing |
| Business Discovery fails for a handle (private/typo/rate limit) | Log `business_discovery(<h>) failed`, emit a stub competitor, continue |
| `/tags` mention pull fails | Log, leave `mentions` empty, continue |
| No page token resolvable | Print note, emit competitor stubs (no live benchmark), continue |
| Meta API error (general) | Log code/type/`fbtrace_id` via `meta-graph.js`; transient codes retried with backoff there; token code 190 surfaces non-retryable |
| Supabase not configured / insert fails | Skip persistence, log `supabase persist skipped` — non-fatal |

## Dependencies & Security

- **Reuses:** `schemas/listening_snapshot.js`, `scripts/lib/organic_bench.js`, `scripts/lib/meta-graph.js` (`createGraph`, v25.0, retry/guard chokepoint), `scripts/lib/tokens.js` (`resolveToken`), `scripts/lib/supabase.js` (`insert`/`clientIdBySlug`/`supabaseConfigured`), `scripts/lib/load-env.js`.
- **External APIs:** Meta Graph API v25.0 — IG Business Discovery + IG `/tags` (rate limits + fields in `references/api-reference.md`).
- **Secrets:** page/IG tokens resolved via env / `scripts/lib/tokens.js` (`META_PAGE_TOKEN_<SLUG>` etc.) and Supabase keys via env — never hardcoded or logged.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API docs root | https://developers.facebook.com/docs/graph-api/ | Nodes/edges/fields basics |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current |
| Media Insights (impressions→views) | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | Engagement/metric semantics |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes + `fbtrace_id` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits; codes 4 / 17 / 613 |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Benchmark formulas, engagement/cadence thresholds, sentiment taxonomy, good/bad capture examples |
| `references/api-reference.md` | IG Business Discovery + `/tags` exact endpoints/fields/version/rate-limits with cited URLs |
| `references/io-contract.md` | Full `listening_snapshot` + `listening_capture` JSON schemas, example payloads, edge-case handling |
