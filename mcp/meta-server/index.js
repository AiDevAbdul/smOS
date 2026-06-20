import { loadEnv } from "../../scripts/lib/load-env.js";
loadEnv();
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMetaClient } from "./meta-client.js";

import * as campaigns from "./tools/campaigns.js";
import * as adsets from "./tools/adsets.js";
import * as ads from "./tools/ads.js";
import * as audiences from "./tools/audiences.js";
import * as pixel from "./tools/pixel.js";
import * as pageInsights from "./tools/page-insights.js";
import * as publishing from "./tools/publishing.js";
import * as capi from "./tools/capi.js";
import * as rules from "./tools/rules.js";
import * as leads from "./tools/leads.js";
import * as catalog from "./tools/catalog.js";

const ALL_TOOLS = [
  ...campaigns.tools,
  ...adsets.tools,
  ...ads.tools,
  ...audiences.tools,
  ...pixel.tools,
  ...pageInsights.tools,
  ...publishing.tools,
  ...capi.tools,
  ...rules.tools,
  ...leads.tools,
  ...catalog.tools,
];

// Map tool name → handler module
const TOOL_HANDLERS = new Map();
for (const mod of [campaigns, adsets, ads, audiences, pixel, pageInsights, publishing, capi, rules, leads, catalog]) {
  for (const tool of mod.tools) {
    TOOL_HANDLERS.set(tool.name, mod);
  }
}

const server = new Server(
  { name: "smos-meta", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ALL_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = TOOL_HANDLERS.get(name);
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const client = createMetaClient();
    const result = await handler.handle(name, args, client);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("smOS Meta MCP server running");
