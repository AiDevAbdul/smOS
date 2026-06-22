---
name: inbox
description: Use this skill when the user asks to triage, read, or reply to comments, DMs, or mentions for a client across Facebook and Instagram (typically via `/inbox {slug}`). It pulls FB + IG comments, DMs, and mentions into one normalized, deduped queue with first-reply-SLA and conversation-depth tracking, drafts voice-aware replies, and writes `clients/{slug}/inbox.json`. Replies are drafted, never auto-sent unless an approval record is on file. Runs offline-safe when no token or `SMOS_OFFLINE=1`.
---

# /inbox — Unified Social Inbox (Phase 2.1 / 2.3)

Pull every inbound Facebook + Instagram interaction — comments, DMs, and mentions — into
one normalized queue, dedupe on a stable id, track first-reply SLA and thread depth, and
draft (never auto-send) replies. The result is `clients/{slug}/inbox.json`: the single
read+reply surface the portal and reply tooling both consume.

## What This Skill Does

- Resolve a per-client page token via `scripts/lib/tokens.js`; halt cleanly if none.
- Pull FB DMs (`/{page}/conversations`), FB Page comments (`/{page}/feed`), IG DMs, IG
  comments (`/{ig}/media`), and IG mentions (`/{ig}/tags`) through the guarded Graph client.
- Normalize every interaction to one `schemas/inbox_item.js` shape, deduped on `inbox_id`.
- Compute `first_reply_due_at` (received + SLA, default 60 min) and flag SLA breaches.
- Compute `reply_latency_seconds` and `thread_depth` for replied/threaded items.
- Draft voice-aware replies into `draft_reply` — never sent by this run.
- Upsert items to Supabase `inbox_items` (on `inbox_id`) when configured.
- Run offline-safe: with no token or `SMOS_OFFLINE=1`, normalize an existing `inbox.json`.

## What This Skill Does NOT Do

- **Does not publish posts or stories** — `/publish` owns content publishing.
- **Does not auto-send replies.** `send_message` requires passing
  `inboxItem.validateReply(item, { allowAuto })`; auto-send needs an `approvals.js` record.
- **Does not moderate Threads** — only `facebook` + `instagram` are pulled here.
- **Does not do social listening / competitor benchmarking** — `/listening` owns that.
- **Does not score sentiment at scale or build content** — `/content-plan`, `/creative`.

## Before Implementation

Gather context before acting (do not ask the user for what is discoverable):

| Source | Gather |
|--------|--------|
| **Codebase** | `schemas/inbox_item.js`, `scripts/lib/tokens.js`, `scripts/lib/meta-graph.js`, `scripts/lib/approvals.js`, `scripts/lib/supabase.js` |
| **Conversation** | Which `{slug}`; any custom SLA the user stated; reply-tone instructions |
| **Skill References** | SLA/taxonomy/voice rules from `references/` (see table below) |
| **Client Profile** | `clients/{slug}/client_profile.json` — `accounts.facebook_page_id`, `accounts.instagram_business_id`, voice rules; per-client `CLAUDE.md` overrides |

## Clarifications

> Before asking: check the conversation, the client profile, and any existing `inbox.json`.
> Only ask for what cannot be determined. Domain knowledge (SLA defaults, item taxonomy,
> reply voice) lives in `references/` — never ask the user for it.

**Required (must resolve before running):**
1. Which client `{slug}` to triage.

**Optional (ask only if relevant):**
2. A non-default first-reply SLA in minutes (default 60; passed as `--sla-minutes=N`).
3. Whether to enable approved auto-replies (otherwise every send stays human-gated).

## Workflow

1. Resolve the per-client page token (`resolveToken("page", slug)`); halt if none and
   not offline — never reply from the wrong page.
2. Pull FB DMs + comments and IG DMs + comments + mentions through `createGraph(token)`;
   each surface is wrapped in try/catch so one failing edge does not abort the queue.
3. Normalize all raw items via `schema.normalize` → one shape, deduped on `inbox_id`.
4. Compute SLA: set `first_reply_due_at` = `received_at` + `sla-minutes`; compute
   `reply_latency_seconds` for replied items; count breaches.
5. Draft voice-aware replies into `draft_reply`. Do not send.
6. Validate with `schema.validate` (warnings only), write `inbox.json`, upsert Supabase.
7. To send a reply later: `inboxItem.validateReply(item, { allowAuto })` must pass —
   auto-send requires an `approvals.js` record; otherwise a human approves each send.

## Input / Output Specification

**Inputs:** CLI `node skills/inbox/inbox.js <slug> [--sla-minutes=N]`; reads
`clients/{slug}/client_profile.json`; token via env `META_PAGE_TOKEN_<SLUG>` or
`accounts.page_token`; flags `SMOS_OFFLINE=1`. Exit codes: `2` no slug, `3` no profile.
**Outputs:** `clients/{slug}/inbox.json` (`schemas/inbox_item.js` shape `{ client_slug, items[] }`);
best-effort upsert to Supabase `inbox_items` (key `inbox_id`); stdout one-line summary.
(Full schemas + example payloads: `references/io-contract.md`.)

## Variability Analysis

| What VARIES (per client / run) | What's CONSTANT (encoded in skill) |
|--------------------------------|------------------------------------|
| Page/IG account ids, page token | `inbox_id` = `platform:type:external_id` dedupe key |
| First-reply SLA minutes (`--sla-minutes`) | Default SLA 60 min; SLA = received + minutes |
| Reply voice / tone, language | Fail-closed send gate (`validateReply`) |
| Volume of comments/DMs/mentions | Item taxonomy + state enums (`schemas/inbox_item.js`) |
| Whether auto-reply is approved | Graph API v25.0, retry/guard chokepoint |

## Domain Standards

### Must Follow
- [ ] Resolve a per-client page token; halt if missing (offline mode excepted).
- [ ] Dedupe every item on `inbox_id` so re-pulls upsert, never duplicate.
- [ ] Stamp `first_reply_due_at` on every item lacking one.
- [ ] Keep replies as `draft_reply` only; require `validateReply` before any send.
- [ ] Wrap each Graph edge in try/catch — one failure must not drop the whole queue.

### Must Avoid
- Sending any reply from the global token without `global_fallback` being surfaced.
- Auto-sending when `auto_reply` is set but no approval exists (fail-closed).
- Replying to a RESPONSE-type DM outside the 24-hour messaging window.
- Hardcoding account ids, tokens, or SLA — resolve from profile/env/flags.

### Output Checklist (verify before delivery)
- [ ] `inbox.json` validates against `schemas/inbox_item.js` (no validation errors).
- [ ] Every item has a unique `inbox_id` and a `state` in the allowed enum.
- [ ] SLA breach count reported; `first_reply_due_at` present on all items.
- [ ] No `draft_reply` was sent; token source logged (and flagged if global fallback).

## Error Handling

| Scenario | Action |
|----------|--------|
| No `{slug}` argument | Exit code `2` with usage string — never guess a client |
| `client_profile.json` missing | Exit code `3`, "run /intake first" — do not fabricate |
| No page token (live mode) | Print note, fall back to normalizing existing `inbox.json` only |
| Single Graph edge fails | Log `"<edge> pull failed: <msg>"`, continue other edges |
| Meta API error | Logged with code/type/`fbtrace_id` by `meta-graph.js`; rate limits retried, code 190 surfaced non-retryable |
| Schema validation warnings | Print warnings to stderr, still write `inbox.json` (non-fatal) |
| Supabase unavailable | Skip persist with a note; local `inbox.json` is source of truth |
| Auto-send without approval | `validateReply` returns errors — send blocked (fail-closed) |

## Dependencies & Security

- **Reuses:** `schemas/inbox_item.js`, `scripts/lib/tokens.js`, `scripts/lib/meta-graph.js`
  (`createGraph`, guard + retry chokepoint), `scripts/lib/approvals.js`, `scripts/lib/supabase.js`,
  `scripts/lib/load-env.js`.
- **External APIs:** Meta Graph API **v25.0** — Pages, Messenger/IG messaging, IG media/tags
  (rate limits + endpoints in `references/api-reference.md`).
- **Secrets:** per-client page token resolved via `scripts/lib/tokens.js` (env
  `META_PAGE_TOKEN_<SLUG>` or `accounts.page_token`); `appsecret_proof` computed inside
  `meta-graph.js`. Never hardcoded, never logged — only the token *source* label is printed.

## Documentation & References

| Resource | URL | Use For |
|----------|-----|---------|
| Pages API — Posts/feed | https://developers.facebook.com/docs/pages-api/posts/ | `/{page}/feed` comments via Page token |
| Page `/feed` edge | https://developers.facebook.com/docs/graph-api/reference/page/feed/ | Comment fields on Page posts |
| Page node | https://developers.facebook.com/docs/graph-api/reference/page/ | Page fields, retrieve `access_token` |
| IG Media Insights/comments | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/ | IG media + comment fields |
| Handle Errors (Graph API) | https://developers.facebook.com/docs/graph-api/guides/error-handling/ | Error codes, `fbtrace_id`, recovery |
| Graph API Rate Limits | https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | App/user/page limits; codes 4/17/32/613 |
| Versions list | https://developers.facebook.com/docs/graph-api/changelog/versions/ | Confirm v25.0 is current |

For patterns not covered here, fetch the official docs above, then apply the same
conventions. See also `skills/references-shared.md` for the canonical doc-URL map.

**Last verified:** 2026-06-22

## Reference Files

| File | When to Read |
|------|--------------|
| `references/domain-standards.md` | SLA thresholds, item/state taxonomy, dedupe + latency formulas, good/bad reply examples, voice rules |
| `references/api-reference.md` | Exact Graph edges, fields, v25.0 version, messaging-window rule, rate-limit codes/headers |
| `references/io-contract.md` | Full `inbox_item` JSON schema, example `inbox.json`, Supabase row shape, edge-case handling |
