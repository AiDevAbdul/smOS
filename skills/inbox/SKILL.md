---
name: inbox
description: Use this skill when the user asks to triage, read, or reply to comments/DMs/mentions for a client (`/inbox {slug}`). Pulls Facebook + Instagram comments, DMs, and mentions into one normalized queue with reply-SLA tracking, and prepares (but never auto-sends) replies.
---

# /inbox — Unified Social Inbox (Phase 2.1 / 2.3)

The biggest table-stakes organic gap. One read+reply queue across FB + IG comments,
DMs, and mentions, with conversation-depth and first-reply-SLA tracking. Replies are
**drafted, not auto-sent** unless an approval is on file.

## Required Context

- `clients/{slug}/client_profile.json` — `accounts.facebook_page_id`, `instagram_business_id`
- A **per-client page token**: `META_PAGE_TOKEN_<SLUG>` env, or `accounts.page_token` in the
  profile (resolved by `scripts/lib/tokens.js`). The global token is a multi-client foot-gun
  and only used as a last resort.

## MCP tools used

- `get_conversations`, `get_messages`, `send_message`, `get_mentions` (this server, `inbox.js`)
- `moderate_comments` (list/reply) from `publishing.js` for the comment half

## Output (canonical contract)

- `clients/{slug}/inbox.json` — `schemas/inbox_item.js` shape: `{ items[] }`, each item a
  unified comment/DM/mention with `state`, `reply_latency_seconds`, `thread_depth`,
  `first_reply_due_at`, and an optional `draft_reply`.
- Best-effort persist to Supabase `inbox_items` (upsert on `inbox_id`, so re-pulls dedupe).

## Workflow

1. Resolve the per-client page token (halt if none — never reply from the wrong page).
2. Pull comments (`moderate_comments` list), DMs (`get_conversations` → `get_messages`),
   and mentions (`get_mentions`).
3. Normalize every interaction through `inboxItem.normalizeItem` → one shape, deduped on `inbox_id`.
4. Compute SLA: `first_reply_due_at` = received + first-hour SLA; flag breaches.
5. Draft replies into `draft_reply` (voice-aware). Do **not** send.
6. To send: `inboxItem.validateReply(item, { allowAuto })` must pass — auto-send requires
   an approval record (`scripts/lib/approvals.js`, action `auto_reply_enabled`). Otherwise a
   human approves each `send_message`.

## Safety

- Fail-closed: missing token → halt before any read/write.
- `send_message` itself refuses RESPONSE-type sends outside the 24h messaging window.
- No reply leaves the process without passing `validateReply`.
