---
name: smos-status
description: Use this skill to check where a client or prospect currently stands across the smOS pipeline — what's done, what's missing, and what to run next. This skill should be used when the user asks for a client's status, progress, "what's left," or a pipeline checklist, typically via `/smos-status {slug}`. It is a read-only, deterministic file-existence + gate check across the CRM stage, Phase 0 zero-start gates, and the main audit→launch→analyze pipeline — no Meta API calls, no writes.
---

# /smos-status — Client Pipeline Status Check

A single, always-current answer to "where is `{slug}` right now, and what's next?" It walks the CRM deal, the Phase 0 zero-start gates (for clients still onboarding), and the main paid/organic pipeline, checking on-disk artifacts against the constitution's routing table (`CLAUDE.md`) rather than asking anyone to remember it.

## What This Skill Does

- Runs `skills/smos-status/status.js <slug>`, a read-only checker with zero API calls.
- Reports **Agency/CRM**: `crm/pipeline.json` deal stage, proposal/contract/billing links.
- For a materialized client, reports **Phase 0**: the three human gates (positioning, name+trademark, logo) plus brand-book/social/setup-accounts/setup-web/capi-setup.
- Reports the **Main Pipeline**: audit → audit-creative → research → audience-map → strategy-brief (flags "written but not approved" distinctly from "missing") → creative → launch → analyze → report.
- Reports **Organic**: content-plan → publish.
- Computes one `next_action`: the earliest incomplete step, in pipeline order — the single next command to run.

## What This Skill Does NOT Do

- Does not call the Meta Graph API or check live account state — that's `/audit` and `/analyze`. This skill only checks whether their *output files* exist.
- Does not advance any gate, stage, or file — pure read. To move something forward, run the skill named in `next_action`.
- Does not replace `/crm show {slug}` for full deal detail (activities, next_action_due, contact) — it only surfaces the deal's stage and doc links. Use `/crm show` for the full CRM record.

## Before Implementation

| Source | Gather |
|--------|--------|
| **Codebase** | `skills/smos-status/status.js`, `scripts/lib/paths.js` (canonical file map), `schemas/deal.js` (`STAGES`), `schemas/brand_profile.js` (the 3 gates) |
| **Conversation** | The `{slug}` to check |
| **Constitution** | `CLAUDE.md` routing table + Zero-Start Onboarding order, so `next_action` is explained in terms the user already sees there |

## Clarifications

**Required:**
1. Which `{slug}`? (Works for either a `clients/{slug}/` or a CRM-only `prospects/{slug}/` entry — no client dir is required.)

## Workflow

1. Run `node skills/smos-status/status.js {slug}`.
2. Read the JSON: `is_client`, `is_zero_start`, `crm_stage`, `sections[]` (each with `steps[]` of `{id, label, status, detail}`), and `next_action`.
3. Render a checklist to the user, grouped by section, using ✅ done / 🔲 missing / 🚧 blocked (the `strategy-brief` gate can report `blocked` when the file exists but lacks human approval).
4. Close with one line: **Next:** `<next_action.step>` — `<next_action.detail>`, naming the skill/slash-command to run.
5. If `sections` is just `[{"agency": ...}]` (no `phase0`/`pipeline`/`organic`), the slug is CRM-only (no `clients/{slug}/profile.json` yet) — say so plainly rather than implying more happened.

## Input / Output Specification

**Inputs:** CLI arg `<slug>`. Reads (never writes): `crm/pipeline.json`, `clients/{slug}/profile.json`, `brand_profile.json`, `data/*.json` (via `clientFile()`), `deliverables/*/`, `reports/*/`, `billing/{slug}/ledger.json`.
**Outputs:** one JSON object on stdout — `{slug, is_client, is_zero_start, crm_stage, sections[], next_action}`. Nothing is written to disk.

## Variability Analysis

| What VARIES (per client) | What's CONSTANT (encoded in skill) |
|---------------------------|-------------------------------------|
| Which sections apply (CRM-only prospect vs. zero-start vs. established client) | The pipeline order and canonical file map (`scripts/lib/paths.js`) |
| Which steps are done/missing | Gate semantics (a stamped `*_approved_at` timestamp = done; a placeholder id = missing) |

## Domain Standards

### Must Follow
- [ ] Treat a strategy brief that exists but has no `approved_at` as `blocked`, not `done` — `/launch` genuinely can't proceed on it.
- [ ] Use `scripts/lib/paths.js` (`clientFile`, `clientDeliverableDir`, etc.) for every path — never hardcode a filename, so the checker stays correct if the canonical layout changes.

### Must Avoid
- Do not infer completion from a file's presence alone when the file could be stale — an existing `baseline_snapshot.json` still counts as "audit done" (that's the intended immutable-baseline contract), but never claim a *gate* is cleared without its timestamp field set.

### Output Checklist (verify before delivery)
- [ ] Every section the JSON returned is rendered — no silently dropped section.
- [ ] `next_action` is stated as one concrete next command, not a vague "keep going."

## Error Handling

| Scenario | Action |
|----------|--------|
| No CRM deal and no client dir for `{slug}` | Report "nothing on file for this slug" — do not guess a stage |
| `crm/pipeline.json` missing/unparseable | Treat as empty pipeline (no deal found), continue with client-side checks |

## Dependencies & Security

- **Reuses:** `scripts/lib/paths.js`, `schemas/deal.js` (STAGES reference only)
- **External APIs:** none
- **Secrets:** none required — pure filesystem read

## Documentation & References

See `CLAUDE.md` §Workflow Routing and §Zero-Start Onboarding for the authoritative skill order this checker mirrors.
