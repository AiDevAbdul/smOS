/**
 * Unified Social Inbox tools (Phase 2.1 / 2.3) — Facebook + Instagram
 * conversations (DMs), mentions, and message replies in one place. Comment
 * read/reply already exists in publishing.js (moderate_comments); this module
 * adds the DM + mention half so the inbox is genuinely unified.
 *
 * Endpoints (v25.0):
 *   GET  /{page_id}/conversations?platform=messenger|instagram   — thread list
 *   GET  /{conversation_id}?fields=messages{...}                  — messages in a thread
 *   POST /{page_id}/messages                                      — send a reply
 *   GET  /{ig_user_id}/mentions / tags                           — IG mentions
 *
 * Per-client tokens: every call resolves a PAGE token for the client (never the
 * global user token) — pass page_access_token, or set META_PAGE_TOKEN_<SLUG>.
 *
 * Messaging-window rule (fail-closed): outside the platform's standard messaging
 * window (24h since the user's last message) a normal text reply is rejected by
 * Meta. send_message refuses to send without an explicit messaging_type/tag when
 * the window may be closed, rather than burning a failed call.
 */

export const tools = [
  {
    name: "get_conversations",
    description: "List inbox conversations (DM threads) for a Page (Messenger) or Instagram account. Returns thread ids, participants, snippet, and unread count.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID (the inbox owner for both Messenger and IG)." },
        platform: { type: "string", enum: ["messenger", "instagram"], default: "messenger" },
        page_access_token: { type: "string", description: "Page token. Required; user token will not read the inbox." },
        limit: { type: "number", default: 25 },
        after: { type: "string", description: "Pagination cursor." },
      },
      required: ["page_id"],
    },
  },
  {
    name: "get_messages",
    description: "Fetch messages within a single conversation thread, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        conversation_id: { type: "string" },
        page_access_token: { type: "string" },
        limit: { type: "number", default: 25 },
      },
      required: ["conversation_id"],
    },
  },
  {
    name: "send_message",
    description: "Send a reply in a Messenger/Instagram conversation. Fail-closed outside the 24h messaging window unless messaging_type/tag is supplied.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Page that owns the conversation." },
        recipient_id: { type: "string", description: "PSID (Messenger) or IGSID (Instagram) of the user to reply to." },
        message: { type: "string", description: "Reply text." },
        page_access_token: { type: "string" },
        messaging_type: { type: "string", enum: ["RESPONSE", "UPDATE", "MESSAGE_TAG"], default: "RESPONSE", description: "RESPONSE only valid within 24h of the user's last message." },
        tag: { type: "string", description: "Required when messaging_type=MESSAGE_TAG (e.g. HUMAN_AGENT, CONFIRMED_EVENT_UPDATE)." },
        within_window: { type: "boolean", description: "Set true only if you've confirmed the user messaged within 24h. If false/unknown and messaging_type=RESPONSE, the send is refused.", default: false },
      },
      required: ["page_id", "recipient_id", "message"],
    },
  },
  {
    name: "get_mentions",
    description: "Fetch recent Instagram mentions/tags for an IG business account (caption mentions + photo tags).",
    inputSchema: {
      type: "object",
      properties: {
        ig_user_id: { type: "string", description: "Instagram Business Account ID." },
        page_access_token: { type: "string" },
        limit: { type: "number", default: 25 },
      },
      required: ["ig_user_id"],
    },
  },
];

function pageToken(args) {
  // Per-client token preferred; MCP callers pass page_access_token, or set
  // META_PAGE_TOKEN_<SLUG>. Global META_PAGE_TOKEN is a last-resort fallback.
  return (
    args.page_access_token ||
    (args.slug && process.env[`META_PAGE_TOKEN_${String(args.slug).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]) ||
    process.env.META_PAGE_TOKEN
  );
}

export async function handle(toolName, args, client) {
  const token = pageToken(args);
  if (!token) throw new Error(`${toolName} requires a page access token (page_access_token arg or META_PAGE_TOKEN_<SLUG>). The global user token cannot access the inbox.`);

  switch (toolName) {
    case "get_conversations": {
      const { page_id, platform = "messenger", limit = 25, after } = args;
      const params = {
        access_token: token,
        platform,
        fields: "id,snippet,unread_count,updated_time,participants{id,name,username},message_count",
        limit: Math.min(limit, 100),
      };
      if (after) params.after = after;
      return client.get(`/${page_id}/conversations`, params);
    }

    case "get_messages": {
      const { conversation_id, limit = 25 } = args;
      return client.get(`/${conversation_id}`, {
        access_token: token,
        fields: `messages.limit(${Math.min(limit, 100)}){id,message,from,to,created_time}`,
      });
    }

    case "send_message": {
      const { page_id, recipient_id, message, messaging_type = "RESPONSE", tag, within_window = false } = args;
      // Fail-closed messaging-window check.
      if (messaging_type === "RESPONSE" && !within_window) {
        throw new Error(
          "send_message REFUSED: messaging_type=RESPONSE is only valid within 24h of the user's last message. " +
          "Confirm within_window:true, or use messaging_type=MESSAGE_TAG with a valid tag (e.g. HUMAN_AGENT)."
        );
      }
      if (messaging_type === "MESSAGE_TAG" && !tag) {
        throw new Error("send_message REFUSED: messaging_type=MESSAGE_TAG requires a tag.");
      }
      const body = {
        access_token: token,
        recipient: { id: recipient_id },
        message: { text: message },
        messaging_type,
      };
      if (tag) body.tag = tag;
      return client.post(`/${page_id}/messages`, body);
    }

    case "get_mentions": {
      const { ig_user_id, limit = 25 } = args;
      // IG mentions surface via tags edge on the business account.
      return client.get(`/${ig_user_id}/tags`, {
        access_token: token,
        fields: "id,caption,media_type,permalink,timestamp,username,like_count,comments_count",
        limit: Math.min(limit, 100),
      });
    }

    default:
      throw new Error(`Unknown inbox tool: ${toolName}`);
  }
}
