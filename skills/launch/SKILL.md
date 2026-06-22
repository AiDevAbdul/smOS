---
name: launch
description: Use this skill to build a client's Meta campaign/adset/ad tree from an approved strategy brief, ad copy, and audience map — everything created PAUSED, behind a fail-closed approval + plan-validation gate. This skill should be used when the user asks to launch a campaign, push a brief live, or build the campaign structure on Meta (typically via `/launch {slug}`), or when an upstream skill hands off an approved brief ready to ship.
---

# /launch — Campaign Build & Push (Phase 4)

Turn an approved `strategy_brief.json` + `ad_copy.json` + `audience_map.json` into a real
Meta campaign → adset → ad tree via `skills/launch/launch.js`. Defaults to a DRY RUN that
writes an inspectable `launch_plan.json`; `--execute` creates everything PAUSED. Activation
to ACTIVE is a separate, human-confirmed step — the engine never flips status on its own.

## What This Skill Does

- Build a deterministic launch plan: one campaign per budgeted audience, one adset per
  campaign, one ad per creative angle (names enforced to convention).
- Map brief objectives to Meta `OUTCOME_*` enums, optimization goals, placements, and
  attach a pixel `promoted_object` for sales objectives.
- Resolve retargeting/lookalike specs to real custom-audience IDs (`--create-audiences`
  opts into creating missing ones); upload + attach a creative image/video per angle.
- Validate the plan fail-closed (approved brief, real account, naming, resolved copy, no
  `<TBD_>` audiences) before any live write; create all entities PAUSED on `--execute`.
- Write `launch_plan.json` (always) and `campaign_log.json` (on execute); print a JSON summary to stdout.

## What This Skill Does NOT Do

- Does NOT generate copy — `/creative` owns `ad_copy.json`.
- Does NOT build the audience plan or resolve interest IDs into a map — `/audience-map`.
- Does NOT author or approve the strategy — `/strategy-brief` owns the approval gate.
- Does NOT activate, scale, or pause for performance — activation is the human Discord step; `/scale` owns optimization.
- Does NOT measure results — `/analyze` and `/report`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `scripts/lib/meta-graph.js` (guarded chokepoint, `API_VERSION` v25.0), `scripts/lib/audience-resolver.js`, `scripts/lib/launch_media.js`, `schemas/launch_plan.js` |
| **Conversation** | Whether the user wants dry-run vs `--execute`, a specific `--phase`, or `--create-audiences` |
| **Skill References** | Objective/placement maps and the gate ladder in `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` (`accounts.*`, `location.country`) + per-client `CLAUDE.md` KPI/budget overrides |
| **Handoffs** | `clients/{slug}/strategy_brief.json`, `ad_copy.json`, `audience_map.json` |

## Clarifications

> Before asking: check the conversation, the client profile, and the three handoff files.
> Only ask for what cannot be determined. Domain maps (objectives, placements, gate ladder)
> are embedded in `references/` — never ask the user for them.

**Required (must resolve before running):**
1. Which client `{slug}`?
2. Run intent: dry-run preview (default) or live `--execute`?

**Optional (ask only if relevant):**
3. Limit to one `--phase A|B|C`? (default: first/live phase only)
4. Create missing custom audiences (`--create-audiences`)? This is a consequential write — default off.

## Workflow

1. Confirm the three handoffs exist; if not, halt naming which `/skill` produces each.
2. Run dry-run: `node skills/launch/launch.js {slug}`. Read `launch_plan.json` and the summary.
3. Resolve any `naming_issues`, `copy_used: null`, or `<TBD_>` audiences at the source skill, then re-run dry.
4. When the brief is `approved` and the plan is executable, run `node skills/launch/launch.js {slug} --execute` (add `--create-audiences` only if intended).
5. Surface `campaign_log.json` (created tree + errors). Tell the user to reply `activate` in Discord to flip PAUSED → ACTIVE — do not activate from this skill.

## Input / Output Specification

**Inputs:** CLI `node skills/launch/launch.js <slug> [--execute] [--phase A|B|C] [--create-audiences]`; reads `clients/{slug}/{client_profile,strategy_brief,audience_map,ad_copy}.json`; env `META_ACCESS_TOKEN` (+ `META_APP_SECRET` for proof) on `--execute`.
**Outputs:** `clients/{slug}/launch_plan.json` (always), `clients/{slug}/campaign_log.json` (on execute), JSON summary on stdout, diagnostics on stderr. May rewrite `audience_map.json` with `resolved_audiences`.
(Full schemas, exit codes, and example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill/code) |
|--------------------------------|------------------------------------------|
| Objectives, budgets, audiences, copy, geo, country, account IDs | Naming regexes; `OUTCOME_*`→code/goal/placement maps; PAUSED default; 7d-click/1d-view attribution; `LOWEST_COST_WITHOUT_CAP`; `special_ad_categories: []` |
| Creative assets per angle (image/video/none) | Asset-resolution + attach logic; link-only fallback |
| RT/LAL specs present or not | Audience-resolution + fail-closed `<TBD_>` rejection |

## Domain Standards

### Must Follow
- [ ] Create every campaign/adset/ad with `status: "PAUSED"`.
- [ ] Names match convention: campaign `[OBJ]_[AUD]_[YYYYMM]`, adset `[PLCMT]_[AGES]_[CODE]`, ad `[FMT]_[HOOK]_v[N]`.
- [ ] `--execute` only when `strategy_brief.approval.status === "approved"` and account is real (not TBD).
- [ ] Sales objective attaches `promoted_object.pixel_id`; AI-built creatives carry `ai_disclosed: true` upstream.

### Must Avoid
- Activating to ACTIVE inside this skill; auto-rolling-back partially created entities; raising budgets.
- Executing a plan with `copy_used: null` or any `<TBD_>` custom audience.
- Re-deriving structure the brief already decided; hardcoding tokens or account IDs.

### Output Checklist (verify before delivery)
- [ ] `launch_plan.json` written; `mode` and `naming_issues` reported.
- [ ] On execute: `campaign_log.json` lists created IDs and any per-stage errors.
- [ ] User told the exact `activate` next step; nothing left ACTIVE unintentionally.

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing handoff JSON | Halt (exit 2), name the file + the `/skill` that produces it |
| Brief not approved on `--execute` | Refuse (exit 3), report current `approval.status` |
| `ad_account_id` is TBD on `--execute` | Refuse (exit 4) — run `/setup-accounts` |
| Naming violation on `--execute` | Refuse (exit 5), list offending names — fix inputs |
| Plan not executable (null copy / TBD audience) | Refuse (exit 6), point to `/creative` or `/audience-map` |
| Meta API 4xx on a create | Record in `created.errors` (stage/name/fbtrace), continue siblings, NO rollback; surface in log |
| Audience resolution fails | Warn, continue — the launch_plan gate catches unresolved IDs |
| One asset upload fails | Record asset error, ship that ad link-only, continue |

## Dependencies & Security

- **Reuses:** `scripts/lib/meta-graph.js` (`createGraph`, `isTbd`, guard chokepoint), `scripts/lib/audience-resolver.js`, `scripts/lib/launch_media.js`, `scripts/lib/media_upload.js`, `schemas/index.js` (`launchPlan`, `strategyBrief`, `adCopy`, `audienceMap`, `clientProfile`).
- **External APIs:** Meta Marketing/Graph API **v25.0** (rate limits + endpoints in `references/api-reference.md`).
- **Secrets:** `META_ACCESS_TOKEN` (+ `META_APP_SECRET`) resolved from env via the graph client — never hardcoded, logged, or written to artifacts.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Create campaign edge | https://developers.facebook.com/docs/marketing-api/reference/ad-account/campaigns/ | POST `act_<id>/campaigns`: `objective`, `special_ad_categories`, `status` |
| AdSet node | https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ | `targeting`, `optimization_goal`, `billing_event`, `daily_budget`, `bid_strategy` |
| Ad node | https://developers.facebook.com/docs/marketing-api/reference/adgroup/ | `creative`, `adset_id`, `status` |
| Outcome objectives (ODAX) | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | The six `OUTCOME_*` enums |
| Basic ad creation walkthrough | https://developers.facebook.com/docs/marketing-api/get-started/basic-ad-creation/create-an-ad-campaign/ | End-to-end PAUSED-default creation |
| Marketing API rate limiting | https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/ | Ad-account limits, ads-management subcodes |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | Objective/goal/placement maps, naming taxonomy, gate ladder, good/bad plan examples |
| `references/api-reference.md` | Exact v25.0 endpoints, required fields, rate limits, error codes (cited URLs) |
| `references/io-contract.md` | Full input/output JSON schemas, exit codes, example payloads, edge cases |
