---
name: leads
description: Use this skill to pull, score, and export a client's Meta lead-gen leads before Meta's 90-day retention window expires. This skill should be used when the user asks to list lead forms, sync new leads, force-pull a form, or hand leads off to a CRM — typically via `/leads {slug}`, `/leads {slug} sync`, `/leads {slug} list`, or `/leads {slug} pull {form_id}`.
---

# /leads — Lead Retrieval & Quality Scoring (Phase 4 · Paid Ops)

Pull Meta lead-gen form submissions before they expire from Meta's 90-day storage, score each lead 0–100 to separate qualified leads from junk, and export an append-only JSONL store plus a flat CSV ready for CRM upload. This is the safety net for clients without a real-time CRM webhook integration: pull regularly, score, hand off.

## What This Skill Does

- Lists every lead-gen form on the client's Facebook Page (`list` mode).
- Pulls leads created since the last sync per form, deduped and append-only (`sync` mode).
- Force-pulls one named form, optionally from a `--since` ISO date (`pull` mode).
- Normalizes Meta's `field_data` arrays into flat key→value objects.
- Scores every lead 0–100 with auditable reasons; tiers as `qualified` / `review` / `junk`.
- Writes per-form JSONL, a unified `leads_export.csv`, and a per-form sync-state file.

## What This Skill Does NOT Do

- **Set up lead forms or real-time webhooks** — that is one-time integration work, not owned by any pipeline skill; the script only *suggests* subscribing a webhook when polling looks lossy.
- **Build the form's question schema or launch the lead campaign** — `/launch` builds the campaign/adset/ad tree.
- **Write ad copy or the form intro/privacy text** — `/creative`.
- **Move leads through the sales pipeline or push to a CRM system** — `/crm` consumes the CSV; this skill only produces the handoff file.
- **Use an LLM at runtime** — scoring is pure deterministic local logic.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (`createGraph`, `paginate`, `isTbd`, `TokenExpiredError`), `scripts/lib/load-env.js`, `scripts/lib/tokens.js` |
| **Conversation** | Which `{slug}`; whether they want `list`, `sync`, or `pull`; any `--since` override |
| **Skill References** | Scoring rubric + field taxonomy from `references/domain-standards.md`; endpoints from `references/api-reference.md`; file shapes from `references/io-contract.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` → `accounts.facebook_page_id`; per-client `CLAUDE.md` overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and `clients/{slug}/leads_state.json`.
> Only ask for what cannot be determined. The scoring rubric and taxonomy live in `references/` —
> never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}` (used for profile lookup, token env var, and output paths).

**Optional (ask only if relevant):**
2. Mode — default to `sync`; use `list` to preview forms, `pull {form_id}` to force one form.
3. `--since ISO_DATE` override when backfilling or re-pulling a window.

## Workflow

1. Resolve `{slug}`; load `clients/{slug}/client_profile.json` and read `accounts.facebook_page_id`. Halt if missing or TBD.
2. Resolve the Page token: `META_PAGE_TOKEN_<SLUG_UPPER>` then fall back to `META_PAGE_TOKEN`. Halt if neither set.
3. Run: `node skills/leads/leads.js <slug> <list|sync|pull> [form_id] [--since ISO]`.
4. For `sync`: list forms, keep only `status === "ACTIVE"`, and for each pull leads `since` the per-form `last_synced` (default last 7 days on first run).
5. Normalize `field_data`, score each lead, append new (deduped by `id`) leads to `leads/<form_id>.jsonl`, update `leads_state.json`.
6. Rebuild `leads_export.csv` from ALL stored leads (union of field columns).
7. Report the one-line tier summary and surface any per-form errors.

## Input / Output Specification

**Inputs:** CLI args `<slug> <mode> [form_id] [--since ISO]`; `clients/{slug}/client_profile.json`; env Page token; optional `clients/{slug}/leads_state.json`.
**Outputs:**
- `clients/{slug}/leads/<form_id>.jsonl` — append-only canonical store (one scored lead per line)
- `clients/{slug}/leads_export.csv` — flat CRM-ready export (overwritten each run)
- `clients/{slug}/leads_state.json` — per-form `{ last_synced, total_pulled }`
- stdout JSON summary; human progress on stderr
(Full schemas + example payloads + edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| `{slug}`, Page ID, Page token env var | API version `v25.0`; endpoints `/{page}/leadgen_forms`, `/{form}/leads` |
| Form set, form field names/locales | `field_data` normalization rule (lowercase + `_` join, single-value unwrap) |
| Lead volume, sync window | 0–100 rubric, base 70, floors 70/40; disposable-domain list |
| Mode (`list`/`sync`/`pull`), `--since` | Append-only + dedupe-by-`id`; CSV rebuilt from full store |

## Domain Standards

### Must Follow
- [ ] Pull on a cadence shorter than Meta's **90-day** lead retention — never let leads expire.
- [ ] Treat JSONL as append-only and dedupe by lead `id`; never rewrite or delete lines.
- [ ] Keep `score_reasons` on every row so a human can audit a tier.
- [ ] Resolve the per-client token via the `<SLUG>` env var first, not the global token.
- [ ] Prefer a real-time `leadgen` webhook over polling when lead volume is high.

### Must Avoid
- Hardcoding a global token in a multi-client setup.
- Re-fetching leads already stored (waste + rate-limit risk).
- Auto-deleting or "cleaning" junk-tier leads — flag only, never drop.
- Treating a missing field as malformed (absence ≠ invalid).

### Output Checklist (verify before delivery)
- [ ] `leads_export.csv` columns = base columns + union of all normalized field keys.
- [ ] `leads_state.json` updated with a fresh `last_synced` per processed form.
- [ ] Summary reports `new_leads`, `total_stored`, and `tier_counts`.
- [ ] Per-form errors surfaced in `results[]`, not swallowed.

## Error Handling

| Scenario | Action |
|----------|--------|
| `client_profile.json` missing | Exit 2 with the path — never guess |
| `accounts.facebook_page_id` is TBD/empty | Exit 3; route client through `/setup-accounts` |
| No Page token in env | Exit 4 naming the exact `META_PAGE_TOKEN_<SLUG>` var to set |
| Token expired/invalid (code 190/102/463/467) | `TokenExpiredError` (non-retryable) — prompt re-auth, do not hammer |
| Rate limit / 5xx / network blip | `createGraph` retries with backoff+jitter; honors `Retry-After` |
| Lead expired / form-level error (e.g. code 100) | Recorded as `{ form_id, error }` in `results[]`; other forms continue |
| No active forms | Emit `{ note: "no active forms" }` and exit 0 |
| Unknown mode | Exit 1 with usage |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (guarded client, retry, pagination, `isTbd`), `scripts/lib/load-env.js`, `scripts/lib/tokens.js` (token resolution pattern).
- **Runtime:** Node 18+ (ESM); reads/writes under `clients/{slug}/`.
- **External APIs:** Meta Graph API **v25.0** — Lead Ads retrieval (rate limits + retention in `references/api-reference.md`).
- **Secrets:** Page token resolved from env (`META_PAGE_TOKEN_<SLUG>` / `META_PAGE_TOKEN`); never hardcoded, never logged. Lead PII (email/phone/name) stays in local `clients/{slug}/` files — do not echo lead bodies to shared logs.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Lead Ads guide | https://developers.facebook.com/docs/marketing-api/guides/lead-ads/ | End-to-end lead-ads flow |
| Retrieving Leads | https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/ | `GET /{form_id}/leads`, `GET /{lead_id}`; 90-day retention |
| Page leadgen_forms edge | https://developers.facebook.com/docs/graph-api/reference/page/leadgen_forms/ | `GET /{page_id}/leadgen_forms` |
| Lead Ads webhooks | https://developers.facebook.com/docs/marketing-api/guides/lead-ads/quickstart/webhooks-integration | Real-time `leadgen` webhook (preferred over polling) |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | Codes 4/17/613; usage headers |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Scoring rubric + weights, tier floors, disposable-domain taxonomy, field-name taxonomy, formulas, good/bad lead examples |
| `references/api-reference.md` | Exact endpoints, fields, `v25.0`, 90-day retention, rate-limit codes, webhook vs polling, cited URLs |
| `references/io-contract.md` | Full JSON/JSONL/CSV schemas, state-file shape, exit codes, example payloads, edge-case handling |
