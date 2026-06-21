/**
 * Meta Automated Rules tools — rules execute on Meta's servers.
 *
 * Why this matters: smOS's optimizer agent runs daily at 08:00. If a campaign
 * burns budget at 2 AM, you don't know until 8 AM. Automated Rules let Meta
 * pause/scale/notify on metric breaches in real time without smOS uptime.
 *
 * Endpoints (v25.0):
 *   POST /act_{ad_account_id}/adrules_library
 *   GET  /act_{ad_account_id}/adrules_library
 *   GET  /{rule_id}/history
 *   POST /{rule_id}/preview     — see which entities would currently match
 *
 * Rule shape (the heavy bit):
 *   {
 *     name,
 *     evaluation_spec: {
 *       evaluation_type: "SCHEDULE",         // run on Meta's schedule (semi-hourly)
 *       filters: [ { field, operator, value } ],
 *       trigger: { type: "SCHEDULE", schedule_spec: {...} }  // optional fine-grained
 *     },
 *     execution_spec: {
 *       execution_type: "PAUSE" | "UNPAUSE" | "CHANGE_BUDGET" | "NOTIFICATION" | "REBALANCE_BUDGET",
 *       execution_options: [ { field: "user_id", value: [...] }, ... ]
 *     },
 *     schedule_spec: { schedule_type: "SEMI_HOURLY" | "DAILY" | "CUSTOM", schedule: [...] },
 *     account_id, status: "ENABLED"|"DISABLED"
 *   }
 */

export const tools = [
  {
    name: "create_automated_rule",
    description: "Create an automated rule that runs on Meta's servers. Common shapes: pause when CPA > threshold, scale when ROAS sustained, notify on anomaly. The rule fires server-side and does not require smOS to be online.",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string", description: "Ad account ID" },
        name: { type: "string", description: "Human-readable rule name. Convention: '<ACTION>_<METRIC>_<SCOPE>' e.g. 'PAUSE_CPA_3X_TARGET'" },
        status: { type: "string", enum: ["ENABLED", "DISABLED"], default: "ENABLED" },
        evaluation_spec: {
          type: "object",
          description: "Triggers + filters. evaluation_type='SCHEDULE' is standard. filters: array of {field, operator, value}.",
          properties: {
            evaluation_type: { type: "string", enum: ["SCHEDULE", "TRIGGER"], default: "SCHEDULE" },
            filters: {
              type: "array",
              description: "Conditions. Example: [{field:'spent', operator:'GREATER_THAN', value:50}, {field:'cost_per_action_type:offsite_conversion.fb_pixel_purchase', operator:'GREATER_THAN', value:150}]",
              items: {
                type: "object",
                properties: {
                  field: { type: "string", description: "e.g. spent, cost_per_action_type:offsite_conversion.fb_pixel_purchase, website_purchase_roas, ctr, frequency, impressions" },
                  operator: { type: "string", enum: ["GREATER_THAN", "LESS_THAN", "EQUAL", "IN_RANGE", "NOT_IN_RANGE", "NOT_EQUAL"] },
                  value: { description: "Number, array, or string depending on operator" },
                },
                required: ["field", "operator", "value"],
              },
            },
            time_window: {
              type: "string",
              description: "How far back to evaluate the metric. e.g. 'LAST_3_DAYS', 'LAST_7_DAYS', 'LIFETIME', 'TODAY', 'YESTERDAY'",
            },
          },
          required: ["filters"],
        },
        execution_spec: {
          type: "object",
          description: "What to do when filters match.",
          properties: {
            execution_type: {
              type: "string",
              enum: ["PAUSE", "UNPAUSE", "CHANGE_BUDGET", "REBALANCE_BUDGET", "NOTIFICATION", "MESSAGE_ADGROUP"],
            },
            execution_options: {
              type: "array",
              description: "Options. For CHANGE_BUDGET: [{field:'change_spec', value:{type:'ABSOLUTE'|'PERCENT', value:N}}]. For NOTIFICATION: user IDs to ping.",
              items: { type: "object" },
            },
          },
          required: ["execution_type"],
        },
        schedule_spec: {
          type: "object",
          description: "When to run. Default SEMI_HOURLY (every 30 min). Use {schedule_type:'CUSTOM', schedule:[{days:[1,2,3,4,5], start_minute:540, end_minute:1260}]} for business hours only.",
          properties: {
            schedule_type: { type: "string", enum: ["SEMI_HOURLY", "DAILY", "CUSTOM"], default: "SEMI_HOURLY" },
            schedule: { type: "array", items: { type: "object" } },
          },
        },
        entities: {
          type: "object",
          description: "Scope: what entities the rule evaluates. e.g. {entity_type:'AD'} or {entity_type:'CAMPAIGN', ids:['...']}. Required.",
          properties: {
            entity_type: { type: "string", enum: ["CAMPAIGN", "ADSET", "AD"] },
            ids: { type: "array", items: { type: "string" }, description: "Specific entity IDs. Omit to scope to all in account." },
          },
          required: ["entity_type"],
        },
      },
      required: ["ad_account_id", "name", "evaluation_spec", "execution_spec", "entities"],
    },
  },
  {
    name: "get_rules",
    description: "List all automated rules on an ad account. Returns rule definitions, status, and last-run timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
        status: { type: "string", enum: ["ENABLED", "DISABLED", "ALL"], default: "ALL" },
        limit: { type: "number", description: "Total max results across pages (default 500). Paginates automatically." },
      },
      required: ["ad_account_id"],
    },
  },
  {
    name: "get_rule_history",
    description: "Get the execution history (audit trail) for a single automated rule. Shows what the rule did, when, and to which entities.",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "string" },
        limit: { type: "number", default: 100 },
        since: { type: "string", description: "ISO date to limit history" },
      },
      required: ["rule_id"],
    },
  },
  {
    name: "preview_rule",
    description: "Dry-run a rule's filters against current account state — returns which entities WOULD match without executing the action. Use before flipping status to ENABLED.",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "string" },
      },
      required: ["rule_id"],
    },
  },
  {
    name: "update_rule",
    description: "Update an existing rule's status, name, or specs. Common use: temporarily DISABLE during a holiday push.",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "string" },
        status: { type: "string", enum: ["ENABLED", "DISABLED"] },
        name: { type: "string" },
        evaluation_spec: { type: "object" },
        execution_spec: { type: "object" },
      },
      required: ["rule_id"],
    },
  },
  {
    name: "delete_rule",
    description: "Permanently delete an automated rule. Prefer DISABLE via update_rule unless you're sure.",
    inputSchema: {
      type: "object",
      properties: { rule_id: { type: "string" } },
      required: ["rule_id"],
    },
  },
];

function serializeBody(input) {
  // Meta accepts JSON-stringified nested objects on POST bodies
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v != null && typeof v === "object") out[k] = JSON.stringify(v);
    else if (v != null) out[k] = v;
  }
  return out;
}

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "create_automated_rule": {
      const { ad_account_id, ...rest } = args;
      const body = serializeBody(rest);
      return client.post(`/${client.act(ad_account_id)}/adrules_library`, body);
    }

    case "get_rules": {
      const { ad_account_id, status = "ALL", limit = 500 } = args;
      const params = {
        fields: "id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time",
        limit: 100,
      };
      if (status !== "ALL") params.filtering = JSON.stringify([{ field: "status", operator: "EQUAL", value: status }]);
      const data = await client.paginate(`/${client.act(ad_account_id)}/adrules_library`, params, limit);
      return { data };
    }

    case "get_rule_history": {
      const { rule_id, limit = 100, since } = args;
      const params = {
        fields: "evaluation_type,results,timestamp,object_count,action,error_code,error_message",
        limit: Math.min(limit, 200),
      };
      if (since) params.since = since;
      return client.get(`/${rule_id}/history`, params);
    }

    case "preview_rule": {
      const { rule_id } = args;
      return client.post(`/${rule_id}/preview`, {});
    }

    case "update_rule": {
      const { rule_id, ...rest } = args;
      return client.post(`/${rule_id}`, serializeBody(rest));
    }

    case "delete_rule": {
      const { rule_id } = args;
      return client.delete(`/${rule_id}`);
    }

    default:
      throw new Error(`Unknown rules tool: ${toolName}`);
  }
}
