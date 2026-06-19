#!/usr/bin/env node
import { readStdinJson, getToolInput, allow, block } from "./_lib.js";

const REQUIRED = ["utm_source", "utm_medium", "utm_campaign"];

const payload = await readStdinJson();
const input = getToolInput(payload);

const urls = collectUrls(input);
if (urls.length === 0) allow("utm-enforcer: no destination URLs found");

const missing = [];
for (const url of urls) {
  let parsed;
  try { parsed = new URL(url); } catch {
    block(`utm-enforcer BLOCKED: invalid destination URL "${url}"`);
  }
  const lacking = REQUIRED.filter((k) => !parsed.searchParams.get(k));
  if (lacking.length) missing.push({ url, lacking });
}

if (missing.length) {
  const detail = missing.map((m) => `  ${m.url} → missing ${m.lacking.join(", ")}`).join("\n");
  block(`utm-enforcer BLOCKED: required UTM params missing:\n${detail}\nFix the destination URL or add a utm_template to the client profile.`);
}

allow(`utm-enforcer: ${urls.length} URL(s) OK`);

function collectUrls(obj, acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^https?:\/\//.test(v) && /link|url|destination/i.test(k)) acc.push(v);
    else if (typeof v === "object") collectUrls(v, acc);
  }
  return acc;
}
