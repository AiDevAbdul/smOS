#!/usr/bin/env node
// Thin wrapper — rule logic lives in scripts/lib/guards.js (shared with meta-graph chokepoint).
// Enforces the CLIENT'S brand (voice.avoid language + AI-visual logo/color lock) on ad creatives,
// the layer beyond Meta-policy compliance that incumbents don't have.
import { readStdinJson, getToolInput, getToolName, allow, block } from "./_lib.js";
import { checkBrandCompliance } from "../scripts/lib/guards.js";

const payload = await readStdinJson();
const r = checkBrandCompliance(getToolName(payload), getToolInput(payload));
if (!r.ok) block(r.reason);
allow("brand-compliance: OK");
