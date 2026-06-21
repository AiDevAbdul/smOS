#!/usr/bin/env node
// Absolute-block guard for the MCP path (delete / lifetime-budget / objective changes).
// Rule logic lives in scripts/lib/guards.js (shared with the meta-graph chokepoint).
import { readStdinJson, getToolInput, getToolName, allow, block } from "./_lib.js";
import { checkDestructive } from "../scripts/lib/guards.js";

const payload = await readStdinJson();
const toolName = getToolName(payload);
const input = getToolInput(payload);

const id = input?.id || input?.campaign_id || input?.adset_id || input?.ad_id || "entity";
const isDelete = /delete|destroy|remove/i.test(toolName);
const ctx = isDelete
  ? { method: "DELETE", path: `/${id}` }
  : { method: "POST", path: `/${id}`, data: input };

const r = checkDestructive(ctx);
if (!r.ok) block(r.reason);
allow("destructive-guard: OK");
