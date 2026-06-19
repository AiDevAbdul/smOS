export const tools = [
  {
    name: "get_campaigns",
    description: "List campaigns for an ad account with optional status and date filters",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string", description: "Ad account ID (e.g. act_123456789 or just 123456789)" },
        status: {
          type: "array",
          items: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "IN_PROCESS", "WITH_ISSUES"] },
          description: "Filter by campaign status. Omit for all non-archived.",
        },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
      },
      required: ["ad_account_id"],
    },
  },
  {
    name: "create_campaign",
    description: "Create a new Meta ad campaign",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        name: { type: "string", description: "Campaign name — must follow naming convention" },
        objective: {
          type: "string",
          enum: ["OUTCOME_TRAFFIC", "OUTCOME_SALES", "OUTCOME_LEADS", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION"],
          description: "Campaign objective. NOTE (v24+): legacy Advantage+ Shopping (smart_promotion_type=AUTOMATED_SHOPPING_ADS) and AAC are deprecated. For Advantage+ Sales, use OUTCOME_SALES + is_advantage_plus_shopping=true and configure Advantage+ levers at the adset (advantage_plus shortcut on create_adset).",
        },
        status: { type: "string", enum: ["ACTIVE", "PAUSED"], default: "PAUSED" },
        daily_budget: { type: "number", description: "Daily budget in account currency (smallest unit, e.g. cents for USD)" },
        lifetime_budget: { type: "number", description: "Lifetime budget — use instead of daily_budget for fixed-end campaigns" },
        bid_strategy: {
          type: "string",
          enum: ["LOWEST_COST_WITHOUT_CAP", "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"],
          default: "LOWEST_COST_WITHOUT_CAP",
        },
        special_ad_categories: {
          type: "array",
          items: { type: "string" },
          description: "Required for housing, employment, credit, or social issues ads. Pass [] if none.",
          default: [],
        },
        start_time: { type: "string", description: "ISO 8601 start time. Omit to start immediately." },
        stop_time: { type: "string", description: "ISO 8601 end time. Required if using lifetime_budget." },
        is_advantage_plus_shopping: {
          type: "boolean",
          description: "v24+: marks this as an Advantage+ Sales campaign under the new unified framework. Pair with OUTCOME_SALES objective and Advantage+ levers on the adset.",
        },
      },
      required: ["ad_account_id", "name", "objective", "special_ad_categories"],
    },
  },
  {
    name: "update_campaign",
    description: "Update campaign status, budget, name, or bid strategy",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        daily_budget: { type: "number" },
        lifetime_budget: { type: "number" },
        name: { type: "string" },
        bid_strategy: { type: "string" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "get_campaign_insights",
    description: "Get performance metrics for a campaign with optional time breakdown",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        date_preset: {
          type: "string",
          enum: ["today", "yesterday", "last_3d", "last_7d", "last_14d", "last_28d", "last_30d", "last_90d", "this_month", "last_month"],
          default: "last_7d",
        },
        time_increment: { type: "number", description: "Daily breakdown = 1. Total only = omit.", default: 1 },
        breakdowns: {
          type: "array",
          items: { type: "string", enum: ["age", "gender", "device_platform", "publisher_platform", "placement", "country"] },
          description: "Optional dimension breakdowns",
        },
      },
      required: ["campaign_id"],
    },
  },
];

const INSIGHT_FIELDS = "impressions,clicks,spend,reach,ctr,cpc,cpm,frequency,actions,action_values,cost_per_action_type,purchase_roas,unique_clicks,unique_ctr";

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "get_campaigns": {
      const { ad_account_id, status, limit = 50 } = args;
      const params = {
        fields: "id,name,status,objective,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time,created_time,updated_time",
        limit: Math.min(limit, 200),
      };
      if (status?.length) {
        params.filtering = JSON.stringify([{ field: "effective_status", operator: "IN", value: status }]);
      }
      return client.get(`/${client.act(ad_account_id)}/campaigns`, params);
    }

    case "create_campaign": {
      const { ad_account_id, ...body } = args;
      if (body.daily_budget) body.daily_budget = String(body.daily_budget);
      if (body.lifetime_budget) body.lifetime_budget = String(body.lifetime_budget);
      return client.post(`/${client.act(ad_account_id)}/campaigns`, body);
    }

    case "update_campaign": {
      const { campaign_id, ...body } = args;
      if (body.daily_budget) body.daily_budget = String(body.daily_budget);
      if (body.lifetime_budget) body.lifetime_budget = String(body.lifetime_budget);
      return client.post(`/${campaign_id}`, body);
    }

    case "get_campaign_insights": {
      const { campaign_id, date_preset = "last_7d", time_increment, breakdowns } = args;
      const params = {
        fields: INSIGHT_FIELDS,
        date_preset,
      };
      if (time_increment) params.time_increment = time_increment;
      if (breakdowns?.length) params.breakdowns = breakdowns.join(",");
      return client.get(`/${campaign_id}/insights`, params);
    }

    default:
      throw new Error(`Unknown campaign tool: ${toolName}`);
  }
}
