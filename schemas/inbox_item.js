// schemas/inbox_item.js — canonical shape for the Unified Social Inbox (Phase 2.1/2.3).
//
// One shape for every inbound interaction across FB + IG, whether it's a comment,
// a DM, or a mention. The inbox skill (producer) and the portal/reply tooling
// (consumers) both import this so a field rename can't desync the queue.
//
// Conversation-depth + SLA fields (Phase 2.3 DM loop) live here so first-reply
// latency and thread depth are first-class, not bolted on later.

import { pick, asArray, isNonEmptyString, isFiniteNumber, result } from "./_shared.js";

export const PLATFORMS = ["facebook", "instagram", "threads"];
export const ITEM_TYPES = ["comment", "dm", "mention", "story_reply", "ad_comment"];
export const STATES = ["unread", "open", "snoozed", "replied", "closed", "spam"];

/** Stable id for an interaction so re-pulls dedupe instead of duplicating. */
export function inboxId(platform, type, externalId) {
  return `${platform || "fb"}:${type || "comment"}:${externalId || ""}`.toLowerCase();
}

export function normalizeItem(raw) {
  const r = raw || {};
  const platform = (pick(r, "platform", "network") || "facebook").toLowerCase();
  const type = (pick(r, "type", "item_type", "kind") || "comment").toLowerCase();
  const externalId = pick(r, "external_id", "id", "comment_id", "message_id");
  return {
    inbox_id: pick(r, "inbox_id") || inboxId(platform, type, externalId),
    platform,
    type,
    external_id: externalId ?? null,
    conversation_id: pick(r, "conversation_id", "thread_id") ?? null,
    parent_id: pick(r, "parent_id", "in_reply_to") ?? null,
    author: {
      id: pick(r.author || r, "author_id", "from_id", "user_id") ?? null,
      name: pick(r.author || r, "author_name", "username", "from_name") ?? null,
    },
    text: pick(r, "text", "message", "body") ?? "",
    object_ref: pick(r, "object_ref", "object_id", "media_id", "post_id") ?? null,
    received_at: pick(r, "received_at", "created_time", "timestamp") ?? null,
    state: (pick(r, "state", "status") || "unread").toLowerCase(),
    sentiment: pick(r, "sentiment") ?? null, // optional: positive|neutral|negative
    // SLA / conversation depth (Phase 2.3)
    first_reply_due_at: pick(r, "first_reply_due_at") ?? null,
    replied_at: pick(r, "replied_at") ?? null,
    reply_latency_seconds: isFiniteNumber(pick(r, "reply_latency_seconds")) ? r.reply_latency_seconds : null,
    thread_depth: isFiniteNumber(pick(r, "thread_depth")) ? r.thread_depth : 0,
    assignee: pick(r, "assignee") ?? null,
    // a reply that has NOT yet been sent to Meta is a draft → fail-closed before send
    draft_reply: pick(r, "draft_reply") ?? null,
    auto_reply: pick(r, "auto_reply") === true,
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    items: asArray(pick(r, "items")).map(normalizeItem),
  };
}

export function validateItem(item) {
  const errors = [];
  const it = normalizeItem(item);
  if (!PLATFORMS.includes(it.platform)) errors.push(`platform "${it.platform}" not in ${PLATFORMS.join("/")}`);
  if (!ITEM_TYPES.includes(it.type)) errors.push(`type "${it.type}" not in ${ITEM_TYPES.join("/")}`);
  if (!isNonEmptyString(it.external_id)) errors.push("external_id missing — cannot dedupe interactions");
  if (!STATES.includes(it.state)) errors.push(`state "${it.state}" not in ${STATES.join("/")}`);
  return result(errors);
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["inbox payload is not an object"]);
  asArray(obj.items).forEach((it, i) => {
    const v = validateItem(it);
    if (!v.ok) errors.push(`items[${i}]: ${v.errors.join("; ")}`);
  });
  return result(errors);
}

/**
 * Fail-closed send gate: a reply may only leave the process if it has text and
 * (for auto-replies) explicit approval. Used by the reply tooling before send_message.
 */
export function validateReply(item, { allowAuto = false } = {}) {
  const errors = [];
  const it = normalizeItem(item);
  if (!isNonEmptyString(it.draft_reply)) errors.push("draft_reply is empty — nothing to send");
  if (it.auto_reply && !allowAuto) errors.push("auto_reply is set but auto-send is not approved (fail-closed)");
  return result(errors);
}
