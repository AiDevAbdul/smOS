export const tools = [
  {
    name: "get_custom_audiences",
    description: "List all custom audiences in an ad account with sizes and metadata",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
      },
      required: ["ad_account_id"],
    },
  },
  {
    name: "create_lookalike",
    description: "Create a lookalike audience from a seed custom audience",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        name: { type: "string" },
        seed_audience_id: { type: "string", description: "Custom audience ID to use as the seed" },
        country: { type: "string", description: "2-letter country code, e.g. 'US'" },
        ratio: {
          type: "number",
          minimum: 0.01,
          maximum: 0.20,
          description: "Size as % of country population. 0.01 = 1% (most similar), 0.10 = 10% (broader reach)",
        },
        type: {
          type: "string",
          enum: ["similarity", "reach"],
          default: "similarity",
          description: "similarity = tighter match, reach = larger audience",
        },
      },
      required: ["ad_account_id", "name", "seed_audience_id", "country", "ratio"],
    },
  },
  {
    name: "get_saved_audiences",
    description: "List saved (interest-based) audiences in an ad account",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
      },
      required: ["ad_account_id"],
    },
  },
  {
    name: "estimate_audience_overlap",
    description: "Check audience overlap between adsets to detect over-saturation",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        audience_ids: {
          type: "array",
          items: { type: "string" },
          description: "List of 2–5 custom audience IDs to check overlap between",
          minItems: 2,
          maxItems: 5,
        },
      },
      required: ["ad_account_id", "audience_ids"],
    },
  },
  {
    name: "search_interests",
    description: "Search for Facebook interest targeting options by keyword",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        query: { type: "string", description: "Interest keyword to search for" },
        limit: { type: "number", default: 20 },
      },
      required: ["ad_account_id", "query"],
    },
  },
];

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "get_custom_audiences": {
      const { ad_account_id } = args;
      return client.get(`/${client.act(ad_account_id)}/customaudiences`, {
        fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,data_source,creation_time,operation_status,time_updated",
        limit: 200,
      });
    }

    case "create_lookalike": {
      const { ad_account_id, name, seed_audience_id, country, ratio, type = "similarity" } = args;
      return client.post(`/${client.act(ad_account_id)}/customaudiences`, {
        subtype: "LOOKALIKE",
        name,
        lookalike_spec: JSON.stringify({
          type,
          ratio,
          country,
          origin: [{ id: seed_audience_id, type: "CUSTOM_AUDIENCE" }],
        }),
      });
    }

    case "get_saved_audiences": {
      const { ad_account_id } = args;
      return client.get(`/${client.act(ad_account_id)}/saved_audiences`, {
        fields: "id,name,targeting,approximate_count,time_updated",
        limit: 100,
      });
    }

    case "estimate_audience_overlap": {
      const { ad_account_id, audience_ids } = args;
      return client.get(`/${client.act(ad_account_id)}/audienceoverlap`, {
        audiences: JSON.stringify(audience_ids.map((id) => ({ id }))),
        fields: "overlap_estimate",
      });
    }

    case "search_interests": {
      const { ad_account_id, query, limit = 20 } = args;
      return client.get(`/search`, {
        type: "adinterest",
        q: query,
        limit,
      });
    }

    default:
      throw new Error(`Unknown audience tool: ${toolName}`);
  }
}
