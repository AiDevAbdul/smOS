# strategy-brief — Human Approval Gate

This skill has no external API, so this file replaces the usual `api-reference.md`. It documents
the load-bearing human gate that sits between `/strategy-brief` and `/launch`. Readable
independently of the SKILL.md.

---

## Why the gate exists

The strategy brief commits real budget, audiences, and creative direction. Per the smOS
constitution, **Phase 4 (`/launch`) cannot proceed until a human approves the brief.** The
script writes the brief with `approval.status: "pending"`; Claude runs the gate; only an
explicit human `approve` flips it.

---

## What the code actually does vs. what the constitution routing says

- The **constitution routing table** mentions Slack for approval in some contexts.
- The **skill text and `strategy-brief.js`** use **Discord** terminology: the rendered `.md`
  opens with `Reply 'approve' in Discord to lock this brief, or 'reject [reason]' to revise.`,
  and the persisted brief carries a `discord_message_id` field.
- **Mechanism the code truly relies on:** the decision is captured **in the current session**.
  Discord webhooks are outbound-only — they post the brief but cannot receive a reply
  programmatically. So the human's `approve` / `reject [reason]` is given to Claude here (the
  user may have read it in Discord, but the binding signal is the session decision). Keep this
  internally consistent: post to Discord for visibility, confirm the decision in-session.

The script itself never blocks on a reply — it always exits after writing a `pending` brief.
The gate is enforced by Claude (and by `/launch` refusing to run on a non-`approved` brief).

### Resolving the latent naming conflict (maintainer action)

This is a known, unresolved inconsistency, not a bug in this skill:

- `CLAUDE.md`'s Workflow Routing / approval prose references **Slack** for the approval channel.
- This skill, `strategy-brief.js`, the rendered `.md`, and the `strategy_briefs.discord_message_id`
  column all standardize on **Discord**.

The skill flags the conflict but cannot resolve it from inside `references/` — the fix is a
one-line edit a maintainer must make in `CLAUDE.md` (or this skill) so both name the **same**
channel. **Recommended resolution: standardize on Discord** (it is the channel the code,
the brief field, and the rendered prompt already use; changing them would touch the schema
and the persisted row). Until that edit lands, treat Discord as authoritative for this skill
and read "Slack" in `CLAUDE.md` as referring to the same approval channel. File this under the
maintainer's "keeping current" checklist; do not silently change behavior to match `CLAUDE.md`.

---

## The reject / revise loop

1. Present the brief: `Strategy brief for {name} — reply 'approve' to lock in, or 'reject [reason]' to revise.`
2. **reject [reason]:**
   - Capture the reason verbatim.
   - Ask the user what to revise (budget? objective? an angle?).
   - Re-run ONLY the affected passes — do not regenerate untouched sections.
   - Regenerate `strategy_brief.json` + `.md`, re-present, loop to step 1.
3. **approve:**
   - Set `approval.status = "approved"`, `approved_by = {user}`, `approved_at = {ISO now}`,
     and `discord_message_id` if a real Discord post id exists.
   - Insert the Supabase `strategy_briefs` row (see below).
   - Print: `Strategy brief approved by {user}. Run /creative next.`
4. **No decision within 24h:** re-ping the channel once, then halt and surface to the user.
   **Never auto-approve. Silence is never consent.**

---

## Supabase `strategy_briefs` row (written AFTER approval only)

```jsonc
{
  "client_id": "<clients.id for slug>",
  "brief": { /* full strategy_brief.json */ },
  "status": "approved",
  "approved_by": "<user>",
  "approved_at": "2026-06-22T14:05:00.000Z",
  "discord_message_id": "<id or null>"
}
```

If the Supabase write fails: keep the local `.json`/`.md`, surface the error, and do NOT treat
the brief as approved — downstream `/launch` must still see no approved row.

**Security for this write:** the upsert authenticates with the Supabase **service role key**
in env var **`SUPABASE_SERVICE_ROLE_KEY`** (plus `SUPABASE_URL`), resolved via
`scripts/lib/load-env.js` from `~/.config/smos/.env` (chmod 600). This key bypasses RLS —
apply least privilege (scope to the `strategy_briefs` table where the deployment allows),
never embed it client-side or in the brief JSON, never log it, and rotate it on any suspected
leak or staff offboarding. The `strategy-brief.js` script itself never reads this key (it does
no network I/O); only the post-approval persistence step Claude performs uses it.

---

## Failure handling for the gate

| Scenario | Action |
|----------|--------|
| Discord post fails | Save brief locally, surface webhook URL + error, do not record approval |
| User rejects | Capture reason, re-run affected passes, regenerate, re-present |
| No reply in 24h | Re-ping once, then halt — never auto-approve |
| Supabase row insert fails | Keep local files, surface error, brief stays effectively un-approved |
| User edits the `.md` by hand | Discard — regenerate from `.json` so the two never diverge |

---

## Doc reference

| Resource | URL | Use For |
|----------|-----|---------|
| Outcome objectives (ODAX) | https://developers.facebook.com/blog/post/2023/02/13/outcome-driven-ad-experiences-update/ | The `OUTCOME_*` enums the approved brief hands to `/launch` |
| Campaign structure guide | https://developers.facebook.com/docs/marketing-api/campaign-structure/ | What `/launch` builds from the approved brief |

**Fetch vs. cache, per link:**
- **Re-fetch the ODAX page** before a launch cycle or when adding/renaming an objective — the
  `OUTCOME_*` enum set is the one thing that can change and would propagate into `/launch`.
  Anything older than the last-verified date below is suspect.
- **Trust the cached convention** for the campaign-structure page — campaign→adset→ad nesting
  is stable, and this gate only references it for context; `/launch` consumes it.

**Good vs. bad doc use here:**
- GOOD: before approving a brief that introduces a new phase objective, open the ODAX page,
  confirm the exact `OUTCOME_*` string, and verify the brief uses it verbatim.
- BAD: approving a brief whose objective reads `CONVERSIONS` (a legacy objective deprecated for
  creation in Marketing API v17.0) without checking the live enum list — `/launch` would fail.

**Last verified:** 2026-06-22
