export const tools = [
  {
    name: "create_adset",
    description: "Create a new ad set within a campaign with targeting, budget, and placements",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        campaign_id: { type: "string" },
        name: { type: "string" },
        daily_budget: { type: "number", description: "Daily budget in smallest currency unit (e.g. cents). Required unless campaign has campaign-level budget." },
        lifetime_budget: { type: "number" },
        optimization_goal: {
          type: "string",
          enum: ["OFFSITE_CONVERSIONS", "LINK_CLICKS", "REACH", "IMPRESSIONS", "LANDING_PAGE_VIEWS", "LEAD_GENERATION", "QUALITY_LEAD", "VALUE"],
          description: "What Meta should optimize for",
        },
        billing_event: {
          type: "string",
          enum: ["IMPRESSIONS", "LINK_CLICKS", "APP_INSTALLS"],
          default: "IMPRESSIONS",
        },
        bid_amount: { type: "number", description: "Bid cap in cents. Only for LOWEST_COST_WITH_BID_CAP or COST_CAP strategies." },
        targeting: {
          type: "object",
          description: "Targeting spec object",
          properties: {
            geo_locations: { type: "object", description: "e.g. { countries: ['US'] } or { cities: [...] }" },
            age_min: { type: "number", minimum: 13, maximum: 65 },
            age_max: { type: "number", minimum: 13, maximum: 65 },
            genders: { type: "array", items: { type: "number", enum: [0, 1, 2] }, description: "0=all, 1=male, 2=female" },
            interests: { type: "array", items: { type: "object" }, description: "Array of {id, name} interest objects" },
            behaviors: { type: "array", items: { type: "object" } },
            custom_audiences: { type: "array", items: { type: "object" }, description: "Array of {id} custom audience objects" },
            excluded_custom_audiences: { type: "array", items: { type: "object" } },
            publisher_platforms: { type: "array", items: { type: "string" }, description: "e.g. ['facebook', 'instagram', 'audience_network', 'messenger']" },
            facebook_positions: { type: "array", items: { type: "string" }, description: "e.g. ['feed', 'right_hand_column', 'instant_article', 'marketplace', 'video_feeds']" },
            instagram_positions: { type: "array", items: { type: "string" }, description: "e.g. ['stream', 'story', 'reels', 'explore']" },
          },
        },
        promoted_object: {
          type: "object",
          description: "Required for conversion campaigns. e.g. { pixel_id: '123', custom_event_type: 'PURCHASE' }",
        },
        start_time: { type: "string", description: "ISO 8601" },
        end_time: { type: "string", description: "ISO 8601" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"], default: "PAUSED" },
        attribution_spec: {
          type: "array",
          description: "Default: [{ event_type: 'CLICK_THROUGH', window_days: 7 }, { event_type: 'VIEW_THROUGH', window_days: 1 }]",
        },
      },
      required: ["ad_account_id", "campaign_id", "name", "optimization_goal", "targeting"],
    },
  },
  {
    name: "update_adset",
    description: "Update adset status, budget, targeting, or schedule",
    inputSchema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        daily_budget: { type: "number" },
        lifetime_budget: { type: "number" },
        targeting: { type: "object" },
        end_time: { type: "string" },
        name: { type: "string" },
      },
      required: ["adset_id"],
    },
  },
  {
    name: "get_adset_insights",
    description: "Get performance metrics for an ad set with optional breakdowns",
    inputSchema: {
      type: "object",
      properties: {
        adset_id: { type: "string" },
        date_preset: {
          type: "string",
          enum: ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_28d", "last_30d", "last_90d"],
          default: "last_7d",
        },
        time_increment: { type: "number", default: 1 },
        breakdowns: {
          type: "array",
          items: { type: "string", enum: ["age", "gender", "device_platform", "publisher_platform", "placement"] },
        },
      },
      required: ["adset_id"],
    },
  },
  {
    name: "get_audience_size",
    description: "Estimate the potential reach for a targeting spec before creating an adset",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        targeting_spec: {
          type: "object",
          description: "Same targeting spec object used in create_adset",
        },
        optimization_goal: { type: "string", description: "Affects delivery estimate" },
      },
      required: ["ad_account_id", "targeting_spec"],
    },
  },
];

const INSIGHT_FIELDS = "impressions,clicks,spend,reach,ctr,cpc,cpm,frequency,actions,action_values,cost_per_action_type,purchase_roas,unique_clicks";

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "create_adset": {
      const { ad_account_id, ...body } = args;
      if (body.daily_budget) body.daily_budget = String(body.daily_budget);
      if (body.lifetime_budget) body.lifetime_budget = String(body.lifetime_budget);
      if (body.bid_amount) body.bid_amount = String(body.bid_amount);
      if (body.targeting) body.targeting = JSON.stringify(body.targeting);
      if (body.promoted_object) body.promoted_object = JSON.stringify(body.promoted_object);
      if (body.attribution_spec) {
        body.attribution_spec = JSON.stringify(body.attribution_spec);
      } else {
        body.attribution_spec = JSON.stringify([
          { event_type: "CLICK_THROUGH", window_days: 7 },
          { event_type: "VIEW_THROUGH", window_days: 1 },
        ]);
      }
      return client.post(`/${client.act(ad_account_id)}/adsets`, body);
    }

    case "update_adset": {
      const { adset_id, ...body } = args;
      if (body.daily_budget) body.daily_budget = String(body.daily_budget);
      if (body.lifetime_budget) body.lifetime_budget = String(body.lifetime_budget);
      if (body.targeting) body.targeting = JSON.stringify(body.targeting);
      return client.post(`/${adset_id}`, body);
    }

    case "get_adset_insights": {
      const { adset_id, date_preset = "last_7d", time_increment = 1, breakdowns } = args;
      const params = { fields: INSIGHT_FIELDS, date_preset, time_increment };
      if (breakdowns?.length) params.breakdowns = breakdowns.join(",");
      return client.get(`/${adset_id}/insights`, params);
    }

    case "get_audience_size": {
      const { ad_account_id, targeting_spec, optimization_goal } = args;
      const params = {
        targeting_spec: JSON.stringify(targeting_spec),
        fields: "users_lower_bound,users_upper_bound,estimate_ready",
      };
      if (optimization_goal) params.optimization_goal = optimization_goal;
      return client.get(`/${client.act(ad_account_id)}/reachestimate`, params);
    }

    default:
      throw new Error(`Unknown adset tool: ${toolName}`);
  }
}
