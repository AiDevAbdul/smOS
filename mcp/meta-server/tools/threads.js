/**
 * Threads support (Phase 2.4). Threads has its OWN API host and token, separate
 * from the Facebook Graph: https://graph.threads.net/v1.0. Publishing is a
 * 2-step container flow mirroring Instagram:
 *   POST /{threads_user_id}/threads            → creation_id
 *   POST /{threads_user_id}/threads_publish    → media id
 * Insights:
 *   GET  /{media_id}/insights / /{user_id}/threads_insights
 *
 * Tokens are Threads-specific — resolve a per-client Threads token
 * (META_THREADS_TOKEN_<SLUG> or threads_access_token arg), never the FB token.
 */

import axios from "axios";

const THREADS_BASE = "https://graph.threads.net/v1.0";

export const tools = [
  {
    name: "create_threads_post",
    description: "Publish a text (and optional single image/video) post to Threads. Two-step container→publish flow. Requires a Threads access token.",
    inputSchema: {
      type: "object",
      properties: {
        threads_user_id: { type: "string", description: "Threads user id (from the connected IG/Threads account)." },
        text: { type: "string", description: "Post text (max 500 chars)." },
        media_type: { type: "string", enum: ["TEXT", "IMAGE", "VIDEO"], default: "TEXT" },
        image_url: { type: "string", description: "Public HTTPS URL (IMAGE)." },
        video_url: { type: "string", description: "Public HTTPS URL (VIDEO)." },
        reply_control: { type: "string", enum: ["everyone", "accounts_you_follow", "mentioned_only"], default: "everyone" },
        threads_access_token: { type: "string", description: "Per-client Threads token. Required." },
      },
      required: ["threads_user_id"],
    },
  },
  {
    name: "get_threads_insights",
    description: "Fetch Threads insights for a media id or for the account (views, likes, replies, reposts, quotes).",
    inputSchema: {
      type: "object",
      properties: {
        threads_user_id: { type: "string", description: "Account-level insights (omit media_id)." },
        media_id: { type: "string", description: "Per-post insights." },
        metrics: { type: "array", items: { type: "string" }, description: "Defaults to views,likes,replies,reposts,quotes." },
        threads_access_token: { type: "string" },
      },
    },
  },
];

function threadsToken(args) {
  return (
    args.threads_access_token ||
    (args.slug && process.env[`META_THREADS_TOKEN_${String(args.slug).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]) ||
    process.env.META_THREADS_TOKEN
  );
}

async function tRequest(method, path, params = {}, data = null, token) {
  const config = { method, url: `${THREADS_BASE}${path}`, params: { access_token: token, ...params } };
  if (data) config.data = data;
  try {
    const res = await axios(config);
    return res.data;
  } catch (err) {
    const meta = err.response?.data?.error;
    if (meta) throw new Error(`Threads API ${meta.code}: ${meta.message} (type=${meta.type}, trace=${meta.fbtrace_id})`);
    throw err;
  }
}

export async function handle(toolName, args) {
  const token = threadsToken(args);
  if (!token) throw new Error(`${toolName} requires a Threads access token (threads_access_token arg or META_THREADS_TOKEN_<SLUG>). The Facebook token does not work on graph.threads.net.`);

  switch (toolName) {
    case "create_threads_post": {
      const { threads_user_id, text, media_type = "TEXT", image_url, video_url, reply_control = "everyone" } = args;
      if (text && text.length > 500) throw new Error("create_threads_post: text exceeds Threads' 500-char limit");
      const containerParams = { media_type, reply_control };
      if (text) containerParams.text = text;
      if (media_type === "IMAGE") {
        if (!image_url) throw new Error("create_threads_post: image_url required for IMAGE");
        containerParams.image_url = image_url;
      } else if (media_type === "VIDEO") {
        if (!video_url) throw new Error("create_threads_post: video_url required for VIDEO");
        containerParams.video_url = video_url;
      }
      const container = await tRequest("POST", `/${threads_user_id}/threads`, {}, containerParams, token);
      // Media containers need a brief processing window before publish; text is instant.
      if (media_type !== "TEXT") await new Promise((r) => setTimeout(r, 5000));
      const publish = await tRequest("POST", `/${threads_user_id}/threads_publish`, {}, { creation_id: container.id }, token);
      return { creation_id: container.id, media_id: publish.id, media_type };
    }

    case "get_threads_insights": {
      const { threads_user_id, media_id, metrics } = args;
      const metric = (metrics && metrics.length ? metrics : ["views", "likes", "replies", "reposts", "quotes"]).join(",");
      if (media_id) return tRequest("GET", `/${media_id}/insights`, { metric }, null, token);
      if (threads_user_id) return tRequest("GET", `/${threads_user_id}/threads_insights`, { metric }, null, token);
      throw new Error("get_threads_insights: provide media_id (post) or threads_user_id (account)");
    }

    default:
      throw new Error(`Unknown threads tool: ${toolName}`);
  }
}
