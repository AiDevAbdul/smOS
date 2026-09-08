// mcp/ui-permission-bridge/index.js — stdio MCP server implementing Claude
// Code's `--permission-prompt-tool` contract, bridging headless permission
// checks to the smOS operator UI (ui/) so a human can Allow/Deny from a
// browser instead of the run silently auto-denying (or auto-allowing).
//
// ── How the run gets here ──────────────────────────────────────────────
// ui/lib/registry.ts's startRun(), when called with `usePermissionBridge:
// true`, spawns:
//   claude -p <prompt> --output-format stream-json --verbose \
//     --permission-prompt-tool mcp__ui-permission-bridge__approve
// with env var SMOS_UI_RUN_ID=<runId> set on the child process. Claude Code
// invokes the named MCP tool for every permission check that would
// otherwise prompt interactively; this process must be reachable as an MCP
// server named "ui-permission-bridge" exposing one tool named "approve" for
// that tool path (mcp__<server-name>__<tool-name>) to resolve.
//
// ── Registering this server (operator does this once, out of band) ─────
// This script does NOT self-register — Claude Code must already know about
// it before a run passes --permission-prompt-tool. Either:
//   claude mcp add ui-permission-bridge -- node mcp/ui-permission-bridge/index.js
// (run from the repo root, so the relative path resolves) or a `.mcp.json`
// entry at the repo root:
//   {
//     "mcpServers": {
//       "ui-permission-bridge": {
//         "command": "node",
//         "args": ["mcp/ui-permission-bridge/index.js"]
//       }
//     }
//   }
// `claude mcp add` requires one-time interactive confirmation the same way
// meta-official does (see CLAUDE.md) — cannot be scripted from a
// non-interactive run, and this file must never attempt to run that command
// itself.
//
// ── The permission-prompt-tool schema (BEST-EFFORT — verify against your
//    installed Claude Code version; this is the documented shape as of the
//    2.1.x CLI, may need real-world correction) ─────────────────────────
// Claude Code calls the tool with input:
//   { tool_name: string, input: object, ...maybe more fields }
// and expects the CallTool result's content[0].text to be a JSON string of
// EITHER:
//   { "behavior": "allow", "updatedInput": <object> }   — proceed, optionally
//     with a modified tool input (we always pass the input straight through
//     unmodified since the UI only decides yes/no, never edits args)
//   { "behavior": "deny", "message": <string> }         — block, with a
//     human-readable reason surfaced back to the model/transcript
// We implement exactly that shape. If your Claude Code version expects a
// different envelope, this is the one place to adjust it.
//
// ── The bridge loop ──────────────────────────────────────────────────────
// On each call: POST {runId, toolName, input} to the UI server's
// /api/permissions, getting back {id}. Poll GET /api/permissions/:id every
// ~500ms until status !== "pending" or ~5 minutes elapse, then return the
// human's decision — or deny-closed on timeout/any error, matching this
// repo's fail-closed posture (CLAUDE.md: guardrails fail closed, never
// silently proceed).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const UI_BASE_URL = process.env.SMOS_UI_BASE_URL || "http://localhost:3000";
const RUN_ID = process.env.SMOS_UI_RUN_ID || null;
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 5 * 60_000; // deny-closed after ~5 minutes of silence

function denyResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ behavior: "deny", message }) }],
  };
}

function allowResult(updatedInput) {
  return {
    content: [{ type: "text", text: JSON.stringify({ behavior: "allow", updatedInput }) }],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestPermission(toolName, input) {
  let created;
  try {
    const res = await fetch(`${UI_BASE_URL}/api/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: RUN_ID, toolName, input }),
    });
    if (!res.ok) {
      return denyResult(`ui-permission-bridge: /api/permissions returned ${res.status} — denying closed`);
    }
    created = await res.json();
  } catch (err) {
    // The operator UI isn't reachable — fail closed rather than silently
    // allowing a consequential Meta-API / filesystem action to proceed.
    return denyResult(`ui-permission-bridge: could not reach ${UI_BASE_URL} (${err.message}) — denying closed`);
  }

  const id = created?.id;
  if (!id) {
    return denyResult("ui-permission-bridge: /api/permissions did not return an id — denying closed");
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const res = await fetch(`${UI_BASE_URL}/api/permissions/${encodeURIComponent(id)}`);
      if (!res.ok) continue; // transient — keep polling until deadline
      const { record } = await res.json();
      if (record?.status === "decided" && record.decision) {
        if (record.decision.behavior === "allow") {
          return allowResult(input);
        }
        return denyResult(record.decision.note || "Denied by operator");
      }
    } catch {
      // transient network hiccup — keep polling until deadline
    }
  }

  return denyResult("ui-permission-bridge: no operator decision within timeout — denying closed");
}

const server = new Server(
  { name: "ui-permission-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "approve",
      description:
        "Permission-prompt-tool target: routes a Claude Code tool-use permission check to the smOS operator UI and blocks until a human clicks Allow or Deny (or the request times out and is denied closed).",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "Name of the tool Claude Code wants to invoke" },
          input: { type: "object", description: "The proposed input/arguments for that tool call" },
        },
        required: ["tool_name", "input"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "approve") {
    return denyResult(`ui-permission-bridge: unknown tool "${name}" — denying closed`);
  }
  const toolName = args?.tool_name ?? args?.toolName ?? "unknown";
  const input = args?.input ?? {};
  return requestPermission(toolName, input);
});

const transport = new StdioServerTransport();
await server.connect(transport);
