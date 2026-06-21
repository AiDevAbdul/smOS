#!/usr/bin/env node
// Thin wrapper — rule logic lives in scripts/lib/guards.js (shared with meta-graph chokepoint).
import { readStdinJson, getToolInput, getToolName, allow, block } from "./_lib.js";
import { checkCompliance } from "../scripts/lib/guards.js";

const payload = await readStdinJson();
const r = checkCompliance(getToolName(payload), getToolInput(payload));
if (!r.ok) block(r.reason);
allow("creative-compliance: OK");
