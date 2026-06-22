---
name: creative-intel
description: Use this skill when the user asks to check creative fatigue, find ads that are losing steam, track per-ad creative-performance trends, or build a refresh queue (typically via `/creative-intel {slug}`). It pulls 30-day daily ad-level Meta insights, computes per-ad CTR and frequency trends, classifies each ad against fatigue rules, ranks a top-10 refresh queue by wasted-spend × decay, and writes `clients/{slug}/creative_intel.json`. Complements `/audit-creative` (one-shot vision scoring) with longitudinal numeric tracking.
---

# /creative-intel — Creative Performance Trends & Fatigue Detection (Phase: Optimization)

Detect ad-creative fatigue before it wastes spend. This skill pulls daily ad-level
metrics over a rolling window, computes each ad's CTR decay and frequency, classifies
fatigue severity with deterministic local rules, and emits a ranked refresh queue that
feeds `/creative`. It is a pure read + compute pass — it never mutates the ad account.

## What This Skill Does

- Pull every ad that ran in the window via `act_<id>/ads`, then `GET /{ad_id}/insights` with `time_increment: 1` for daily series (batched in groups of 10).
- Compute per-ad `ctr_30d_avg`, `ctr_7d_avg`, `ctr_delta`, `frequency_7d`, `spend_7d`, `consecutive_ctr_decline_days`, `days_active`.
- Classify each ad: `FATIGUE_HIGH`, `FATIGUE_MEDIUM`, `STREAK_DECLINE`, `BURNOUT_SOON`, `HEALTHY`, `INSUFFICIENT_DATA`, `ERROR`.
- Rank flagged ads by `spend_7d × (1 + |ctr_delta|)`; the top 10 form the refresh queue (each carries `creative_id` so `/creative` can target the variant).
- Write `clients/{slug}/creative_intel.json` and print a one-line stdout JSON summary.

## What This Skill Does NOT Do

- Does NOT score visual/brand quality of creatives — that is `/audit-creative` (one-shot vision scoring).
- Does NOT pause, scale, or refresh ads — it only flags. Acting on the queue is `/scale` (pause/scale) and `/creative` (new variants).
- Does NOT pull competitor creative from the public Ad Library — that is `/research`.
- Does NOT generate an HTML/PDF deliverable — it is an internal JSON handoff, not a client report.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`), `scripts/lib/load-env.js`, the sibling `skills/creative-intel/creative-intel.js` |
| **Conversation** | Which `{slug}`; any non-default window the user named |
| **Skill References** | Fatigue rules + formulas in `references/domain-standards.md`; endpoints in `references/api-reference.md`; output shape in `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.ad_account_id`; per-client `CLAUDE.md` KPI overrides (frequency/CTR thresholds) |

## Clarifications

> Before asking: check the conversation, the client profile, and any prior `creative_intel.json`.
> Only ask for what cannot be determined. Fatigue thresholds and formulas are embedded in
> `references/domain-standards.md` — never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}` (maps to `clients/{slug}/client_profile.json`).

**Optional (ask only if relevant):**
2. Window length in days (default 30) — pass via `--window N`.

## Workflow

1. Resolve `{slug}`; load `clients/{slug}/client_profile.json`; halt if missing.
2. Read `accounts.ad_account_id`; halt if `isTbd` (TBD/empty/null).
3. List ads in window via `act_<id>/ads` (filter `ad.impressions > 0`; fall back to all non-archived ads if Meta rejects the filter).
4. Fetch daily insights per ad, batched in 10s.
5. Compute per-ad metrics (≥7 days of data required to classify).
6. Classify each ad against the fatigue rule table, then score refresh priority.
7. Rank flagged ads; take the top 10 as the refresh queue.
8. Write `clients/{slug}/creative_intel.json`; print the one-line summary.

Invocation: `node skills/creative-intel/creative-intel.js <slug> [--window 30]`

## Input / Output Specification

**Inputs:** arg `<slug>` (required), flag `--window <int>` (optional, default 30); env `META_ACCESS_TOKEN` (required, via `load-env.js`), `META_APP_SECRET` (optional, enables `appsecret_proof`); file `clients/{slug}/client_profile.json`.
**Outputs:** file `clients/{slug}/creative_intel.json`; stdout one-line JSON summary (`slug`, `ads_analyzed`, `ads_flagged`, `flag_counts`, `top_refresh`, `path`, `next`). Progress + halt messages go to stderr. No Supabase write in this skill.
(Full schemas, example payloads, and exit codes: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Ad account id, ad set, number of ads, window length | The five fatigue rules + their thresholds (freq 3/3.5/4, CTR decay −0.2/−0.3, 3-day streak, 14-day burnout) |
| Per-client KPI overrides (frequency/CTR baselines in `CLAUDE.md`) | Refresh-priority formula `spend_7d × (1 + |ctr_delta|)`; top-10 cap |
| Live CTR/frequency/spend values per ad | Metric fields requested; `time_increment: 1`; 10-ad batch size |
| Whether prior `creative_intel.json` exists | Output JSON shape + stdout summary contract |

## Domain Standards

### Must Follow
- [ ] Classify only ads with ≥7 daily rows; otherwise mark `INSUFFICIENT_DATA` (never guess a flag).
- [ ] Use `inline_link_click_ctr` (link CTR), not all-clicks CTR, for the trend.
- [ ] Take frequency as the **max** over the trailing 7 days (frequency is cumulative-ish, not a daily rate).
- [ ] Sort the daily series ascending by date before computing 7-day tails.
- [ ] Keep all classification local — no LLM call in the compute loop.

### Must Avoid
- Do not auto-retry on a surfaced throttle (codes 4/17/613) — the shared client already exhausted backoff; halt and surface.
- Do not report "no fatigue" when a throttle truncated the pull — that masks a failure.
- Do not mutate, pause, or scale any ad.
- Do not hardcode a token; resolve from env.

### Output Checklist (verify before delivery)
- [ ] `creative_intel.json` written with `ads_analyzed`, `ads_flagged`, `by_ad`, `refresh_queue`, `flag_counts`.
- [ ] Every flagged ad carries `creative_id`, `campaign_id`, `adset_id`, `refresh_priority_score`.
- [ ] `refresh_queue` ≤ 10, sorted descending by `refresh_priority_score`.
- [ ] stdout summary emitted; exit code reflects outcome (see `io-contract.md`).

## Error Handling

| Scenario | Action |
|----------|--------|
| No `<slug>` arg | Print usage, exit 1 |
| `client_profile.json` missing | Print path, exit 2 |
| `ad_account_id` is TBD | Print message, exit 3 |
| Meta throttle codes 4 / 17 / 613 surface after backoff | Throw `ThrottleError`, log `code/type/fbtrace_id`, do NOT auto-retry, exit 4 |
| Per-ad non-throttle insights error | Mark that ad `status: "error"` / `flag: "ERROR"`, continue others |
| Ad with no impressions in window | Mark `no_data`, exclude from flags |
| Ad with <7 daily rows | Mark `INSUFFICIENT_DATA`, do not classify |
| Token expired (code 190/102/463/467) | Shared client throws `TokenExpiredError` (non-retryable); halt, prompt re-auth |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `paginate`, `act`, `isTbd`, `API_VERSION=v25.0`), `scripts/lib/load-env.js`. Node ≥18 ESM, `axios` (transitive via meta-graph).
- **External APIs:** Meta Graph API v25.0 — read-only ad insights. Rate limits + retry/backoff handled by the shared client; surfaced throttle behavior documented in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN` (+ optional `META_APP_SECRET` for `appsecret_proof`) resolved via env / `load-env.js` — never hardcoded or logged. The token never appears in output JSON or stderr.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Ad node (insights edge) | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ | Ad object fields; `/{ad_id}/insights` |
| Ad Account ads edge | https://developers.facebook.com/docs/marketing-api/reference/ad-account/ | Listing ads under `act_<id>` with `filtering` |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4 / 17 / 613; `X-App-Usage` / `X-Business-Use-Case-Usage` headers |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error-code table, recovery, `fbtrace_id` |
| Versioning guide | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Confirm v25.0 pin / lifecycle |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Fatigue rule definitions, thresholds, formulas, metric semantics, good/bad worked examples |
| `references/api-reference.md` | Exact Graph endpoints, fields, filtering JSON, v25.0 notes, rate-limit codes + throttle-halt contract |
| `references/io-contract.md` | Full `creative_intel.json` schema, stdout summary schema, exit codes, example payloads, edge cases |
