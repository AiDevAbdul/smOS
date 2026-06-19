#!/usr/bin/env node
import { readStdinJson, getToolInput, getToolName, allow, block } from "./_lib.js";

const PATTERNS = {
  campaign: /^[A-Z]+_[A-Z0-9]+_\d{6}$/,
  adset: /^[A-Z]+_\d{2,4}_[A-Z0-9]+$/,
  ad: /^[A-Z]+_[A-Z0-9]+_v\d+$/,
};

const HINTS = {
  campaign: "[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM] — e.g. CONV_LAL1PCT_202606",
  adset: "[PLACEMENT]_[AGE_RANGE]_[INTEREST_CODE] — e.g. FEED_2545_FITNESS",
  ad: "[FORMAT]_[HOOK_CODE]_v[N] — e.g. IMG_PAIN_v1",
};

const payload = await readStdinJson();
const toolName = getToolName(payload);
const input = getToolInput(payload);
const name = input?.name;

if (!name) allow("naming-check: no name in input");

let kind;
if (toolName.includes("create_campaign")) kind = "campaign";
else if (toolName.includes("create_adset")) kind = "adset";
else if (toolName.includes("create_ad")) kind = "ad";
else allow(`naming-check: tool ${toolName} not matched`);

if (!PATTERNS[kind].test(name)) {
  block(`naming-check BLOCKED: "${name}" does not match ${kind} convention.\nExpected: ${HINTS[kind]}`);
}

allow(`naming-check: ${kind} name "${name}" OK`);
