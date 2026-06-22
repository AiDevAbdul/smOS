---
name: strategy-brief
description: Use this skill when the user asks to build a campaign strategy brief, synthesize intake/audit/competitor/audience intel into a launch plan, or runs `/strategy-brief {slug}`. It synthesizes the client profile, competitor intel, audience map, and an optional audit into a deterministic objective hierarchy, budget split, audience priority, three creative angles, success metrics, and a 30-day calendar — written as `strategy_brief.json` + `.md`. It gates Phase 4: the brief requires explicit human approval (reject/revise loop) before `/launch` can run.
---

# /strategy-brief — Campaign Strategy Synthesis (Phase 3 → gates Phase 4)

Synthesize the upstream paid-pipeline artifacts into one launch-ready brief. The companion
script computes every deterministic section (budget split, audience ranking, objective
phases, success metrics, calendar) from the inputs; Claude appends qualitative phrasing and
runs the human approval gate. The brief is the single source of truth that `/creative` and
`/launch` consume.

## What This Skill Does

- Run `node skills/strategy-brief/strategy-brief.js {slug}` to produce `strategy_brief.json` + `strategy_brief.md`.
- Normalize `competitor_intel.json` + `audience_map.json` (and optional `audit_raw.json`) through their canonical schemas before reading them.
- Decide an objective hierarchy (Phase A/B/C, `OUTCOME_*` enums) from pixel health + purchase history.
- Allocate the monthly budget 60/25/15 (cold/warm/LAL) into per-adset daily budgets; flag any adset > $200/day with `needs_approval: true`.
- Rank audiences (broad → top-2 interest clusters → 2 retargeting → 1 lookalike), trimmed to top 5.
- Pick three creative angles (pain / aspiration / proof) from `competitor_intel.angles`, dropping any matching `voice.restricted_words` into `excluded_angles`.
- Stamp a stable `angle_id` on every angle and fail-closed validate the brief before writing.
- Reconcile profile vs. audit KPI conflicts into an `assumptions` list — never silently override.
- Run the human approval gate (reject/revise loop, 24h timeout) and persist the Supabase row only after `approve`.

## What This Skill Does NOT Do

- Does NOT pull competitor ads — `/research` produces `competitor_intel.json`.
- Does NOT build the audience map — `/audience-map` produces `audience_map.json`.
- Does NOT snapshot accounts — `/audit` produces the optional `audit_raw.json`.
- Does NOT write ad copy — `/creative` reads `creative_angles` and produces `ad_copy.json`.
- Does NOT create campaigns/adsets/ads on Meta — `/launch` builds the tree (PAUSED).
- Does NOT call the Meta API or any network service. Pure local synthesis.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `schemas/index.js` — verify it still exports `strategyBrief` (with `.normalize`/`.validate`), `competitorIntel`, `audienceMap`, `assertValid`, and `angleId` before relying on them; `scripts/lib/load-env.js` |
| **Conversation** | Slug, any budget/objective constraints, revision instructions during the approval loop |
| **Skill References** | Thresholds + taxonomies in `references/domain-standards.md`; exact JSON shapes in `references/io-contract.md`; gate mechanics in `references/approval-gate.md` |
| **Client Profile** | `clients/{slug}/client_profile.json` + per-client `CLAUDE.md` KPI overrides |

> The script imports `briefSchema.normalize/validate`, `assertValid`, and `angleId` from
> `schemas/index.js`. If the schema layer is refactored, confirm that export surface still
> exists before running — a missing export is a runtime failure, not a silent fallback.

## Clarifications

> Before asking: check the conversation, the client profile, and the upstream handoff files.
> Only ask for what cannot be determined. Domain knowledge (budget split, scoring, calendar
> shape) is embedded in `references/` and the code — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}` to brief.
2. During the approval gate: the user's explicit `approve` or `reject [reason]` decision.

**Optional (ask only if relevant):**
3. Non-default budget split or objective override (rare — defaults are deliberate).
4. Which passes to re-run on a `reject` (default: only the passes the reason touches).

## Workflow

1. Confirm `clients/{slug}/client_profile.json` exists (exit 2 if not) and that `competitor_intel.json` + `audience_map.json` exist (exit 3 names which is missing). `audit_raw.json` is OPTIONAL.
2. Run `node skills/strategy-brief/strategy-brief.js {slug}`. The script normalizes inputs, computes all sections, fail-closed validates, and writes the `.json` + `.md`.
3. Read the generated `strategy_brief.md`. Enrich the creative-angle prose and calendar narrative if thin — keep the `.json` as the authoritative structured copy and never let the two drift.
4. Present the brief for approval: `Strategy brief for {name} — reply 'approve' to lock in, or 'reject [reason]' to revise.`
5. On **reject [reason]**: capture the reason, ask what to revise, re-run only the affected passes, regenerate both files, re-present (loop to step 4).
6. On **approve**: stamp `approval.status = "approved"` with approver + timestamp, persist the `strategy_briefs` row, print `Strategy brief approved by {user}. Run /creative next.`
7. If no decision within 24h: re-ping once, then halt and surface. Never auto-approve.

## Input / Output Specification

**Inputs (CLI arg `<slug>`):**
- `clients/{slug}/client_profile.json` — REQUIRED (exit 2 if absent).
- `clients/{slug}/competitor_intel.json` — REQUIRED (exit 3 if absent).
- `clients/{slug}/audience_map.json` — REQUIRED (exit 3 if absent).
- `clients/{slug}/audit_raw.json` — OPTIONAL (profile-only assumptions when absent).

**Outputs:**
- `clients/{slug}/strategy_brief.json` — canonical structured brief (validated before write).
- `clients/{slug}/strategy_brief.md` — human-readable, rendered from the JSON.
- stdout: one-line JSON summary (`daily_total`, phase/audience/angle counts, `adsets_needing_approval`, file paths, `next`).
- Supabase `strategy_briefs` row — written by Claude AFTER approval only.

(Full schemas, field-by-field, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Monthly budget, KPI targets, conversion events | 60/25/15 cold/warm/LAL split |
| Pixel health + purchase history → objective phases | Phase A/B/C structure; `OUTCOME_*` enum set |
| Interest clusters, retargeting/lookalike specs | Audience ranking order; top-5 trim |
| Competitor angles, restricted words | Pain/aspiration/proof bucketing; angle scoring |
| Audit presence (optional) | Reconciliation rules; >30% CPA divergence flag |
| Approver, reason on reject | Approval gate, $200/day flag, 24h timeout |

## Domain Standards

### Must Follow
- [ ] Default new objective phases to `OUTCOME_*` enums (no legacy objectives).
- [ ] Allocate budget exactly 60/25/15 unless the client profile overrides.
- [ ] Stamp a stable `angle_id` on every creative angle (the join key `/creative` + `/launch` match on).
- [ ] Flag any adset daily budget > $200 with `needs_approval: true`.
- [ ] Surface every profile/audit conflict in `assumptions` — never silently override.
- [ ] Hold the approval gate; persist the Supabase row only after `approve`.

### Must Avoid
- Inventing competitor angles or audiences not present in the input artifacts.
- Letting `.md` and `.json` diverge (the `.md` is rendered from the `.json`).
- Writing a brief whose angles lack `angle_id` (the validator throws — do not bypass).
- Auto-approving on timeout or treating silence as consent.

### Output Checklist (verify before delivery)
- [ ] Both `strategy_brief.json` and `strategy_brief.md` written.
- [ ] `creative_angles` non-empty, each with a unique `angle_id` and `name`.
- [ ] Restricted-word angles appear in `excluded_angles`, not `creative_angles`.
- [ ] Approval status reflects the real user decision; Supabase row only after `approve`.

## Error Handling

| Scenario | Action |
|----------|--------|
| No slug arg | Print usage, exit 1 |
| `client_profile.json` missing | Print path, exit 2 — never guess profile fields |
| `competitor_intel.json` or `audience_map.json` missing | Print which one + the skill that produces it, exit 3 |
| `audit_raw.json` missing | Proceed; add a profile-only note to `assumptions` (NOT an error) |
| Upstream artifact present but structurally invalid (e.g. `competitor_intel.json` exists yet fails `competitorSchema.normalize`/its own `validate` — malformed JSON, wrong root type, `angles` not an array) | The `normalize` step throws on unparseable JSON; a normalized-but-invalid shape surfaces empty downstream sections — inspect, fix the upstream file via its producing skill, re-run. Do NOT hand-edit the artifact to pass. |
| Brief fails schema validation (e.g. angle missing `angle_id`) | `SchemaError` thrown by `assertValid`; the `.json`/`.md` are NOT written; surface the named field |
| Profile vs. audit KPI conflict | Record both in `assumptions`, default to profile — never silently override |
| User rejects | Capture reason, re-run affected passes, regenerate, re-present |
| No approval decision in 24h | Re-ping once, then halt and surface — never auto-approve |
| Supabase write fails | Keep local files, surface error, do NOT mark the brief approved |

## Dependencies & Security

- **Reuses:** `schemas/index.js` (`strategyBrief`, `competitorIntel`, `audienceMap`, `assertValid`, `angleId`, `SchemaError`), `scripts/lib/load-env.js`.
- **Runtime:** Node.js ESM. Only external dependency is `dotenv` (loaded via `load-env`).
- **External APIs:** none — pure synthesis, no Meta/Stripe/network calls.
- **Secrets — script:** none required by `strategy-brief.js`. It performs no network I/O; `loadEnv()` is invoked but no secret is consumed during synthesis.
- **Secrets — post-approval persistence (Claude):** the `strategy_briefs` upsert uses the Supabase **service role key** read from env var **`SUPABASE_SERVICE_ROLE_KEY`** (with `SUPABASE_URL`), resolved through `scripts/lib/load-env.js` from `~/.config/smos/.env` (chmod 600) — never hardcoded, never logged, never echoed into the brief. This key bypasses RLS, so apply least privilege: scope it to the `strategy_briefs` table where possible, never expose it client-side, and rotate it on any suspected leak or staff offboarding.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Outcome objectives (ODAX) | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | The six `OUTCOME_*` enums used in the objective hierarchy |
| Campaign structure guide | https://developers.facebook.com/docs/marketing-api/campaign-structure/ | How campaign → adset → ad nest (informs the calendar plan) |
| Campaign node reference | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/ | `objective`, `bid_strategy`, `special_ad_categories` consumed by `/launch` |
| Graph API versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current for the downstream pipeline |

**Fetch vs. cache guidance (per link):**
- **Re-fetch the ODAX enums and the versions list** when adding/renaming an objective or before a launch cycle — the `OUTCOME_*` set and the current API version are the parts most likely to change. Treat anything older than the last-verified date as stale and confirm against the live page.
- **Trust the cached convention** for campaign-structure and campaign-node *field semantics* (how campaign→adset→ad nest; what `bid_strategy`/`special_ad_categories` mean) — these are stable and this skill only references them; `/launch` is the skill that actually writes those fields.
- This skill makes no API calls, so a doc drift never breaks a run here — it only affects what `/launch` later builds. Still, keep the enum list current so the brief never proposes a deprecated objective.

**Good vs. bad use of these docs:**
- GOOD: "Adding a fourth phase — fetch the ODAX page, confirm `OUTCOME_ENGAGEMENT` is still valid, then use that exact enum string in `objective_hierarchy`."
- BAD: "I recall the old objective was `CONVERSIONS`, I'll write that." (Legacy objectives were deprecated for *creation* in Marketing API v17.0 — always use the `OUTCOME_*` form from the live page.)

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Budget split, objective decision tree, audience ranking, angle scoring, success-metric defaults, calendar shape, good/bad examples |
| `references/io-contract.md` | Full JSON schemas for every input + output, example payloads, exit codes, edge-case handling |
| `references/approval-gate.md` | The human approval mechanism: reject/revise loop, 24h timeout, Discord-vs-Slack reconciliation, Supabase `strategy_briefs` row shape, security |
