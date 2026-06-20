/**
 * Organic publishing tools — Facebook Page posts, Instagram media, comment moderation.
 *
 * Notes:
 * - Facebook posts: POST /{page_id}/feed with a page access token (not the user token).
 * - Instagram publishing is a 2-step container flow: POST /{ig_id}/media → POST /{ig_id}/media_publish.
 * - Carousels: create child containers first (is_carousel_item=true), then a parent container with children=<ids>.
 * - Comment moderation: hide is POST /{comment_id} {is_hidden:true}; delete is DELETE /{comment_id}.
 * - IG publishing has a 100 calls/day limit per IG account (v25.0).
 */

export const tools = [
  {
    name: "create_page_post",
    description: "Publish or schedule a post to a Facebook Page. Requires a page access token in the META_PAGE_TOKEN env or pass page_access_token explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Facebook Page ID" },
        message: { type: "string", description: "Post text" },
        link: { type: "string", description: "URL to share (optional)" },
        image_url: { type: "string", description: "Public URL of an image to attach. For Page-hosted images, upload first via /{page_id}/photos." },
        scheduled_publish_time: { type: "number", description: "Unix timestamp (seconds). Must be 10 min – 6 months in future. Pair with published=false." },
        published: { type: "boolean", description: "Set false when scheduling. Defaults to true.", default: true },
        page_access_token: { type: "string", description: "Override env META_PAGE_TOKEN. Page access tokens are required — user tokens won't publish." },
      },
      required: ["page_id"],
    },
  },
  {
    name: "create_ig_media",
    description: "Publish an Instagram image, video, or Reel. Two-step: creates a media container then publishes it. Counts against the 100/day IG publishing limit.",
    inputSchema: {
      type: "object",
      properties: {
        ig_user_id: { type: "string", description: "Instagram Business Account ID" },
        media_type: {
          type: "string",
          enum: ["IMAGE", "VIDEO", "REELS"],
          description: "REELS for reels (uses video_url + share_to_feed). VIDEO for legacy feed videos.",
        },
        image_url: { type: "string", description: "Required for IMAGE. Public HTTPS URL." },
        video_url: { type: "string", description: "Required for VIDEO/REELS. Public HTTPS URL." },
        caption: { type: "string", description: "Caption text. Max ~2200 chars; first 125 visible without 'more'." },
        cover_url: { type: "string", description: "Reels cover image (optional)." },
        share_to_feed: { type: "boolean", description: "REELS only. True to also surface in main feed grid.", default: true },
        location_id: { type: "string", description: "Optional FB Page ID used as a location tag." },
        thumb_offset_ms: { type: "number", description: "VIDEO only. Frame to use as thumbnail." },
      },
      required: ["ig_user_id", "media_type"],
    },
  },
  {
    name: "create_ig_carousel",
    description: "Publish an Instagram carousel (2–10 images/videos). Creates one child container per item, then a parent carousel container, then publishes.",
    inputSchema: {
      type: "object",
      properties: {
        ig_user_id: { type: "string", description: "Instagram Business Account ID" },
        items: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              media_type: { type: "string", enum: ["IMAGE", "VIDEO"] },
              image_url: { type: "string" },
              video_url: { type: "string" },
            },
            required: ["media_type"],
          },
          description: "2–10 carousel slides. Each slide is IMAGE (with image_url) or VIDEO (with video_url).",
        },
        caption: { type: "string", description: "Caption applies to the whole carousel." },
      },
      required: ["ig_user_id", "items"],
    },
  },
  {
    name: "moderate_comments",
    description: "List, hide/unhide, delete, or reply to comments on a Facebook Page post or Instagram media. Bulk-safe: pass an array of actions.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["list", "act"],
          description: "list = fetch comments on a single object; act = run a batch of moderation actions.",
        },
        object_id: { type: "string", description: "Post ID or IG media ID. Required for mode=list." },
        platform: { type: "string", enum: ["facebook", "instagram"], description: "Required for mode=list. Affects field set." },
        limit: { type: "number", default: 50, description: "list mode only" },
        actions: {
          type: "array",
          description: "act mode only. Each item: {comment_id, action: 'hide'|'unhide'|'delete'|'reply', message? (for reply)}",
          items: {
            type: "object",
            properties: {
              comment_id: { type: "string" },
              action: { type: "string", enum: ["hide", "unhide", "delete", "reply"] },
              message: { type: "string", description: "Required for action=reply" },
            },
            required: ["comment_id", "action"],
          },
        },
      },
      required: ["mode"],
    },
  },
];

function pageToken(args) {
  return args.page_access_token || process.env.META_PAGE_TOKEN;
}

async function pollContainerStatus(client, containerId, { timeoutMs = 60_000, intervalMs = 3000 } = {}) {
  // IG containers go FINISHED → PUBLISHED-ready, IN_PROGRESS → wait, ERROR → throw, EXPIRED → throw.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.get(`/${containerId}`, { fields: "status_code,status" });
    if (res.status_code === "FINISHED") return res;
    if (res.status_code === "ERROR" || res.status_code === "EXPIRED") {
      throw new Error(`IG container ${containerId} failed: ${res.status_code} (${res.status || "unknown"})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`IG container ${containerId} did not finish within ${timeoutMs}ms`);
}

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "create_page_post": {
      const { page_id, page_access_token, ...body } = args;
      const token = pageToken(args);
      if (!token) throw new Error("create_page_post requires a page access token (META_PAGE_TOKEN env or page_access_token arg). Page-level tokens are required to publish.");

      // FB scheduling rule: scheduled_publish_time must be 10 min–6 months in future, and published must be false
      if (body.scheduled_publish_time) {
        const now = Math.floor(Date.now() / 1000);
        if (body.scheduled_publish_time < now + 600) {
          throw new Error("scheduled_publish_time must be at least 10 minutes in the future");
        }
        body.published = false;
      }

      // Image attachment routes through /{page_id}/photos; link posts go to /{page_id}/feed
      if (body.image_url) {
        return client.post(`/${page_id}/photos`, { ...body, url: body.image_url, access_token: token });
      }
      return client.post(`/${page_id}/feed`, { ...body, access_token: token });
    }

    case "create_ig_media": {
      const { ig_user_id, media_type, image_url, video_url, caption, cover_url, share_to_feed, location_id, thumb_offset_ms } = args;
      const containerParams = { caption };
      if (location_id) containerParams.location_id = location_id;

      if (media_type === "IMAGE") {
        if (!image_url) throw new Error("create_ig_media: image_url required for IMAGE");
        containerParams.image_url = image_url;
      } else if (media_type === "VIDEO") {
        if (!video_url) throw new Error("create_ig_media: video_url required for VIDEO");
        containerParams.media_type = "VIDEO";
        containerParams.video_url = video_url;
        if (thumb_offset_ms != null) containerParams.thumb_offset = String(thumb_offset_ms);
      } else if (media_type === "REELS") {
        if (!video_url) throw new Error("create_ig_media: video_url required for REELS");
        containerParams.media_type = "REELS";
        containerParams.video_url = video_url;
        if (cover_url) containerParams.cover_url = cover_url;
        containerParams.share_to_feed = share_to_feed !== false;
      }

      const container = await client.post(`/${ig_user_id}/media`, containerParams);

      // VIDEO + REELS need to be polled until FINISHED before publishing
      if (media_type !== "IMAGE") {
        await pollContainerStatus(client, container.id);
      }

      const publish = await client.post(`/${ig_user_id}/media_publish`, { creation_id: container.id });
      return { container_id: container.id, media_id: publish.id, media_type };
    }

    case "create_ig_carousel": {
      const { ig_user_id, items, caption } = args;
      if (!Array.isArray(items) || items.length < 2 || items.length > 10) {
        throw new Error("create_ig_carousel: items must be 2–10 entries");
      }

      // Step 1: create child containers in parallel
      const children = await Promise.all(
        items.map(async (item) => {
          const params = { is_carousel_item: true };
          if (item.media_type === "IMAGE") {
            if (!item.image_url) throw new Error("carousel IMAGE item missing image_url");
            params.image_url = item.image_url;
          } else if (item.media_type === "VIDEO") {
            if (!item.video_url) throw new Error("carousel VIDEO item missing video_url");
            params.media_type = "VIDEO";
            params.video_url = item.video_url;
          } else {
            throw new Error(`carousel items must be IMAGE or VIDEO, got ${item.media_type}`);
          }
          const c = await client.post(`/${ig_user_id}/media`, params);
          // Video children must finish encoding
          if (item.media_type === "VIDEO") await pollContainerStatus(client, c.id);
          return c.id;
        })
      );

      // Step 2: parent carousel container
      const parent = await client.post(`/${ig_user_id}/media`, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption,
      });
      await pollContainerStatus(client, parent.id);

      // Step 3: publish
      const publish = await client.post(`/${ig_user_id}/media_publish`, { creation_id: parent.id });
      return { container_id: parent.id, child_ids: children, media_id: publish.id, media_type: "CAROUSEL" };
    }

    case "moderate_comments": {
      const { mode } = args;
      if (mode === "list") {
        const { object_id, platform, limit = 50 } = args;
        if (!object_id || !platform) throw new Error("moderate_comments list: object_id and platform required");
        const fields =
          platform === "instagram"
            ? "id,text,timestamp,username,like_count,replies{id,text,username,timestamp}"
            : "id,message,created_time,from,like_count,is_hidden,comment_count,parent{id}";
        return client.get(`/${object_id}/comments`, { fields, limit: Math.min(limit, 100) });
      }

      if (mode === "act") {
        const { actions } = args;
        if (!Array.isArray(actions) || !actions.length) throw new Error("moderate_comments act: actions array required");
        const results = await Promise.all(
          actions.map(async (a) => {
            try {
              if (a.action === "hide") {
                const r = await client.post(`/${a.comment_id}`, { is_hidden: true });
                return { comment_id: a.comment_id, action: a.action, ok: true, response: r };
              }
              if (a.action === "unhide") {
                const r = await client.post(`/${a.comment_id}`, { is_hidden: false });
                return { comment_id: a.comment_id, action: a.action, ok: true, response: r };
              }
              if (a.action === "delete") {
                const r = await client.delete(`/${a.comment_id}`);
                return { comment_id: a.comment_id, action: a.action, ok: true, response: r };
              }
              if (a.action === "reply") {
                if (!a.message) throw new Error("reply requires message");
                const r = await client.post(`/${a.comment_id}/comments`, { message: a.message });
                return { comment_id: a.comment_id, action: a.action, ok: true, reply_id: r.id };
              }
              throw new Error(`unknown action: ${a.action}`);
            } catch (e) {
              return { comment_id: a.comment_id, action: a.action, ok: false, error: e.message };
            }
          })
        );
        return { results, ok_count: results.filter((r) => r.ok).length, error_count: results.filter((r) => !r.ok).length };
      }

      throw new Error(`moderate_comments: unknown mode ${mode}`);
    }

    default:
      throw new Error(`Unknown publishing tool: ${toolName}`);
  }
}
