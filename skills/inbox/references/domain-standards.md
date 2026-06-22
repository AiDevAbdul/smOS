# /inbox — Domain Standards

Embedded expertise for the Unified Social Inbox. Read this when you need SLA thresholds,
the item/state taxonomy, the dedupe + latency formulas, or reply-voice guidance. Self-contained.

## 1. First-reply SLA

The single most important organic-social metric is **first-reply latency** — how long an
inbound interaction waits before a human (or approved auto-reply) answers it.

| Window | Default | Rationale |
|--------|---------|-----------|
| First-reply SLA | **60 minutes** | Industry table-stakes for FB/IG; overridable per run via `--sla-minutes=N` |
| Breach | `now > first_reply_due_at` and `state ∉ {replied, closed}` | Surfaced in the run summary as "SLA breach(es)" |

**Formula:**
```
first_reply_due_at = received_at + (sla_minutes * 60_000) ms   # stamped if absent
reply_latency_seconds = max(0, round((replied_at - received_at) / 1000))  # only if replied_at set
```
SLA is a **client-tunable VARIES** value (a premium retainer may demand 15 min). The 60-min
default and the breach formula are CONSTANT. Never hardcode a different default in the skill —
pass `--sla-minutes`.

## 2. Item taxonomy (from `schemas/inbox_item.js`)

| Field | Allowed values | Notes |
|-------|----------------|-------|
| `platform` | `facebook`, `instagram`, `threads` | This skill pulls only `facebook` + `instagram`; Threads is `/listening`/`/publish` territory |
| `type` | `comment`, `dm`, `mention`, `story_reply`, `ad_comment` | This skill produces `comment`, `dm`, `mention` |
| `state` | `unread`, `open`, `snoozed`, `replied`, `closed`, `spam` | Default `unread`; only `replied`/`closed` exit the SLA-breach set |
| `sentiment` | `positive`, `neutral`, `negative`, or null | Optional; not auto-computed by the puller |

**Dedupe key (CONSTANT):**
```
inbox_id = `${platform}:${type}:${external_id}`.toLowerCase()
```
This makes re-pulls idempotent: the same comment seen twice upserts onto the same row in
both `inbox.json` and Supabase `inbox_items`. An item with no `external_id` fails validation
("cannot dedupe interactions").

## 3. Thread depth

`thread_depth` (integer, default 0) tracks how deep a back-and-forth DM/comment thread runs.
Depth 0 = first inbound message. Use it to prioritize: a depth-3 unanswered thread is a
hotter escalation than a fresh depth-0 comment.

## 4. The send gate (fail-closed)

A reply lives in `draft_reply` until a human or an approved automation sends it. The gate is
`inboxItem.validateReply(item, { allowAuto })`:

- `draft_reply` empty → **blocked** ("nothing to send").
- `auto_reply === true` and `allowAuto === false` → **blocked** ("auto-send not approved").

`allowAuto` is only true when `scripts/lib/approvals.js` has an approved, unexpired record
(action `auto_reply_enabled`, role ≥ manager). Pending / rejected / expired / missing all
fail closed.

## 5. Reply-voice rules

Drafts must respect the client's voice from `client_profile.json` (and per-client `CLAUDE.md`):
honor `voice.tone`, never use words in `voice.avoid` / `brand.verbal.voice.dont`. Voice is
**VARIES** (per client); the requirement to apply it is CONSTANT.

### Good vs bad reply drafts

| Inbound | Bad draft | Good draft |
|---------|-----------|------------|
| "Do you ship to Canada?" | "idk check the site" | "Yes! We ship across Canada — standard delivery is 3–5 business days. Want me to send a link?" |
| Negative comment "took 2 weeks" | (auto-sent generic apology) | Draft only, flag for human: "I'm sorry about the wait — can you DM your order number so I can make this right?" |
| Spam link in comments | Reply to it | Set `state: spam`, no draft |

### Bad vs good operational patterns

- BAD: build the Graph client on the global user token, override `access_token` per call →
  `appsecret_proof` mismatch the moment "Require App Secret" is on. GOOD: build `createGraph`
  on the resolved page token so proof matches the authenticating token.
- BAD: one failing edge aborts the whole pull. GOOD: try/catch each edge, keep the rest.
- BAD: hardcode a 30-min SLA in the skill. GOOD: default 60, override via `--sla-minutes`.

## 6. Keeping current

- SLA default and the breach formula: stable; only change with explicit agency policy.
- Taxonomy/enums: source of truth is `schemas/inbox_item.js` — if it changes, update §2 here.
- Graph fields/edges: re-verify against `references/api-reference.md` URLs each Graph version bump.

**Last verified:** 2026-06-22
