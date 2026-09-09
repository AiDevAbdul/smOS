---
name: capi-setup
description: Use this skill to verify and gap-report a client's Meta pixel + Conversions API (CAPI) redundancy — inspecting pixel event firing, dataset metadata, and per-event server-side share, and optionally firing a deduplicated test event. It also owns the measurement spine: it tracks Event Match Quality over time (per-event score + match-key coverage) and reconciles platform-reported (modeled) conversions against an observed/CRM count, writing both into `measurement_spine.json` for `/attribution` to read. This skill should be used when the user asks to verify, set up, audit, or troubleshoot a client's Conversions API integration (typically via `/capi-setup {slug} [--test-event TEST<code>]`), asks whether match quality is improving, asks why Meta's conversion count differs from the CRM's, or confirms a pixel is firing before launching a conversion-objective campaign.
---

# /capi-setup — Conversions API Verification & Gap Report (Phase 0 / Pre-Launch)

Verify that a client's conversion tracking is *redundant*: the browser pixel fires client-side AND CAPI fires the same event server-side, deduplicated by `event_id`. iOS 14+ and cookie loss break ~40% of client-only tracking, starving conversion-objective campaigns of signal. This skill reads live pixel/dataset data, classifies each required event, and writes a `capi_report.json` gap report that tells the dev exactly what to fix.

## What This Skill Does

- Read the client's required `conversion_events` from `client_profile.json` (or a sane default set).
- Pull last-7-day pixel `/stats` and a source-bucketed breakdown (browser vs server vs app).
- Pull dataset metadata (last fired time, automatic advanced matching, first-party cookie status).
- Classify each event: `healthy`, `partial`, `missing`, `stale`, or `never_fired`.
- Optionally fire one synthetic deduplicated test `Lead` event with a `test_event_code` (production-safe).
- Pull the **Dataset Quality API** for Event Match Quality: per-event composite score (out of 10), its band, and the match-key coverage breakdown where Meta exposes it.
- Append that capture to the **measurement spine** (`clients/{slug}/data/measurement_spine.json`) as a time series, and report per-event trend (`current`, `previous`, `delta`, `direction`, `best`/`worst`/`mean`, `samples`).
- Reconcile **modeled vs observed conversions**: platform-reported count (from `/analyze`'s `performance_analysis.json`, or `--platform-conversions`) vs an operator-supplied observed count (`--observed`, e.g. from the CRM or server-side events) → gap, gap %, coverage ratio, verdict, with each side labeled platform-reported or audited.
- Best-effort mirror the capture to Supabase `measurement_snapshots` (DDL in `scripts/schema.sql`); the JSON spine stays the source of record.
- Write `clients/{slug}/capi_report.json` with per-event status, EMQ + trends, the reconciliation, derived gaps, and templated next steps.
- Print a one-line stdout summary for the orchestrator.

### The measurement spine (E4)

`/capi-setup` **writes** the spine; `/attribution` **reads** it (JSON handoff — it never
re-pulls the dataset). That is why an incrementality report can now state the EMQ its
conversions were matched at and whether those conversions were ever reconciled.

Honesty rules the code enforces (see `scripts/lib/measurement_spine.js`):

- An EMQ score Meta does not return is `null` (**unknown**) — never `0`, never a default.
  `dataset_avg_score` averages only the events that have a score.
- A trend needs **two real samples**. One capture has no `direction`; a run where the API
  returned nothing is not a sample and cannot make a trend look "flat".
- A coverage ratio with a zero/unknown denominator is `null` **with the reason stated** —
  never `1.0`, never `Infinity`.
- An identical same-day re-run does not append a second point (it would fake a denser
  history).

## What This Skill Does NOT Do

- Does NOT compute incrementality/lift — `/attribution` owns that; this skill only supplies the measurement quality it sits on.
- Does NOT discover the observed/CRM conversion count on its own — nothing in the Meta API knows it, so it must be passed via `--observed` (with its source named). No observed number ⇒ no reconciliation is recorded, and conversions stay labeled platform-reported.
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
4. The **observed** conversion count for the window (`--observed N`) and where it came from (`--observed-source crm|server_events|pos|…`), plus `--observed-audited` if it is traceable to records. Not discoverable — ask only when the user wants a modeled-vs-observed reconciliation.

## Workflow

1. Run `node skills/capi-setup/capi-setup.js <slug> [--test-event TEST<code>] [--no-emq] [--observed N --observed-source crm [--observed-audited]] [--platform-conversions N] [--event Purchase] [--window last_7d]`.
2. The script loads env, reads the profile, and halts fail-closed if `pixel_id` is missing/TBD.
3. If `SMOS_OFFLINE=1` or no token resolves, it skips every live read and reports each event `status: "unknown"` (not `never_fired`) with `data_source: "offline"` — it never fabricates API data.
4. Otherwise it fetches `/stats`, the source breakdown, dataset metadata, and `/dataset_quality` (EMQ) in parallel; each fetch fails soft to an empty/`error` payload so a partial failure still yields a report.
5. It classifies every required event, appends the EMQ snapshot to the spine (deduped), reconciles modeled vs observed when `--observed` is given, derives gaps (incl. EMQ + match-key gaps), builds next steps, and (if requested) fires the test event.
6. It writes `clients/{slug}/capi_report.json` + `clients/{slug}/data/measurement_spine.json` and prints the one-line summary.
7. Read the report; hand it to the client/dev and schedule a re-run in 48h to confirm fixes — the second run is what turns EMQ into a trend.

## Input / Output Specification

**Inputs:** positional `<slug>`; flags `--test-event TEST<code>`, `--no-emq` (skip the EMQ pull), `--observed N`, `--observed-source <label>`, `--observed-audited`, `--platform-conversions N`, `--event <name>`, `--window <label>` (all accept `--flag value` or `--flag=value`); `clients/{slug}/client_profile.json`; optional `clients/{slug}/data/performance_analysis.json` (from `/analyze`, supplies the platform-reported conversion total); env `META_ACCESS_TOKEN` (scopes `ads_management` + `business_management`), optional `META_APP_SECRET`, `SMOS_OFFLINE`.
**Outputs:** `clients/{slug}/capi_report.json` (gap report + `data_source`, `emq{snapshot,trends}`, `reconciliation`, `spine_path`, `supabase{persisted,reason}`), `clients/{slug}/data/measurement_spine.json` (append-only EMQ series + reconciliations), a one-line JSON summary on stdout, progress logs on stderr, and a best-effort Supabase `measurement_snapshots` row.
(Full schemas, example payloads, and edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| `pixel_id` / dataset id, ad account | Endpoint shapes + `API_VERSION` v25.0 (from `meta-graph.js`) |
| `business.conversion_events` list | Default event list when profile omits it |
| Per-event counts, sources, status | Status taxonomy + share thresholds (0.05 / 0.50) + 48h stale window |
| Whether a test event is fired, the `TEST<code>` | Test-event shape (`Lead`, `system_generated`, hashed em) |
| Gaps/next-steps text content | Gap + next-step templates (data-driven, not LLM) |
| EMQ scores, match-key coverage, series length | EMQ bands (great ≥8 / good ≥6 / ok ≥4 / poor), action threshold 6.0, 0.1 noise floor, `null`-means-unknown rule |
| Observed conversion count + its source | Reconciliation math + labels, ±5% alignment tolerance, null-denominator rule |

## Domain Standards

### Must Follow
- [ ] Treat a missing/`TBD` `pixel_id` as a hard halt — never invent an id.
- [ ] Always emit a report even when stats are empty (every event marked `never_fired`).
- [ ] Compute `server_share = server / (browser + server)` per event; classify against 0.05 / 0.50.
- [ ] Fire only a test-coded synthetic event; SHA-256-hash any PII (`em`) before sending.
- [ ] Recommend a single shared `event_id` per event across pixel + CAPI for deduplication.
- [ ] Report an EMQ score Meta did not return as `null` (unknown) and say why — never `0`, never a default.
- [ ] Require two real samples before stating an EMQ direction.
- [ ] Label every conversion count with its side: platform-reported (modeled) vs audited/observed.
- [ ] Return `null` (with the reason) for any ratio whose denominator is zero or unknown.

### Must Avoid
- Sending real conversion events or any event without a `test_event_code`.
- Reporting an offline/token-less run as if the pixel were verified (statuses must read `unknown`).
- Recording a reconciliation with no observed number, or calling an undeclared observed count "audited".
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
| `SMOS_OFFLINE=1` / no token | Skip all live reads, `data_source: "offline"`, every event `status: "unknown"`, EMQ `unavailable_reason` set; exit 0 with a gap line saying nothing was verified |
| `/dataset_quality` errors or returns no EMQ | Snapshot recorded with `source: "unavailable"` + reason; EMQ reported unknown, no per-event EMQ gaps claimed |
| `performance_analysis.json` missing/unreadable | Platform-reported conversions `null` with the reason ("run /analyze first, or pass `--platform-conversions`") |
| Platform-reported total is 0 | `coverage_ratio: null` + note "no denominator"; verdict `unknown` (never Infinity) |
| Supabase table absent / unconfigured | `supabase: { persisted:false, reason }` — the on-disk spine is the source of record |
| Corrupt `measurement_spine.json` | Reported `corrupt: true`; the run proceeds rather than blocking on history |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, `API_VERSION`, retry/backoff, guard chokepoint, `appsecret_proof`), `scripts/lib/load-env.js` (`loadEnv`), `scripts/lib/measurement_spine.js` (EMQ parse/series/trend, reconciliation, spine I/O — shared with `/attribution`), `scripts/lib/paths.js`, `scripts/lib/supabase.js` (best effort). Runtime: Node ≥18, `node:crypto`/`node:fs`.
- **External APIs:** Meta Graph API v25.0 — pixel `/stats`, dataset node read, `/dataset_quality` (Event Match Quality, read-only), `/{dataset_id}/events` write (rate limits + exact fields in `references/api-reference.md`).
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

**Last verified:** 2026-09-09 (Dataset Quality API / EMQ endpoint re-checked)

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Status taxonomy, share thresholds, stale window, gap/next-step templates, good/bad examples |
| `references/api-reference.md` | Exact endpoints, fields, API version, rate limits, response shapes with cited URLs |
| `references/io-contract.md` | Full `capi_report.json` schema, example payloads, CLI contract, edge cases |
