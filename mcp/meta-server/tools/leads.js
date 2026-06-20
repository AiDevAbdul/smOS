/**
 * Lead generation tools — lead forms, lead retrieval, real-time webhooks.
 *
 * Endpoints (v25.0):
 *   POST /{page_id}/leadgen_forms        — create a form
 *   GET  /{page_id}/leadgen_forms        — list forms
 *   GET  /{form_id}                       — form metadata
 *   GET  /{form_id}/leads                — retrieve submitted leads
 *   GET  /{lead_id}                       — single lead detail
 *   POST /{app_id}/subscriptions          — subscribe to lead webhooks
 *
 * Lead forms require a Page access token, not the user token.
 *
 * Leads expire from Meta's storage after 90 days — pull regularly.
 */

export const tools = [
  {
    name: "create_lead_form",
    description: "Create a Meta lead generation form attached to a Facebook Page. Returns the form ID for use in ad creatives.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        page_access_token: { type: "string", description: "Required. Page-level token; user token will not work." },
        name: { type: "string", description: "Internal form name (not shown to users)" },
        locale: { type: "string", default: "en_US" },
        privacy_policy: {
          type: "object",
          description: "REQUIRED by Meta. {url: '...', link_text: '...'}",
          properties: {
            url: { type: "string" },
            link_text: { type: "string" },
          },
          required: ["url", "link_text"],
        },
        questions: {
          type: "array",
          description: "Array of {type, key?, label?, options?}. Standard types: FULL_NAME, EMAIL, PHONE, CITY, STATE, ZIP_CODE, COUNTRY, COMPANY_NAME, JOB_TITLE. Custom: type='CUSTOM' + key + label.",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              key: { type: "string", description: "Required for CUSTOM" },
              label: { type: "string", description: "Required for CUSTOM" },
              options: { type: "array", items: { type: "object" } },
            },
            required: ["type"],
          },
        },
        thank_you_page: {
          type: "object",
          description: "{title, body, button_text, button_type?: 'VIEW_WEBSITE'|'CALL_BUSINESS'|'DOWNLOAD', website_url?, business_phone_number?}",
        },
        context_card: {
          type: "object",
          description: "Optional intro card. {content, title?, style?: 'PARAGRAPH_STYLE'|'LIST_STYLE'}",
        },
        block_duplicate_lead: { type: "boolean", description: "Reject same email twice. Default false.", default: false },
        follow_up_action_url: { type: "string", description: "URL Meta opens after form submission (if button_type=VIEW_WEBSITE)." },
      },
      required: ["page_id", "page_access_token", "name", "privacy_policy", "questions"],
    },
  },
  {
    name: "get_lead_forms",
    description: "List lead forms attached to a Facebook Page.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        page_access_token: { type: "string" },
        limit: { type: "number", default: 100 },
        status: { type: "string", enum: ["ACTIVE", "ARCHIVED", "DRAFT", "DELETED", "ALL"], default: "ACTIVE" },
      },
      required: ["page_id", "page_access_token"],
    },
  },
  {
    name: "get_lead_form",
    description: "Get a single lead form's structure (questions, thank-you page, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        page_access_token: { type: "string" },
      },
      required: ["form_id", "page_access_token"],
    },
  },
  {
    name: "get_leads",
    description: "Retrieve submitted leads from a form. Default returns last 100 — paginate for more. Leads older than 90 days expire from Meta storage.",
    inputSchema: {
      type: "object",
      properties: {
        form_id: { type: "string" },
        page_access_token: { type: "string" },
        limit: { type: "number", default: 100 },
        since: { type: "string", description: "ISO date or unix timestamp" },
        until: { type: "string", description: "ISO date or unix timestamp" },
      },
      required: ["form_id", "page_access_token"],
    },
  },
  {
    name: "get_lead",
    description: "Get a single lead by lead_id. Useful for webhook-delivered leads where you only get the ID and need to fetch full data.",
    inputSchema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        page_access_token: { type: "string" },
      },
      required: ["lead_id", "page_access_token"],
    },
  },
  {
    name: "subscribe_lead_webhook",
    description: "Subscribe a webhook endpoint to receive lead notifications in real-time. Requires an app_id and a verified webhook URL.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        page_access_token: { type: "string" },
        subscribed_fields: {
          type: "array",
          items: { type: "string" },
          default: ["leadgen"],
          description: "Page-level webhook fields. 'leadgen' fires when a new lead is submitted.",
        },
      },
      required: ["page_id", "page_access_token"],
    },
  },
];

function token(args) {
  return args.page_access_token || process.env.META_PAGE_TOKEN;
}

function asAccessParams(t) {
  return t ? { access_token: t } : {};
}

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "create_lead_form": {
      const { page_id, page_access_token, ...body } = args;
      const t = token(args);
      if (!t) throw new Error("create_lead_form requires a Page access token (META_PAGE_TOKEN or page_access_token arg)");

      // Meta needs nested objects JSON-encoded
      const payload = { access_token: t };
      for (const [k, v] of Object.entries(body)) {
        if (v != null && typeof v === "object") payload[k] = JSON.stringify(v);
        else if (v != null) payload[k] = v;
      }
      return client.post(`/${page_id}/leadgen_forms`, payload);
    }

    case "get_lead_forms": {
      const { page_id, limit = 100, status = "ACTIVE" } = args;
      const t = token(args);
      const params = {
        fields: "id,name,locale,status,leads_count,created_time,questions",
        limit: Math.min(limit, 200),
        ...asAccessParams(t),
      };
      if (status !== "ALL") params.filtering = JSON.stringify([{ field: "status", operator: "EQUAL", value: status }]);
      return client.get(`/${page_id}/leadgen_forms`, params);
    }

    case "get_lead_form": {
      const { form_id } = args;
      const t = token(args);
      return client.get(`/${form_id}`, {
        fields: "id,name,locale,status,leads_count,created_time,questions,thank_you_page,privacy_policy,context_card,block_duplicate_lead",
        ...asAccessParams(t),
      });
    }

    case "get_leads": {
      const { form_id, limit = 100, since, until } = args;
      const t = token(args);
      const params = {
        fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data,is_organic,platform",
        limit: Math.min(limit, 500),
        ...asAccessParams(t),
      };
      if (since) params.since = since;
      if (until) params.until = until;
      return client.get(`/${form_id}/leads`, params);
    }

    case "get_lead": {
      const { lead_id } = args;
      const t = token(args);
      return client.get(`/${lead_id}`, {
        fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data,is_organic,platform",
        ...asAccessParams(t),
      });
    }

    case "subscribe_lead_webhook": {
      const { page_id, subscribed_fields = ["leadgen"] } = args;
      const t = token(args);
      if (!t) throw new Error("subscribe_lead_webhook requires a Page access token");
      return client.post(`/${page_id}/subscribed_apps`, {
        access_token: t,
        subscribed_fields: subscribed_fields.join(","),
      });
    }

    default:
      throw new Error(`Unknown leads tool: ${toolName}`);
  }
}
