import FormData from "form-data";
import axios from "axios";

export const tools = [
  {
    name: "create_ad_creative",
    description: "Assemble an ad creative object from copy, image, and URL components",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        name: { type: "string" },
        page_id: { type: "string", description: "Facebook Page ID the ad will run from" },
        format: {
          type: "string",
          enum: ["single_image", "single_video", "carousel"],
          default: "single_image",
        },
        primary_text: { type: "string", description: "Main ad copy (max 125 chars recommended)" },
        headline: { type: "string", description: "Ad headline" },
        description: { type: "string", description: "Ad description (optional)" },
        call_to_action: {
          type: "string",
          enum: ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "GET_QUOTE", "BOOK_NOW", "DOWNLOAD", "CONTACT_US", "APPLY_NOW", "GET_OFFER", "SUBSCRIBE", "WATCH_MORE"],
          default: "LEARN_MORE",
        },
        destination_url: { type: "string", description: "Landing page URL (must include UTM params)" },
        image_hash: { type: "string", description: "Image hash from upload_image. Required for single_image." },
        video_id: { type: "string", description: "Video ID for single_video format." },
        instagram_actor_id: { type: "string", description: "Instagram account ID for IG placements" },
        carousel_cards: {
          type: "array",
          description: "For carousel format. Array of {image_hash, headline, description, link, call_to_action_type}",
        },
      },
      required: ["ad_account_id", "name", "page_id", "primary_text", "destination_url"],
    },
  },
  {
    name: "upload_image",
    description: "Upload an image to the ad account creative library by URL or base64",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        image_url: { type: "string", description: "Publicly accessible image URL to upload" },
      },
      required: ["ad_account_id", "image_url"],
    },
  },
  {
    name: "create_ad",
    description: "Create an ad within an adset using an existing creative",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        adset_id: { type: "string" },
        name: { type: "string" },
        creative_id: { type: "string", description: "Creative ID from create_ad_creative" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"], default: "PAUSED" },
        tracking_specs: {
          type: "array",
          description: "Pixel tracking specs. Usually auto-inferred from adset promoted_object.",
        },
      },
      required: ["ad_account_id", "adset_id", "name", "creative_id"],
    },
  },
  {
    name: "update_ad_status",
    description: "Pause, activate, or archive an ad",
    inputSchema: {
      type: "object",
      properties: {
        ad_id: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
      },
      required: ["ad_id", "status"],
    },
  },
  {
    name: "get_ad_insights",
    description: "Get performance metrics for a specific ad",
    inputSchema: {
      type: "object",
      properties: {
        ad_id: { type: "string" },
        date_preset: {
          type: "string",
          enum: ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_28d", "last_30d"],
          default: "last_7d",
        },
        time_increment: { type: "number", default: 1 },
        breakdowns: {
          type: "array",
          items: { type: "string", enum: ["age", "gender", "device_platform", "publisher_platform", "placement"] },
        },
      },
      required: ["ad_id"],
    },
  },
  {
    name: "get_ads_under_adset",
    description: "List all ads under a given adset with their status and creative IDs",
    inputSchema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        status: {
          type: "array",
          items: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED", "WITH_ISSUES"] },
        },
      },
      required: ["adset_id"],
    },
  },
];

const INSIGHT_FIELDS = "impressions,clicks,spend,reach,ctr,cpc,cpm,frequency,actions,action_values,cost_per_action_type,purchase_roas,unique_clicks";

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "create_ad_creative": {
      const { ad_account_id, name, page_id, format = "single_image", primary_text, headline, description, call_to_action = "LEARN_MORE", destination_url, image_hash, video_id, instagram_actor_id, carousel_cards } = args;

      let object_story_spec;

      if (format === "carousel") {
        object_story_spec = {
          page_id,
          link_data: {
            message: primary_text,
            link: destination_url,
            child_attachments: (carousel_cards || []).map((c) => ({
              link: c.link || destination_url,
              name: c.headline,
              description: c.description,
              image_hash: c.image_hash,
              call_to_action: { type: c.call_to_action_type || call_to_action, value: { link: c.link || destination_url } },
            })),
            call_to_action: { type: call_to_action, value: { link: destination_url } },
          },
        };
      } else if (format === "single_video") {
        object_story_spec = {
          page_id,
          video_data: {
            video_id,
            message: primary_text,
            call_to_action: { type: call_to_action, value: { link: destination_url } },
            title: headline,
          },
        };
      } else {
        object_story_spec = {
          page_id,
          link_data: {
            link: destination_url,
            message: primary_text,
            name: headline,
            description,
            image_hash,
            call_to_action: { type: call_to_action, value: { link: destination_url } },
          },
        };
      }

      const body = {
        name,
        object_story_spec: JSON.stringify(object_story_spec),
      };
      if (instagram_actor_id) body.instagram_actor_id = instagram_actor_id;

      return client.post(`/${client.act(ad_account_id)}/adcreatives`, body);
    }

    case "upload_image": {
      const { ad_account_id, image_url } = args;
      return client.post(`/${client.act(ad_account_id)}/adimages`, { url: image_url });
    }

    case "create_ad": {
      const { ad_account_id, adset_id, name, creative_id, status = "PAUSED", tracking_specs } = args;
      const body = {
        adset_id,
        name,
        creative: JSON.stringify({ creative_id }),
        status,
      };
      if (tracking_specs) body.tracking_specs = JSON.stringify(tracking_specs);
      return client.post(`/${client.act(ad_account_id)}/ads`, body);
    }

    case "update_ad_status": {
      const { ad_id, status } = args;
      return client.post(`/${ad_id}`, { status });
    }

    case "get_ad_insights": {
      const { ad_id, date_preset = "last_7d", time_increment = 1, breakdowns } = args;
      const params = { fields: INSIGHT_FIELDS, date_preset, time_increment };
      if (breakdowns?.length) params.breakdowns = breakdowns.join(",");
      return client.get(`/${ad_id}/insights`, params);
    }

    case "get_ads_under_adset": {
      const { adset_id, status } = args;
      const params = {
        fields: "id,name,status,creative{id,name,thumbnail_url},effective_status,created_time",
      };
      if (status?.length) {
        params.filtering = JSON.stringify([{ field: "effective_status", operator: "IN", value: status }]);
      }
      return client.get(`/${adset_id}/ads`, params);
    }

    default:
      throw new Error(`Unknown ad tool: ${toolName}`);
  }
}
