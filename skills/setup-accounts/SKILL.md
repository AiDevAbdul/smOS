---
name: setup-accounts
description: Use this skill to bootstrap a zero-start client's Meta presence — guide the human through the manual identity gates (Page, Instagram, business verification, payment, access grants) and auto-create the API-creatable structure (ad account, pixel/dataset, system user, asset assignment), writing every id + timestamp into client_profile.json. This skill should be used when a brand-new business has no Page / IG / ad account / pixel yet and the operator runs `/setup-accounts {slug}`. It is the Phase 0 step that unblocks /audit, /audience-map, /launch, and /publish.
---

# /setup-accounts — Meta Account Bootstrap (Phase 0 · setup track)

Stand up a brand-new client's Meta stack. The hard rule (verified against Graph API v25.0): **identity/trust is manual; structure/management is API.** This skill drives both halves through one Node companion — it records manual gates only on explicit operator confirmation, and executes the API-creatable assets through the fail-closed guard chokepoint, persisting all ids and ISO timestamps to `clients/{slug}/client_profile.json`.

## What This Skill Does

- Reports setup state as JSON: manual gates done/blocking, API asset ids, and overall readiness via `checkZeroStartPrereqs` (`--status`, the default).
- Records a manual gate timestamp on operator confirmation, optionally writing the id it produced (`--done <step> [--set k=v]`).
- **Read-verifies the gates Meta can actually confirm.** `--done ig_page_linked_at` GETs the Page's `instagram_business_account` edge first and refuses the stamp (exit 6) when the link does not exist, or when the Page is linked to a *different* IG than the profile records. On success it stamps `setup.ig_page_link_verified_at` and back-fills the live `instagram_business_id`. `--verify` runs the same read-checks (Page + IG link) without writing.
- Creates API-creatable assets once `business_id` + verification exist: ad account (`POST /{business_id}/adaccount`), pixel/dataset (`POST /{business_id}/adspixels`), system user (`POST /{business_id}/system_users`), and assigns owned assets (page, ad account) to the system user (`--bootstrap`).
- Writes every resulting id into `accounts` and every completion into `setup` with `nowIso()` timestamps.

## What This Skill Does NOT Do

- Does NOT create the Facebook Page, Instagram account, business verification, or add payment methods — those are UI-only; the operator does them and records them via `--done`.
- Does NOT install or verify the pixel is firing — `/capi-setup` owns pixel verification.
- Does NOT register domains or deploy landing pages — `/setup-web` owns that.
- Does NOT collect intake answers or create the profile — `/intake` owns profile creation (this skill halts if the profile is missing).
- Does NOT print or store the system-user access token — only records `system_user_id`; the operator generates/stores the token out-of-band (see `references/api-reference.md`).
- Does NOT launch, activate, or budget anything — consistent with the constitution's PAUSED-by-default rule.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `setup-accounts.js`, `schemas/client_profile.js` (`normalizeSetup` step keys), `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `scripts/lib/guards.js` (`checkZeroStartPrereqs`) |
| **Conversation** | Which `{slug}`; which manual gate the operator just completed and any id it produced |
| **Skill References** | Manual-vs-API split, step taxonomy, endpoint specs, and JSON contract from `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` — `accounts.business_id` and current `setup` timestamps |
| **Agency foundation** | `docs/agency-foundation.md` — one-time business verification + App Review for Advanced Access |

## Clarifications

> Before asking: check the conversation, the client profile, and prior handoff files.
> Only ask for what cannot be determined. Domain knowledge is embedded in `references/` —
> never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}` (the profile must already exist from `/intake`).
2. For `--done`: which manual gate the operator just completed, and the id it produced (e.g. `facebook_page_id`).

**Optional (ask only if relevant):**
3. The client's `accounts.business_id` (Business Portfolio id) — required for `--bootstrap`; ask only if absent from the profile.
4. Ad-account `currency` / timezone override — defaults to `USD` / timezone_id 1 (America/Los_Angeles).

## Workflow

1. **Show status** — what's done, what's blocking:
   `node skills/setup-accounts/setup-accounts.js {slug} --status`
2. **Walk the manual gates** one at a time. After the operator confirms each, record it (and any id it produced):
   `node skills/setup-accounts/setup-accounts.js {slug} --done page_created_at --set facebook_page_id=1234567890`
   Use exact step keys (see `references/domain-standards.md`): `business_verified_at`, `page_created_at`, `instagram_created_at`, `instagram_professional_at`, `ig_page_linked_at`, `payment_method_added_at`, `asset_access_granted_at`.
   `ig_page_linked_at` is read-verified against the API — if it exits 6, the link genuinely isn't there yet (finish it in Meta Business Suite → Linked accounts and re-run). `--force` records the operator's word instead and marks the gate unverified; use it only when the human explicitly accepts that.
3. **Bootstrap the API half** once `business_id` + verification are in place:
   `node skills/setup-accounts/setup-accounts.js {slug} --bootstrap`
   Creates ad account + pixel + system user, assigns assets, writes ids + timestamps.
4. **Re-run `--status`** to confirm the profile now passes `checkZeroStartPrereqs` (`ready: true`).
5. **Hand off** to `/setup-web` then `/capi-setup`.

## Input / Output Specification

**Inputs:** `slug` (positional, required); one mode flag (`--status` default | `--verify` | `--done <step>` [`--set k=v`] [`--from-intake`] [`--force`] | `--bootstrap`); env `META_ACCESS_TOKEN` (+ optional `META_APP_SECRET`) for `--bootstrap`, `--verify`, and the read-verified gates.
**Outputs:** JSON to stdout (status report, verification report, recorded-gate echo, or created/errors report) + an updated `clients/{slug}/client_profile.json` (`accounts` ids, `setup` timestamps, plus `setup.ig_page_link_verified_at` / `setup.ig_page_link_check` for the read-verified gate). `--status` marks each API-verifiable step with `api_verified`.
(Full schemas, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| `slug`, `business_id`, currency, which gates are already done | The 7 manual step keys + 4 API step keys (`schemas/client_profile.js`) |
| Which ids `--bootstrap` creates vs already present (`isTbd` skip) | Endpoints + Graph API v25.0 pin (`scripts/lib/meta-graph.js`) |
| Per-client Advanced-Access / verification readiness | Manual-vs-API split; PAUSED-by-default; token never printed |
| Asset tasks assigned (page vs ad account) | Guard chokepoint runs on every write (fail-closed) |

## Domain Standards

### Must Follow
- [ ] Record a manual gate ONLY on an explicit operator `--done` — never assume a human step happened.
- [ ] For a gate Meta can see (`ig_page_linked_at`), let the companion read-verify it. The operator's word is the fallback, not the default — `--force` must be a conscious human decision, and it records the gate as unverified.
- [ ] Run the API half through `createGraph()` so the guard chokepoint executes before every write.
- [ ] Require `accounts.business_id` before `--bootstrap`; halt with a clear message if absent.
- [ ] Persist ids to `accounts` and timestamps to `setup` via `clientProfile.normalize` on save.
- [ ] Skip any asset already set (`isTbd` guard) — idempotent re-runs.

### Must Avoid
- Fabricating manual-gate completion or faking ids.
- Reporting the IG↔Page link as done when the Page shows no `instagram_business_account`, or when it shows a different IG id than the profile records (that is a mismatch to resolve, not a pass).
- Printing, logging, or persisting the system-user access token.
- Activating campaigns, adding budgets, or creating more than the 5-per-business API ad-account cap.
- Hardcoding a token — always resolve from env.

### Output Checklist (verify before delivery)
- [ ] `--status` reports `ready: true` (no `blocking` entries) before handing off.
- [ ] Every created id is mirrored in `accounts` and echoed in the `created` block.
- [ ] Any bootstrap `errors` are surfaced with the next-step pointer to `docs/agency-foundation.md`.
- [ ] Profile re-normalizes cleanly (no `<TBD>` placeholders remain for completed assets).

## Error Handling

| Scenario | Action |
|----------|--------|
| Profile missing | Halt: "run /intake first" (exit 2) — never create the profile here |
| Missing `slug` arg | Print usage, exit 1 |
| Unknown `--done` step | List valid step keys, exit 1 |
| `--done ig_page_linked_at` but the Page has no linked IG (or a different one) | Companion exits **6** with the fix; nothing stamped. Complete the link in Business Suite and re-run, or `--force` to record it unverified |
| `--verify` finds the Page unreadable or the IG link absent | Exit 6 with the per-check reason — halt and fix before `/publish` or `/inbox` |
| `--bootstrap` without `accounts.business_id` | Halt: "Set accounts.business_id first" (exit 3) — never guess |
| `META_ACCESS_TOKEN` missing | `createGraph()` throws "META_ACCESS_TOKEN is required" — surface, do not silent-skip |
| Token expired/invalid (code 190/102/463/467) | `TokenExpiredError` surfaces (non-retryable) — prompt re-auth |
| Ad-account create error 100/200 (permissions) | Collect into `errors[]`, point to Advanced Access / verification (`docs/agency-foundation.md`) |
| 5-ad-accounts-per-business API cap hit | Surface error; remaining accounts must be created in the Business Manager UI |
| Any Meta API error | Logged with code/type/fbtrace_id by `meta-graph.js`; not auto-retried beyond transient backoff |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`), `scripts/lib/guards.js` (`checkZeroStartPrereqs`, guard chokepoint), `schemas/client_profile.js` (`normalize`, `normalizeSetup`), `scripts/lib/load-env.js`.
- **External APIs:** Meta Graph API v25.0 (`/adaccount`, `/adspixels`, `/system_users`, `/assigned_users`) — endpoints + rate limits in `references/api-reference.md`.
- **Secrets:** `META_ACCESS_TOKEN` (+ `META_APP_SECRET` for appsecret_proof) resolved via env / `load-env.js` — never hardcoded, never logged. System-user token is never emitted.
- **One-time prerequisite:** agency business verification + App Review for Advanced Access (`docs/agency-foundation.md`) — without it, `--bootstrap` ad-account creation fails.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Graph API versioning | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Confirm v25.0 pin / lifecycle |
| Domain Verification overview | https://developers.facebook.com/docs/sharing/domain-verification/ | Owned-domain / business-asset context |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/BUC limits, codes 4 / 17 / 613 |
| Marketing API root | https://developers.facebook.com/docs/marketing-api/ | Ad-account / pixel asset model |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | The manual-vs-API split, the step keys + taxonomy, read-verified gates, readiness rules, asset caps, good/bad operator-flow examples |
| `references/api-reference.md` | Exact Graph v25.0 endpoints, request bodies, asset tasks, rate limits, token handling — all cited |
| `references/io-contract.md` | Full CLI contract, exit codes, JSON output schemas + example payloads, edge cases |
