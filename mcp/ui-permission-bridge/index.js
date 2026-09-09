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
// ── Registering this server ────────────────────────────────────────────
// ui/lib/registry.ts registers this server *per run*, by passing an inline
// `--mcp-config '{"mcpServers":{"ui-permission-bridge":{...}}}'` alongside
// --permission-prompt-tool. That needs no `claude mcp add`, no repo-root
// `.mcp.json`, and no one-time interactive confirmation — an inline
// --mcp-config server is available to the run that declares it and nothing
// else. Note registry.ts deliberately does NOT pass --strict-mcp-config, so
// the repo's own MCP servers (meta, tavily, …) still load for the run.
//
// This script still does NOT self-register: if you want it available to
// interactive sessions too, that is a separate, human-run
// `claude mcp add ui-permission-bridge -- node mcp/ui-permission-bridge/index.js`
// (from the repo root) — and this file must never attempt to run it itself.
//
// ── The permission-prompt-tool schema (VERIFIED against Claude Code
//    2.1.265 on 2026-09-09 — probe MCP server + real `claude -p` run,
//    both the allow and the deny path) ──────────────────────────────────
// Claude Code calls the tool with arguments:
//   { tool_name: string, input: object, tool_use_id: string }
// plus a `_meta` sibling on params carrying `claudecode/toolUseId` and a
// `progressToken`. Observed frame, verbatim:
//   { "method": "tools/call", "params": {
//       "name": "approve",
//       "arguments": { "tool_name": "Write",
//                      "input": { "file_path": "…", "content": "probe\n" },
//                      "tool_use_id": "toolu_01RHKtPfNikXqKqjF3ZsbTih" },
//       "_meta": { "claudecode/toolUseId": "toolu_01RHK…", "progressToken": 2 } } }
// The result must be a SINGLE text block — the CLI rejects anything else with
// "Permission prompt tool returned an invalid result. Expected a single text
// block param with type=\"text\" and a string text value." — whose `text` is
// a JSON string of EITHER:
//   { "behavior": "allow", "updatedInput": <object> }   — proceed, optionally
//     with a modified tool input. `updatedInput` is optional, but omitting it
//     logs "updatedInput is missing or empty, falling back to original tool
//     input", so we always pass the input straight through unmodified (the UI
//     only decides yes/no, never edits args).
//   { "behavior": "deny", "message": <string> }         — block; `message` is
//     surfaced verbatim as the tool_result the model sees, and the call is
//     listed in the run's final `result` event under `permission_denials`.
// The CLI's own validator string confirms the contract: "Expected {behavior:
// 'allow', updatedInput?: object} or {behavior: 'deny', message: string}."
//
// Two constraints worth remembering:
//   - `--permission-prompt-tool` only works with `--print` (`-p`). registry.ts
//     always spawns with `-p`, so this holds.
//   - The tool is only consulted for calls that would actually prompt. Bash
//     commands the sandbox auto-approves (a bare `echo`) and anything matching
//     a settings allowlist never reach this bridge — that is the CLI deciding
//     before the permission handler, not a bug here.
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

async function requestPermission(toolName, input, toolUseId) {
  let created;
  try {
    const res = await fetch(`${UI_BASE_URL}/api/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: RUN_ID, toolName, input, toolUseId }),
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
      // Mirrors the wire the CLI actually sends (see the header comment).
      // `additionalProperties` is left open on purpose: the CLI may add
      // fields, and an over-strict schema here would break every run.
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "Name of the tool Claude Code wants to invoke" },
          input: { type: "object", description: "The proposed input/arguments for that tool call" },
          tool_use_id: {
            type: "string",
            description:
              "Id of the tool_use block being checked; used to correlate/de-duplicate the request in the UI",
          },
        },
        required: ["tool_name", "input"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args, _meta: meta } = request.params;
  if (name !== "approve") {
    return denyResult(`ui-permission-bridge: unknown tool "${name}" — denying closed`);
  }
  const toolName = args?.tool_name ?? args?.toolName ?? "unknown";
  const input = args?.input ?? {};
  // The CLI sends the id both as an argument and on params._meta; prefer the
  // argument and fall back, so a change to either surface keeps working.
  const toolUseId = args?.tool_use_id ?? meta?.["claudecode/toolUseId"] ?? null;
  return requestPermission(toolName, input, toolUseId);
});

const transport = new StdioServerTransport();
await server.connect(transport);
