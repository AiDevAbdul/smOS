/**
 * Conversions API (CAPI) tools — server-side event tracking.
 *
 * iOS 14+ killed ~40% of pixel tracking. CAPI is now mandatory for accurate
 * attribution. Best practice is REDUNDANT setup: pixel fires client-side AND
 * CAPI fires server-side for the same event, deduplicated via event_id.
 *
 * Endpoints (v25.0):
 *   POST /{dataset_id}/events                 — send events
 *   GET  /{dataset_id}?fields=...              — dataset info / EMQ proxy
 *   POST /{ad_account_id}/offline_conversion_data_sets  — create offline set
 *   POST /{offline_set_id}/events             — batch offline event upload
 *
 * dataset_id is the Pixel ID / Dataset ID. Same number, different framing in Meta UI.
 */

import crypto from "node:crypto";

function sha256(s) {
  return crypto.createHash("sha256").update(String(s).trim().toLowerCase()).digest("hex");
}

/**
 * Hash PII fields per Meta's CAPI spec. Plaintext PII is REJECTED by Meta.
 * Already-hashed values (64-char hex) pass through.
 */
function hashUserData(user_data) {
  if (!user_data) return undefined;
  const out = { ...user_data };
  const hashFields = ["em", "ph", "fn", "ln", "ge", "db", "ct", "st", "zp", "country", "external_id"];
  for (const field of hashFields) {
    const v = out[field];
    if (!v) continue;
    const values = Array.isArray(v) ? v : [v];
    out[field] = values.map((val) => (/^[a-f0-9]{64}$/i.test(val) ? val.toLowerCase() : sha256(val)));
    if (!Array.isArray(v)) out[field] = out[field][0];
  }
  // client_ip_address and client_user_agent pass through unhashed
  return out;
}

export const tools = [
  {
    name: "send_capi_event",
    description: "Send one or more server-side conversion events to the Meta Conversions API. PII fields in user_data are auto-hashed (SHA-256, lowercase, trimmed). Dedupe with pixel by sending the same event_id from both.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string", description: "Pixel ID / Dataset ID. Same number as the browser pixel." },
        events: {
          type: "array",
          minItems: 1,
          maxItems: 1000,
          description: "Array of events. Each event: {event_name, event_time, event_id?, event_source_url?, action_source, user_data, custom_data?, opt_out?}",
          items: {
            type: "object",
            properties: {
              event_name: { type: "string", description: "Standard event (Purchase, Lead, ViewContent, AddToCart, …) or custom" },
              event_time: { type: "number", description: "Unix timestamp (seconds). Must be ≤ 7 days old." },
              event_id: { type: "string", description: "REQUIRED for pixel+CAPI dedupe. Send the same value from the pixel for matching events." },
              event_source_url: { type: "string" },
              action_source: {
                type: "string",
                enum: ["website", "email", "app", "phone_call", "chat", "physical_store", "system_generated", "business_messaging", "other"],
                default: "website",
              },
              user_data: {
                type: "object",
                description: "Customer info: em (email), ph (phone), fn, ln, ge, db, ct, st, zp, country, external_id, client_ip_address, client_user_agent, fbc, fbp. PII fields auto-hashed.",
              },
              custom_data: {
                type: "object",
                description: "Event metadata: value, currency, content_ids, content_type, order_id, …",
              },
              opt_out: { type: "boolean", description: "Honor user-level opt-outs (CCPA/GDPR)" },
            },
            required: ["event_name", "event_time", "action_source", "user_data"],
          },
        },
        test_event_code: { type: "string", description: "Use the TEST<code> from Events Manager Test Events tab. Events tagged with this don't count toward optimization — use during integration." },
      },
      required: ["dataset_id", "events"],
    },
  },
  {
    name: "get_event_match_quality",
    description: "Fetch dataset info including last activity, EMQ-relevant fields, and recent event volume. Use to monitor whether CAPI is firing and matching well.",
    inputSchema: {
      type: "object",
      properties: {
        dataset_id: { type: "string", description: "Pixel ID / Dataset ID" },
      },
      required: ["dataset_id"],
    },
  },
  {
    name: "upload_offline_conversions",
    description: "Upload offline events (in-store purchases, CRM-sourced leads, phone sales) to an offline event set. Create the set in Events Manager UI first, then pass offline_set_id here.",
    inputSchema: {
      type: "object",
      properties: {
        offline_set_id: { type: "string", description: "Offline event set ID" },
        events: {
          type: "array",
          minItems: 1,
          maxItems: 2000,
          description: "Same event schema as send_capi_event. event_time can be up to 62 days old for offline events.",
          items: { type: "object" },
        },
        upload_tag: { type: "string", description: "Optional batch label for traceability in Events Manager." },
      },
      required: ["offline_set_id", "events"],
    },
  },
];

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "send_capi_event": {
      const { dataset_id, events, test_event_code } = args;
      const normalized = events.map((e) => ({
        ...e,
        user_data: hashUserData(e.user_data),
        action_source: e.action_source || "website",
      }));
      const body = { data: normalized };
      if (test_event_code) body.test_event_code = test_event_code;
      return client.post(`/${dataset_id}/events`, body);
    }

    case "get_event_match_quality": {
      const { dataset_id } = args;
      // EMQ is exposed via dataset fields (no dedicated endpoint pre-v26)
      return client.get(`/${dataset_id}`, {
        fields: "id,name,last_fired_time,first_party_cookie_status,creation_time,owner_ad_account,enable_automatic_matching,automatic_matching_fields",
      });
    }

    case "upload_offline_conversions": {
      const { offline_set_id, events, upload_tag } = args;
      const normalized = events.map((e) => ({
        ...e,
        user_data: hashUserData(e.user_data),
        action_source: e.action_source || "physical_store",
      }));
      const body = { data: normalized };
      if (upload_tag) body.upload_tag = upload_tag;
      return client.post(`/${offline_set_id}/events`, body);
    }

    default:
      throw new Error(`Unknown CAPI tool: ${toolName}`);
  }
}
