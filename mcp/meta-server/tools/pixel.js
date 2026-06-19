export const tools = [
  {
    name: "get_pixel_events",
    description: "Get recent pixel event firing stats — which events are active, last fired time, and event counts",
    inputSchema: {
      type: "object",
      properties: {
        pixel_id: { type: "string" },
        days: { type: "number", description: "Look back window in days (default 7)", default: 7 },
      },
      required: ["pixel_id"],
    },
  },
  {
    name: "check_pixel_health",
    description: "Score the pixel health: checks required events are firing, measures recency, returns pass/fail per event type",
    inputSchema: {
      type: "object",
      properties: {
        pixel_id: { type: "string" },
        required_events: {
          type: "array",
          items: { type: "string" },
          description: "Events to check for. Defaults to ['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']",
          default: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
        },
      },
      required: ["pixel_id"],
    },
  },
  {
    name: "get_attribution_stats",
    description: "Get view-through vs click-through attribution breakdown for a campaign",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30d"], default: "last_7d" },
      },
      required: ["campaign_id"],
    },
  },
  {
    name: "get_account_pixels",
    description: "List all pixels associated with an ad account",
    inputSchema: {
      type: "object",
      properties: {
        ad_account_id: { type: "string" },
      },
      required: ["ad_account_id"],
    },
  },
];

export async function handle(toolName, args, client) {
  switch (toolName) {
    case "get_pixel_events": {
      const { pixel_id, days = 7 } = args;
      const since = Math.floor(Date.now() / 1000) - days * 86400;
      return client.get(`/${pixel_id}/stats`, {
        aggregation: "event_name",
        start_time: since,
        end_time: Math.floor(Date.now() / 1000),
      });
    }

    case "check_pixel_health": {
      const { pixel_id, required_events = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"] } = args;
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;

      const [statsRes, pixelInfo] = await Promise.all([
        client.get(`/${pixel_id}/stats`, {
          aggregation: "event_name",
          start_time: since,
          end_time: Math.floor(Date.now() / 1000),
        }),
        client.get(`/${pixel_id}`, { fields: "id,name,last_fired_time,creation_time" }),
      ]);

      // last_fired_time comes back as ISO string (e.g. "2026-06-16T23:21:24+0500")
      const lastFiredDate = pixelInfo.last_fired_time ? new Date(pixelInfo.last_fired_time) : null;
      const daysSinceLastFire = lastFiredDate ? Math.floor((Date.now() - lastFiredDate.getTime()) / 86400000) : null;

      const firedEvents = new Set((statsRes.data || []).map((e) => e.event_name));
      const checks = required_events.map((event) => ({
        event,
        status: firedEvents.has(event) ? "PASS" : "FAIL",
        count: (statsRes.data || []).find((e) => e.event_name === event)?.count || 0,
      }));

      const passing = checks.filter((c) => c.status === "PASS").length;
      const score = Math.round((passing / required_events.length) * 100);
      const health = score === 100 ? "full" : score >= 50 ? "partial" : "none";

      return {
        pixel_id,
        pixel_name: pixelInfo.name,
        last_fired_time: pixelInfo.last_fired_time,
        days_since_last_fire: daysSinceLastFire,
        health,
        score,
        checks,
      };
    }

    case "get_attribution_stats": {
      const { campaign_id, date_preset = "last_7d" } = args;
      return client.get(`/${campaign_id}/insights`, {
        fields: "actions,action_values",
        date_preset,
        action_attribution_windows: JSON.stringify(["1d_view", "7d_click", "28d_click"]),
        action_breakdowns: JSON.stringify(["action_type", "action_reaction"]),
      });
    }

    case "get_account_pixels": {
      const { ad_account_id } = args;
      return client.get(`/${client.act(ad_account_id)}/adspixels`, {
        fields: "id,name,last_fired_time,creation_time,owner_business",
      });
    }

    default:
      throw new Error(`Unknown pixel tool: ${toolName}`);
  }
}
