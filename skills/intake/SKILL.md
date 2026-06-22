---
name: intake
description: Use this skill to onboard a new smOS client — run new-client intake and materialize their profile + per-client constitution (typically via `/intake`). This skill should be used when the user asks to onboard a client, run new-client intake, or set up a new account. It runs a conversational 9-group Q&A, writes `clients/{slug}/client_profile.json` and `clients/{slug}/CLAUDE.md` via `intake.js`, hydrates from a prior `/pre-audit`, detects account currency/timezone, and routes established vs zero-start clients to the right next step.
---

# /intake — Client Onboarding (Phase 1 entry)

Onboarding turns a raw conversation into the two artifacts every downstream smOS skill reads: a normalized `client_profile.json` and a per-client `CLAUDE.md` constitution. The Q&A is conversational (Claude runs it); the deterministic materialization (slug, schema validation, currency detection, template fill, zero-start routing) is done by the companion `intake.js`. Get this right and the whole pipeline inherits correct IDs, KPIs, voice rules, and approval gates.

## What This Skill Does

- Runs a 9-group conversational Q&A from `templates/intake-questions.md` (one question at a time).
- Hydrates known fields from a prior `/pre-audit` (`prospects/{slug}/page_audit.json`) so the user is asked to confirm, not re-type.
- Derives the canonical `{slug}`, scaffolds `clients/{slug}/intake_answers.json`, then builds the profile from it.
- Detects account `currency` + `timezone` from the Meta Graph API when a real `ad_account_id` is supplied.
- Writes `clients/{slug}/client_profile.json` (schema-normalized) and `clients/{slug}/CLAUDE.md` (template-filled).
- Classifies the client as **established** (`status: active`) or **zero-start** (`status: planning` + `blockers_before_live`) and emits the correct next-step routing.
- Inserts/updates the row in the Supabase `clients` table (via the MCP Supabase connector).

## What This Skill Does NOT Do

- Pull live account/page metrics or build a baseline — that is `/audit` (and `/audit-creative`).
- Create any Meta assets (Page, IG, ad account, pixel) — zero-start clients go through `/setup-accounts` and `/setup-web`.
- Build brand identity (positioning, name, logo, guidelines) — that is `/brand-strategy` → `/brand-name` → `/brand-visual` → `/brand-book` → `/brand-social`.
- Generate proposals, contracts, or invoices — those are `/proposal`, `/contract`, `/billing`.
- Run the pre-sale prospect audit — that is `/pre-audit` (intake only *consumes* its output).

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable). The last column marks whether the answer is **user-only** (must be asked) or **codebase-derivable** (read it, do not ask):

| Source | Gather | User-only or derivable |
|--------|--------|------------------------|
| **Codebase** | `skills/intake/intake.js`, `schemas/client_profile.js` (normalize/validate), `templates/intake-questions.md`, `templates/client-claude.md`, `scripts/lib/meta-graph.js` (`isTbd`, `createGraph`), `scripts/lib/guards.js` (`checkZeroStartPrereqs`) | Derivable — slug rule, defaults, validation, currency detection all live here |
| **Conversation** | Business name, niche, any IDs or KPI targets the user already stated | Derivable from transcript before re-asking |
| **Prior handoff** | `prospects/{slug}/page_audit.json` + most recent Supabase `prospect_audits` row (auto-hydrated by `intake.js`) | Derivable — `init` hydrates name/page/IG/competitors/geo |
| **Skill References** | Q&A taxonomy, JSON schema, and routing rules in `references/` (table below) | Derivable — embedded expertise, never ask the user |
| **Global constitution** | KPI fallbacks in root `CLAUDE.md` → *Global KPI Thresholds* | Derivable — inherited when the user gives no targets |
| **User (interview)** | Business facts: product, model, USP, audience, voice, real account IDs, KPI targets, history, competitors, assets, approvals | **User-only** — the 9-group Q&A; cannot be inferred |

## Clarifications

> Before asking: check the conversation, `prospects/{slug}/page_audit.json`, and any hydrated answers. Only ask for what cannot be determined. Domain knowledge (slug rules, taxonomies, defaults) lives in `references/` — never ask the user for it.

**Required (must resolve before running `build`):**
1. Business name (drives the slug) and the four `business` essentials: product description, business model, USP.
2. For an **established** client only: a real `accounts.ad_account_id` (format `act_<id>`). Zero-start clients legitimately have none.

**Optional (ask only when its trigger applies — one field per line, never bundle):**
3. Pixel ID — ask only if the client is **established** and runs conversion campaigns; skip for zero-start (`/setup-accounts` fills it).
4. Facebook Page ID / IG business ID — ask only if not already hydrated from `/pre-audit`; skip for zero-start.
5. Business Manager (BM) ID — ask only if the client manages assets under a BM and wants it recorded; otherwise leave null.
6. Target CPA — ask only if the client states a cost goal; omit to inherit the global `3× target` rule.
7. Target ROAS — ask only if the business is **e-commerce / DTC**; lead-gen and service businesses skip it.
8. Monthly budget range — ask only if planning spend pacing now; omit to leave null.
9. Restricted words — ask only if the brand bans specific terms (e.g. `cheap`, `guaranteed`, competitor names); else `[]`.
10. CTA style — ask only if the client has a preference (direct / soft / curiosity); else null.
11. Approval channel + daily cap — ask only to override the defaults (`discord`, `$500`); else inherit.
12. Competitors — ask only if not hydrated from `/pre-audit`; skip if the prospect audit already supplied 3.
13. Asset formats / brand guidelines URL / brand colors — ask only if the client has assets ready to declare; else `[]` / null.

## Workflow

1. Derive a candidate slug from the business name; run `node skills/intake/intake.js init <slug>` to scaffold `clients/{slug}/intake_answers.json` (auto-hydrates from `/pre-audit` if present and reports `hydrated_fields`).
2. Confirm any hydrated fields in one batch; do not re-ask them.
3. Run the 9-group Q&A from `templates/intake-questions.md` verbatim, **one question at a time**, parsing each answer into its slot in `intake_answers.json`. Never batch all 9 groups — that yields shallow answers. On an ambiguous answer, ask exactly one clarifying follow-up.
4. For skipped questions, leave the slot `null` / `[]` — never guess.
5. Run `node skills/intake/intake.js build <slug>` (add `--answers <path>` for a non-default file). This validates, detects currency/timezone, normalizes, and writes both artifacts.
6. Read the JSON the script prints (`status`, `zero_start`, `blockers_before_live`, `skipped_fields`, `next`). Surface skipped fields to the user.
7. Insert/update the Supabase `clients` row (columns: `slug`, `name`, `profile`, `kpis`, `account_ids`, `voice`, `status`).
8. Recommend the next step per `next`: established → `/audit`; zero-start → Phase 0 (`/brand-strategy` … `/setup-web`).

## Input / Output Specification

**Inputs:** `clients/{slug}/intake_answers.json` (built interactively); optional `--answers <path>`; optional hydration source `prospects/{slug}/page_audit.json`; env-resolved Meta token for currency detection.
**Outputs:** `clients/{slug}/client_profile.json`, `clients/{slug}/CLAUDE.md`, `clients/{slug}/baseline/pre_audit.html` (if a prospect artifact was archived), Supabase `clients` row, and a JSON status object on stdout.
(Full schemas, example payloads, and edge cases: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Business name, niche, USP, audience, pain points | The 9-group Q&A order + question wording (`intake-questions.md`) |
| Account IDs, currency, timezone | Slug rule: lowercase, alphanumeric, hyphen-collapsed |
| KPI targets, budget range | Global KPI fallbacks (CPA 3×/$50, ROAS<1.0/$100, scale 3.0×3d, CTR<0.5%/$30, freq>4.0) |
| Established vs zero-start | Zero-start detection + `planning`/`active` status logic |
| Restricted words, voice, approvals | Canonical profile schema + alias mirroring (`client_profile.js`) |

## Domain Standards

### Must Follow
- [ ] Ask the Q&A one question at a time, group by group — never dump all 9 groups at once.
- [ ] Use the exact slug rule and confirm it before writing files.
- [ ] Detect currency/timezone from Meta when (and only when) `ad_account_id` is real (not `TBD_*`).
- [ ] Write canonical IDs (`facebook_page_id`, `instagram_business_id`) and let the schema mirror legacy aliases.
- [ ] Default zero-start clients to `status: planning` with a `blockers_before_live` list — never block onboarding on missing account IDs.

### Must Avoid
- Guessing any unanswered field — store `null` / `[]` and report it as skipped.
- Hardcoding KPI numbers into the profile when the user gave none — inherit global defaults via the template.
- Forcing a zero-start client into `/audit` before Phase 0 builds their accounts.

### Output Checklist (verify before delivery)
- [ ] `client_profile.json` validates against `schemas/client_profile.js` (slug + accounts present/normalized).
- [ ] `CLAUDE.md` has no leftover unfilled `_*_TBD_` tokens for fields the user actually answered.
- [ ] `status` + `next` match the established/zero-start branch.
- [ ] Skipped fields surfaced to the user; Supabase row inserted.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing required field (`name`/`business.*`/`accounts.ad_account_id` for established) | `build` exits `3` and lists `missing:<field>` — collect the field, never guess |
| Answers file not found | `build` throws `Answers file not found` — run `init` first or pass `--answers` |
| `init` answers file already exists | Exits `2` — do not overwrite; edit the existing file or pick a new slug |
| Meta API error during currency detection | Logged as `WARN`; build continues with provided/default `USD`/`UTC` — verify the System User token has account access |
| Token expired (Graph code 190) | Surfaced non-retryable by `meta-graph.js` — prompt re-auth, do not hammer |
| Pixel/Page ID looks invalid | Saved but flagged; does not block (verification belongs to `/audit`) |
| Existing `client_profile.json` present | Auto-backed up to `client_profile.backup.<ts>.json` before overwrite |

## Dependencies & Security

- **Reuses:** `schemas/client_profile.js` (normalize/validate), `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, retry/guard chokepoint), `scripts/lib/guards.js` (`checkZeroStartPrereqs`), `scripts/lib/load-env.js`, `templates/intake-questions.md`, `templates/client-claude.md`.
- **Runtime:** Node.js ES modules; `axios` (transitively via `meta-graph.js`). Supabase write goes through the MCP connector.
- **External APIs:** Meta Graph API **v25.0** (read-only `GET /act_<id>?fields=currency,timezone_name,...`). Rate limits in `references/api-reference.md`.
- **Secrets:** Meta token resolved via env / `scripts/lib/tokens.js` — never hardcoded, never logged. Profile JSON may contain account IDs but no tokens.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Ad Account node (fields) | https://developers.facebook.com/docs/marketing-api/reference/ad-account/ | `currency`, `timezone_name`, `account_status`, `name` read for detection |
| Graph API versioning | https://developers.facebook.com/docs/graph-api/guides/versioning/ | Confirm v25.0 pin + lifecycle |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, code 190 token handling |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | `X-App-Usage` / BUC headers; codes 4 / 17 / 613 |

For patterns not covered here, fetch the official docs above, then apply the same conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Fetch guidance — good vs bad:** when a returned `currency`/`timezone_name` value or error code is unclear, fetch the *Ad Account node* page and read the field/enum definition.
- Good: fetch `.../reference/ad-account/`, confirm `account_status: 1` means ACTIVE, map it. Full good/bad worked examples live in `references/domain-standards.md` §6.
- Bad: guess that `account_status: 2` is fine and proceed, or invent a `target_cpa` the user never stated.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Slug rules, the 9-group Q&A taxonomy + answer mapping, KPI defaults, zero-start routing, good/bad intake examples |
| `references/api-reference.md` | The exact Meta Ad Account read (endpoint, fields, version, rate limits, error codes) used for currency/timezone detection |
| `references/io-contract.md` | Full `intake_answers.json` + `client_profile.json` schemas, `intake.js` CLI/exit-code contract, stdout shape, example payloads, edge cases |
