---
name: listening
description: Use this skill to capture a timestamped social-listening + ORGANIC competitor-benchmark snapshot for a client (`/listening {slug}`) — per-competitor followers, growth, cadence, engagement rate and top formats, plus tagged AND untagged brand mentions matched against a persisted keyword/hashtag/competitor watchlist, cross-platform coverage accounting, share of voice, and rule-based crisis detection. This skill should be used when the user asks to benchmark competitors organically, track brand mentions/keywords/hashtags, measure share of voice, or watch for a negative-sentiment spike. It is the organic complement to ads-only competitor tracking in `/research`.
---

# /listening — Social Listening + Organic Competitor Benchmarking (Phase 3.3 · depth layer E5)

Existing competitor tracking is ads-only (Meta Ad Library, via `/research`). This skill adds the organic side: it captures one append-only, timestamped `listening_snapshot.json` per run — competitor follower counts, growth, cadence, engagement, and top formats from IG Business Discovery, plus tagged and untagged brand mentions matched against a persisted watchlist. Stacked over time the snapshots become the time series that makes trend, velocity, and crisis detection possible.

## Coverage reality — read this before promising a client "social listening"

**smOS does not have full-web listening coverage, and this skill refuses to imply it.** Every run emits one `coverage` row per source, and a source that did not run reports `mentions: null` — never `0`. What is actually reachable:

| Source | Discovers | Real ceiling |
|---|---|---|
| IG `/tags` | **tagged only** | Returns only media where the client's IG account was @-tagged. It is *structurally incapable* of returning an untagged mention. |
| IG Hashtag Search (`--hashtag-search`) | **untagged** | The one first-party untagged path. Public top-level posts carrying a hashtag *you queried*, ~24h recency, **30 unique hashtags per IG user per rolling 7 days**. |
| FB own-post comments (`--fb-comments`) | untagged | Facebook exposes **no public keyword/mention search**. Only comments on the client's own Page posts are reachable. |
| Web search (`--web-search`) | untagged | Key-gated (`TAVILY_API_KEY`). Indexed public pages for the queried terms — a real signal, **not a per-platform census**, recency depends on the index. Missing key ⇒ `unavailable`, never silently skipped. |
| Operator / 3rd-party capture (`listening_capture.json`) | untagged | Whatever the supplied export contained; smOS cannot verify its completeness. |
| TikTok · X · LinkedIn · YouTube · Reddit | — | **No smOS-reachable listening API.** Listed every run as `unavailable` with `mentions: null` so their absence can never be read as zero mentions. |

Consequences that appear in the output, by design: the cross-platform `mention_total` is labelled `is_floor: true` whenever any contributing source is partial or truncated or any platform is unmeasured (in practice: always), and `share_of_voice` names its `basis_platforms` plus a `confidence` share and its own `is_floor` flag.

## What This Skill Does

- Maintain a persisted per-client **watchlist** (`clients/{slug}/data/listening_watchlist.json`) of brand terms, keywords, hashtags and competitor handles — seeded once from the profile, then authoritative (so an operator's removal is not undone by a stale profile field).
- Pull each competitor's followers + recent media via IG Business Discovery (public business/creator accounts, from the client's own IG id — no scraping) and derive `engagement_rate`, `posts_per_week`, `top_formats` (`scripts/lib/organic_bench.js`).
- Pull **tagged** mentions (IG `/tags`) and, on request, **untagged** ones (IG Hashtag Search, FB own-post comments, key-gated web search) into ONE cross-platform mention schema with `source`, `platform`, `discovery` (`tagged`|`untagged`), `matched_terms` and `about_client`.
- Emit a per-source **coverage** report + a floor-labelled `mention_total`.
- Compute **share of voice** (client vs named competitors) over the measured platforms only, with basis, confidence and floor labels.
- Append this run to `clients/{slug}/data/listening_timeseries.json` and run **crisis detection** (volume spike vs rolling baseline + negative-sentiment skew + velocity) against the *prior* points.
- Normalize + validate against `schemas/listening_snapshot.js`, write `listening_snapshot.json`, append to Supabase `listening_snapshots`.

## What This Skill Does NOT Do

- Ads / Ad Library competitor tracking — owned by `/research` and `/creative-intel`.
- Replying to mentions or DMs — owned by `/inbox`.
- Classify sentiment itself — the agent running the skill reads each mention's text and writes `sentiment_judgments` into `listening_capture.json` (`scripts/lib/sentiment.js` merges them fail-closed). Until then negative-skew scoring is **excluded from the crisis denominator, not zeroed**.
- Synthesizing the snapshot into a campaign plan — owned by `/strategy-brief` (it consumes the latest snapshot).
- Conversion-lift / incrementality — owned by `/attribution`.
- Publishing content — owned by `/publish`.
- Render an HTML/PDF client deliverable — the snapshot is engine JSON; `/portal` and `/report` surface it.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `schemas/listening_snapshot.js`, `scripts/lib/listening_depth.js`, `scripts/lib/listening_watchlist.js`, `scripts/lib/web_search.js`, `scripts/lib/organic_bench.js`, `scripts/lib/sentiment.js`, `scripts/lib/tokens.js`, `scripts/lib/meta-graph.js`, `scripts/lib/supabase.js` |
| **Conversation** | Which `{slug}`; whether a manual `listening_capture.json` was supplied; which untagged sources to enable |
| **Skill References** | Benchmark formulas + crisis thresholds in `references/domain-standards.md`; endpoints in `references/api-reference.md`; shapes in `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` — `competitors[]`/`competitor_handles`, `tracked_keywords`/`seo_keywords`, `accounts.instagram_business_id`, `accounts.facebook_page_id` |
| **Watchlist** | `clients/{slug}/data/listening_watchlist.json` (authoritative once it exists) — check with `--show-watchlist` before adding duplicates |
| **Time series** | `clients/{slug}/data/listening_timeseries.json` — how many prior points exist decides whether crisis detection can fire at all |

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

1. **Curate the watchlist first.** `node skills/listening/listening.js <slug> --show-watchlist`, then add what is missing:
   `--add-brand-term "Acme Care" --add-keyword "oil change" --add-hashtag acmecare --add-competitor @rivalbrand` (each repeatable), `--remove <term>`.
   Watchlist flags are a *pure* mutation: they write the watchlist, print it, and exit 0 without touching any API.
   **Brand terms are load-bearest** — without at least one, a client mention is indistinguishable from any other mention and share of voice reports the client as `null`.
2. Run the capture: `node skills/listening/listening.js <slug> [--hashtag-search] [--fb-comments] [--web-search]`.
   Untagged sources are **opt-in** — `--hashtag-search` consumes the 30-hashtag / 7-day IG quota, so don't burn it on a dry run.
3. The script loads the profile + watchlist, pulls the competitor benchmark (Business Discovery) and every enabled mention source, normalizes them into one cross-platform mention list, matches watchlist terms, dedupes by `mention_id`, and records a `coverage` row per source.
4. It computes `mention_total` (floor-labelled), `share_of_voice` (measured platforms only) and `crisis` (against the *prior* time-series points, never the current one).
5. Normalize → validate → write `listening_snapshot.json` → append the run to `listening_timeseries.json` → append to Supabase (best-effort).
6. **Classify sentiment.** Read the mentions listed by the `[listening] N mention(s) still need a sentiment judgment` note, write `mention_id → positive|neutral|negative` into `listening_capture.json`'s `sentiment_judgments`, re-run. Negative-skew crisis scoring stays *excluded* until ≥5 mentions carry a verdict.
7. If `crisis.severity` is `elevated`/`critical`, `requires_human` is true — surface the evidence to a human; never auto-post a response.
8. Hand the latest snapshot to `/strategy-brief`.

## Input / Output Specification

**Inputs:** arg `<slug>`; flags above; `clients/{slug}/client_profile.json`; `clients/{slug}/data/listening_watchlist.json`; `clients/{slug}/data/listening_timeseries.json`; optional `clients/{slug}/listening_capture.json`; env `SMOS_OFFLINE`, page/IG token (`scripts/lib/tokens.js`), `TAVILY_API_KEY` (web search), Supabase env.

**Flags:**

| Flag | Effect |
|---|---|
| `--show-watchlist` | Print the watchlist (seeded from the profile if no file yet) and exit |
| `--add-brand-term T` · `--add-keyword T` · `--add-hashtag T` · `--add-competitor H` | Repeatable; persist and exit |
| `--remove T` | Remove a term from every list it appears in; persist and exit |
| `--hashtag-search` | IG Hashtag Search over the watchlist hashtags (untagged discovery; 30 tags / 7 days) |
| `--fb-comments` | Scan the client's own FB Page post comments for watchlist terms |
| `--web-search` | Key-gated indexed public-page search (`TAVILY_API_KEY`); `unavailable` without the key |
| `--baseline-window N` | Rolling-baseline window in time-series points (default 14) |
| `--no-timeseries` | Do not append this run to the baseline |

**Outputs:** `clients/{slug}/listening_snapshot.json` (schema `listening_snapshot.js` — now carrying `coverage[]`, `mention_total`, `share_of_voice`, `crisis`, `watchlist`); `clients/{slug}/data/listening_watchlist.json`; `clients/{slug}/data/listening_timeseries.json`; append-only row in Supabase `listening_snapshots`; stdout one-line summary.
(Full schemas, field-by-field semantics, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Watchlist contents; competitor handles; client IG/Page ids | Snapshot schema + required fields (must be timestamped; ≥1 competitor, mention or coverage row) |
| Which metrics resolve live vs `null` | Benchmark formulas (engagement_rate, posts_per_week, top_formats) |
| Which sources are enabled and which reach data | Coverage taxonomy (`partial`/`unavailable`/`error`/`skipped`) and the rule that an unreached source is `null` |
| Number of prior time-series points | `MIN_BASELINE_POINTS` = 5, `MIN_CLASSIFIED_MENTIONS` = 5, signal weights 3/3/2, severity bands |
| Online vs offline (`SMOS_OFFLINE`), token/key presence | Append-only persistence; fail-closed validation; metrics never invented |

## Domain Standards

### Must Follow
- [ ] Stamp every snapshot with an ISO `captured_at` — it is required to trend the data.
- [ ] Persist append-only — never overwrite or update prior `listening_snapshots` rows; the time series is idempotent per `captured_at` so a retry cannot fabricate a spike.
- [ ] Set unretrievable metrics to `null` (private account, typo handle, API error) — never invent a number.
- [ ] A source that did not run reports `mentions: null`. `0` means "ran and found nothing" and nothing else — the schema now rejects the confusion.
- [ ] Label every total/share computed from a partial or truncated source as a **floor** (`is_floor`), and name the `basis_platforms` it was computed on.
- [ ] Require a baseline before calling a spike: fewer than 5 prior points ⇒ `crisis.severity: null`, `status: "insufficient_data"`.
- [ ] Remove an unmeasured crisis signal from the denominator; flag `severity_provisional` when under half the weighting had data.
- [ ] Strip a leading `@`/`#` and lowercase every watchlist term before matching (`canonTerm`).
- [ ] Let a single failed handle/hashtag fall through; never let it abort the whole snapshot.

### Must Avoid
- Claiming cross-platform or "full web" coverage. Say which sources ran and what their ceiling is — the coverage table above is the honest description.
- Reporting an unmeasured platform as zero mentions, or a truncated total as the account's real total.
- Scraping HTML or using unofficial endpoints — IG Business Discovery / Hashtag Search / `/tags` only, plus the key-gated web index.
- Firing "crisis" off one datapoint, or scoring a missing signal as zero (both manufacture a verdict out of absence).
- Hardcoding the global page token — resolve per-client via `scripts/lib/tokens.js`.
- Treating an empty watchlist as "nothing to report" — the script exits 7 instead.

### Output Checklist (verify before delivery)
- [ ] `listening_snapshot.json` exists and validates (`schema.validate(...).ok`).
- [ ] `captured_at` is a non-empty ISO timestamp.
- [ ] Every `coverage[]` row has a `status`; unreached rows have `mentions: null`.
- [ ] `mention_total.is_floor` and `share_of_voice.basis_platforms`/`confidence` are reported alongside any number quoted to a human.
- [ ] `crisis.severity` is `null` unless ≥5 prior points exist; `elevated`/`critical` reaches a human.
- [ ] Supabase append attempted when configured (failure logged, non-fatal).

## Error Handling

| Scenario | Action |
|----------|--------|
| No `<slug>` arg | Exit 2, print usage — never guess a slug |
| `client_profile.json` missing | Exit 3 `HALT: ... not found.` — halt, do not fabricate a profile |
| Schema validation fails (no timestamp / nothing captured / handle missing / an unreached source carrying a count) | Exit 4, print each error; write nothing |
| `listening_watchlist.json` unreadable | Exit 6 `HALT` — a corrupt watchlist must not silently become an empty one (which would read as "nothing to monitor") |
| Watchlist empty and the profile carried no terms | Exit 7 with the `--add-*` command to run — never a zero-mention snapshot |
| Business Discovery fails for a handle (private/typo/rate limit) | Log `business_discovery(<h>) failed`, emit a stub competitor, continue |
| `/tags` mention pull fails | Log; `ig_tags` coverage row is `error` with `mentions: null`, continue |
| A hashtag fails to resolve / errors | Recorded in the `ig_hashtag` coverage row's `reason`; the other hashtags still run |
| `--web-search` with no `TAVILY_API_KEY` | Coverage row `unavailable` with the reason; never silently skipped, never fabricated |
| No page token resolvable | Print note; every live source is `unavailable` with `mentions: null`; competitor stubs only |
| `SMOS_OFFLINE=1` | Every live source is `skipped` with `mentions: null`; capture (if any) still processed |
| `listening_timeseries.json` unreadable | Treated as NO baseline (not a zero baseline) ⇒ `crisis.status: "insufficient_data"` with the reason appended |
| Meta API error (general) | Log code/type/`fbtrace_id` via `meta-graph.js`; transient codes retried with backoff there; token code 190 surfaces non-retryable |
| Supabase not configured / insert fails | Skip persistence, log `supabase persist skipped` — non-fatal |

## Dependencies & Security

- **Reuses:** `schemas/listening_snapshot.js`, `scripts/lib/listening_depth.js` (matching, coverage, SoV, crisis — pure), `scripts/lib/listening_watchlist.js` (watchlist + time series, via `paths.js`), `scripts/lib/web_search.js` (key-gated Tavily), `scripts/lib/organic_bench.js`, `scripts/lib/sentiment.js`, `scripts/lib/meta-graph.js` (`createGraph`, v25.0, retry/guard chokepoint), `scripts/lib/tokens.js` (`resolveToken`), `scripts/lib/supabase.js`, `scripts/lib/paths.js`, `scripts/lib/load-env.js`.
- **External APIs:** Meta Graph API v25.0 — IG Business Discovery, IG Hashtag Search (`/ig_hashtag_search` → `/{id}/recent_media`), IG `/tags`, FB `/{page}/feed` comments (rate limits + fields in `references/api-reference.md`); Tavily search REST (optional, key-gated). All reads — this skill performs no writes.
- **Secrets:** page/IG tokens resolved via env / `scripts/lib/tokens.js` (`META_PAGE_TOKEN_<SLUG>` etc.), `TAVILY_API_KEY`, and Supabase keys via env — never hardcoded or logged.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API docs root | https://developers.facebook.com/docs/graph-api/ | Nodes/edges/fields basics |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current |
| Media Insights (impressions→views) | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | Engagement/metric semantics |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes + `fbtrace_id` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits; codes 4 / 17 / 613 |
| IG Hashtag Search | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search/ | Untagged discovery: tag→id, quota (30 tags / 7 days) |
| IG Hashtag recent_media | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag/recent-media/ | Recency window, public-media-only constraint |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22 (Business Discovery, `/tags`, errors, rate limits).
The two IG Hashtag Search rows were added 2026-09-09 from the documented endpoint
shape used in `listening.js`; **the doc URLs themselves have not been re-fetched** —
confirm the current path from the Instagram Platform docs root before relying on them.

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Benchmark formulas, engagement/cadence thresholds, sentiment taxonomy, crisis signal weights + severity bands, good/bad capture examples |
| `references/api-reference.md` | IG Business Discovery, Hashtag Search, `/tags`, FB feed comments — endpoints/fields/version/rate-limits with cited URLs |
| `references/io-contract.md` | Full `listening_snapshot` (incl. `coverage`/`share_of_voice`/`crisis`), `listening_watchlist`, `listening_timeseries` + `listening_capture` schemas, example payloads, edge cases |
