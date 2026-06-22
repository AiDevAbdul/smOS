---
name: capi-setup
description: Use this skill to verify and gap-report a client's Meta pixel + Conversions API (CAPI) redundancy — inspecting pixel event firing, dataset metadata, and per-event server-side share, and optionally firing a deduplicated test event. This skill should be used when the user asks to verify, set up, audit, or troubleshoot a client's Conversions API integration (typically via `/capi-setup {slug} [--test-event TEST<code>]`), or confirms a pixel is firing before launching a conversion-objective campaign.
---

# /capi-setup — Conversions API Verification & Gap Report (Phase 0 / Pre-Launch)

Verify that a client's conversion tracking is *redundant*: the browser pixel fires client-side AND CAPI fires the same event server-side, deduplicated by `event_id`. iOS 14+ and cookie loss break ~40% of client-only tracking, starving conversion-objective campaigns of signal. This skill reads live pixel/dataset data, classifies each required event, and writes a `capi_report.json` gap report that tells the dev exactly what to fix.

## What This Skill Does

- Read the client's required `conversion_events` from `client_profile.json` (or a sane default set).
- Pull last-7-day pixel `/stats` and a source-bucketed breakdown (browser vs server vs app).
- Pull dataset metadata (last fired time, automatic advanced matching, first-party cookie status).
- Classify each event: `healthy`, `partial`, `missing`, `stale`, or `never_fired`.
- Optionally fire one synthetic deduplicated test `Lead` event with a `test_event_code` (production-safe).
- Write `clients/{slug}/capi_report.json` with per-event status, derived gaps, and templated next steps.
- Print a one-line stdout summary for the orchestrator.

## What This Skill Does NOT Do

- Does NOT implement CAPI for the client (backend code, GTM server container, Stape/CAPI Gateway) — that is a dev/integration job; this skill only verifies and prescribes.
- Does NOT create or bootstrap the pixel/dataset, ad account, or domain verification — `/setup-accounts` (and `/setup-web` for domain verification) own that.
- Does NOT set up product feeds or DPA events — `/catalog` owns that.
- Does NOT launch or activate any campaign — `/launch` owns that; this skill only gates it by confirming the pixel fires.
- Does NOT send real production conversion events — the only event it can fire is a test-coded synthetic `Lead`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`), `scripts/lib/load-env.js` (`loadEnv`); the sibling `skills/capi-setup/capi-setup.js` is the executable |
| **Conversation** | Whether the user wants a verification only or also a test-event fire; any specific event they care about |
| **Skill References** | Status taxonomy + share thresholds (`references/domain-standards.md`); endpoint/field shapes (`references/api-reference.md`); JSON contract (`references/io-contract.md`) |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.pixel_id`, `accounts.ad_account_id`, `business.conversion_events`; per-client `CLAUDE.md` overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}` to verify (the positional CLI arg).

**Optional (ask only if relevant):**
2. Whether to fire a test event — if yes, the user must supply the `TEST<code>` from Events Manager → Test Events tab (`--test-event TEST<code>`); it cannot be discovered.
3. Whether to override the default conversion-event list (otherwise read from the profile).

## Workflow

1. Run `node skills/capi-setup/capi-setup.js <slug> [--test-event TEST<code>]`.
2. The script loads env, reads the profile, and halts fail-closed if `pixel_id` is missing/TBD.
3. It fetches `/stats`, the source breakdown, and dataset metadata in parallel; each fetch fails soft to an empty/`error` payload so a partial failure still yields a report.
4. It classifies every required event, derives gaps, builds next steps, and (if requested) fires the test event.
5. It writes `clients/{slug}/capi_report.json` and prints the one-line summary.
6. Read the report; hand it to the client/dev and schedule a re-run in 48h to confirm fixes.

## Input / Output Specification

**Inputs:** positional `<slug>`; optional `--test-event TEST<code>`; `clients/{slug}/client_profile.json`; env `META_ACCESS_TOKEN` (scopes `ads_management` + `business_management`), optional `META_APP_SECRET`.
**Outputs:** `clients/{slug}/capi_report.json` (the gap report) + a one-line JSON summary on stdout; progress logs on stderr.
(Full schemas, example payloads, and edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| `pixel_id` / dataset id, ad account | Endpoint shapes + `API_VERSION` v25.0 (from `meta-graph.js`) |
| `business.conversion_events` list | Default event list when profile omits it |
| Per-event counts, sources, status | Status taxonomy + share thresholds (0.05 / 0.50) + 48h stale window |
| Whether a test event is fired, the `TEST<code>` | Test-event shape (`Lead`, `system_generated`, hashed em) |
| Gaps/next-steps text content | Gap + next-step templates (data-driven, not LLM) |

## Domain Standards

### Must Follow
- [ ] Treat a missing/`TBD` `pixel_id` as a hard halt — never invent an id.
- [ ] Always emit a report even when stats are empty (every event marked `never_fired`).
- [ ] Compute `server_share = server / (browser + server)` per event; classify against 0.05 / 0.50.
- [ ] Fire only a test-coded synthetic event; SHA-256-hash any PII (`em`) before sending.
- [ ] Recommend a single shared `event_id` per event across pixel + CAPI for deduplication.

### Must Avoid
- Sending real conversion events or any event without a `test_event_code`.
- Hardcoding tokens, secrets, or pixel ids (resolve via env / profile).
- Auto-retrying Meta errors here (the shared client handles retry/backoff; token errors are non-retryable).

### Output Checklist (verify before delivery)
- [ ] `capi_report.json` exists with one entry per required event and a valid `status`.
- [ ] `gaps` and `next_steps` are present (empty `gaps` only when all events are `healthy`).
- [ ] `dataset` block present (or an `{error}` stub on fetch failure).
- [ ] `test_event` reflects whether a fire was attempted and its result.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing `slug` arg | Print usage, exit 1 — never guess |
| Profile file not found | Print path, exit 2 |
| `accounts.pixel_id` missing/TBD | Halt with "set it before running", exit 3 |
| `/stats` returns empty/error | Fail soft: emit report with all events `never_fired` |
| Dataset fetch error | Store `dataset: { error }`, continue (no automatic-matching gap added) |
| Token expired (Meta code 190) | `meta-graph.js` throws non-retryable `TokenExpiredError` — surface, prompt re-auth |
| Missing OAuth scope (403) | Surface the Meta error; tell user which scope (`ads_management`/`business_management`) is missing |
| Test-event fire fails | Record `test_event: { fired:false, error }`; report still written |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`, retry/backoff, guard chokepoint, `appsecret_proof`), `scripts/lib/load-env.js` (`loadEnv`). Runtime: Node ≥18, `node:crypto`/`node:fs`.
- **External APIs:** Meta Graph API v25.0 — pixel `/stats`, dataset node read, `/{dataset_id}/events` write (rate limits + exact fields in `references/api-reference.md`).
- **Secrets:** `META_ACCESS_TOKEN` (+ optional `META_APP_SECRET` for `appsecret_proof`) resolved via env / `scripts/lib/load-env.js` — never hardcoded or logged. PII in test events is SHA-256-hashed before transmission.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| CAPI overview | https://developers.facebook.com/docs/marketing-api/conversions-api/ | Server-side events link to a Dataset ID (formerly Pixel ID) |
| Using the API | https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api/ | `POST /{API_VERSION}/{DATASET_ID}/events` shape |
| Server Event Parameters | https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event/ | `event_name`, `event_time`, `event_id`, `action_source`, `user_data`, `custom_data` |
| Main Body Parameters | https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/main-body/ | `test_event_code` for Events Manager Test Events |
| Dataset Quality API | https://developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api/ | Event match quality; dataset terminology |
| Graph API error handling | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, code 190 token failures |
| Graph API rate limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage` headers; codes 4 / 17 / 613 |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Status taxonomy, share thresholds, stale window, gap/next-step templates, good/bad examples |
| `references/api-reference.md` | Exact endpoints, fields, API version, rate limits, response shapes with cited URLs |
| `references/io-contract.md` | Full `capi_report.json` schema, example payloads, CLI contract, edge cases |
