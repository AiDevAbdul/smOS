# /inbox — I/O Contract

Full input/output contract for `skills/inbox/inbox.js`. The canonical shape is defined by
`schemas/inbox_item.js` (producer = this skill; consumers = portal + reply tooling). Self-contained.

## Invocation

```
node skills/inbox/inbox.js <slug> [--sla-minutes=N]
```

| Input | Source | Default / required |
|-------|--------|--------------------|
| `<slug>` | argv[2] | **Required** — exit 2 if absent |
| `--sla-minutes=N` | argv flag | `60` |
| client profile | `clients/{slug}/client_profile.json` | **Required** — exit 3 if absent |
| page token | `META_PAGE_TOKEN_<SLUG>` env, or `accounts.page_token` in profile, or global `META_PAGE_TOKEN` (flagged) | If none + not offline → normalize existing inbox only |
| `SMOS_OFFLINE` | env (`=1`) | Forces offline: normalize existing `inbox.json` only |

**Profile fields read:** `accounts.facebook_page_id`, `accounts.instagram_business_id`.

**Exit codes:** `2` = no slug, `3` = profile not found, `0` = success (incl. offline / no-token).

## Output 1 — `clients/{slug}/inbox.json`

Top level: `{ client_slug, items: InboxItem[] }`. Each `InboxItem`:

| Field | Type | Notes |
|-------|------|-------|
| `inbox_id` | string | `platform:type:external_id` lowercased — dedupe key |
| `platform` | enum | `facebook` \| `instagram` \| `threads` |
| `type` | enum | `comment` \| `dm` \| `mention` \| `story_reply` \| `ad_comment` |
| `external_id` | string\|null | required for valid dedupe |
| `conversation_id` | string\|null | thread id for DMs |
| `parent_id` | string\|null | in-reply-to id |
| `author` | object | `{ id, name }` |
| `text` | string | message/comment body |
| `object_ref` | string\|null | permalink / media / post id |
| `received_at` | ISO8601\|null | source timestamp |
| `state` | enum | `unread`\|`open`\|`snoozed`\|`replied`\|`closed`\|`spam` (default `unread`) |
| `sentiment` | enum\|null | optional |
| `first_reply_due_at` | ISO8601\|null | stamped = `received_at` + SLA |
| `replied_at` | ISO8601\|null | when a human/auto reply was sent |
| `reply_latency_seconds` | number\|null | computed from `replied_at − received_at` |
| `thread_depth` | number | default 0 |
| `assignee` | string\|null | optional owner |
| `draft_reply` | string\|null | prepared reply, **not sent** |
| `auto_reply` | boolean | true only with approval; gated by `validateReply` |

### Example `inbox.json`

```json
{
  "client_slug": "acme",
  "items": [
    {
      "inbox_id": "instagram:comment:17900000000000000",
      "platform": "instagram",
      "type": "comment",
      "external_id": "17900000000000000",
      "conversation_id": null,
      "parent_id": null,
      "author": { "id": null, "name": "jane_doe" },
      "text": "Do you ship to Canada?",
      "object_ref": "https://www.instagram.com/p/Cabc123/",
      "received_at": "2026-06-22T14:05:00+0000",
      "state": "unread",
      "sentiment": null,
      "first_reply_due_at": "2026-06-22T15:05:00.000Z",
      "replied_at": null,
      "reply_latency_seconds": null,
      "thread_depth": 0,
      "assignee": null,
      "draft_reply": "Yes! We ship across Canada — 3–5 business days. Want a link?",
      "auto_reply": false
    }
  ]
}
```

## Output 2 — Supabase `inbox_items`

Best-effort `upsert` on conflict key `inbox_id` (when `supabaseConfigured()`). Each row is
the `InboxItem` plus `client_id` (from `clientIdBySlug(slug)`) and `slug`. Failure is logged
(`supabase persist skipped: <msg>`) and non-fatal — `inbox.json` is the offline source of truth.

## Output 3 — stdout summary

```
inbox: <N> items · <B> SLA breach(es) · token=<source>[ (GLOBAL FALLBACK!)] → inbox.json
```

## Validation

`schema.validate(payload)` is advisory (warnings to stderr, file still written). Per item:
- `platform` / `type` / `state` must be in their enums.
- `external_id` must be a non-empty string ("cannot dedupe interactions" otherwise).

`schema.validateReply(item, { allowAuto })` is the fail-closed send gate (see domain-standards §4).

## Edge cases

| Case | Handling |
|------|----------|
| Re-run on same data | `inbox_id` dedupe → upsert, no duplicates |
| Missing `received_at` | SLA uses `now` as the base; `first_reply_due_at` still stamped |
| No `external_id` | Validation warning; item kept but cannot dedupe reliably |
| Offline / no token | Normalize existing `inbox.json` (or empty queue); SLA logic still runs |
| One Graph edge 403 | Edge skipped + logged; other edges still populate the queue |
| Already-replied item | `reply_latency_seconds` computed; excluded from breach count |
| Empty queue | Writes `{ client_slug, items: [] }`, summary reports 0 items / 0 breaches |

**Last verified:** 2026-06-22
