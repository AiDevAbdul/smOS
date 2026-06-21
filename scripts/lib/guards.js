/**
 * smOS guardrails — single source of truth.
 *
 * The same rule-set is enforced on BOTH paths that can mutate a Meta account:
 *   1. MCP tools  → hooks/*.js call these checks from their stdin payload.
 *   2. Skill scripts → scripts/lib/meta-graph.js runs guardGraphWrite() inside
 *      post()/delete() before any HTTP request leaves the process.
 *
 * Every check is a pure function returning { ok, reason }. The chokepoint
 * orchestrator guardGraphWrite() composes them and throws a GuardError
 * (fail-closed) so the request never goes out when a rule blocks.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

export const API_VERSION = "v25.0";

// ---- thresholds (kept in sync with the constitution / former hook constants) ----
export const GLOBAL_DAILY_CAP_USD = 200;
export const SINGLE_INCREASE_CAP_USD = 500;

export const NAMING_PATTERNS = {
  campaign: /^[A-Z]+_[A-Z0-9]+_\d{6}$/,
  adset: /^[A-Z]+_\d{2,4}_[A-Z0-9]+$/,
  ad: /^[A-Z]+_[A-Z0-9]+_v\d+$/,
};
const NAMING_HINTS = {
  campaign: "[OBJECTIVE]_[AUDIENCE_CODE]_[YYYYMM] — e.g. CONV_LAL1PCT_202606",
  adset: "[PLACEMENT]_[AGE_RANGE]_[INTEREST_CODE] — e.g. FEED_2545_FITNESS",
  ad: "[FORMAT]_[HOOK_CODE]_v[N] — e.g. IMG_PAIN_v1",
};

export const REQUIRED_UTM = ["utm_source", "utm_medium", "utm_campaign"];

export const TEXT_LIMITS = { primary: 500, headline: 40, description: 30 };
export const POLICY_FLAGS = [
  "guarantee", "guaranteed", "100% effective", "miracle", "cure",
  "lose weight fast", "before and after", "click here", "free money",
];

const CONVERSION_OBJECTIVES = new Set(["OUTCOME_SALES", "OUTCOME_LEADS"]);

export class GuardError extends Error {
  constructor(reason, ruleName) {
    super(reason);
    this.name = "GuardError";
    this.guard = ruleName || "guard";
    this.blocked = true;
  }
}

const PASS = { ok: true };
function fail(reason) { return { ok: false, reason }; }

// ---- profile resolution (mirrors hooks/_lib.js, rooted from scripts/lib) ----
export function loadClientProfile(slug) {
  if (!slug) return null;
  const p = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function resolveClientSlugFromAccount(adAccountId) {
  if (!adAccountId) return null;
  const id = String(adAccountId).replace(/^act_/, "");
  const clientsDir = resolve(ROOT, "clients");
  if (!existsSync(clientsDir)) return null;
  let slugs = [];
  try { slugs = readdirSync(clientsDir); } catch { return null; }
  for (const slug of slugs) {
    const profile = loadClientProfile(slug);
    const acct = profile?.accounts?.ad_account_id;
    if (acct && String(acct).replace(/^act_/, "") === id) return slug;
  }
  return null;
}

function profileFor(input, ctx) {
  if (ctx?.profile) return ctx.profile;
  const adAccountId = input?.ad_account_id || ctx?.adAccountId;
  const slug = resolveClientSlugFromAccount(adAccountId);
  return slug ? loadClientProfile(slug) : null;
}

// ============================ individual rules ============================

export function checkNaming(toolName, input) {
  const name = input?.name;
  if (!name) return PASS;
  let kind;
  if (toolName.includes("create_campaign")) kind = "campaign";
  else if (toolName.includes("create_adset")) kind = "adset";
  else if (toolName.includes("create_ad")) kind = "ad";
  else return PASS;
  if (!NAMING_PATTERNS[kind].test(name)) {
    return fail(`naming-check BLOCKED: "${name}" does not match ${kind} convention. Expected: ${NAMING_HINTS[kind]}`);
  }
  return PASS;
}

export function checkBudget(toolName, input, ctx = {}) {
  const proposedCents = Number(input?.daily_budget ?? 0);
  if (!proposedCents) return PASS;
  const proposedUSD = proposedCents / 100;

  const profile = profileFor(input, ctx);
  const monthlyHigh = profile?.kpis?.monthly_budget_high;
  const clientDailyCap = monthlyHigh ? monthlyHigh / 30 : GLOBAL_DAILY_CAP_USD;

  if (toolName.includes("create_campaign")) {
    if (proposedUSD > clientDailyCap) {
      return fail(`budget-guard BLOCKED: daily $${proposedUSD.toFixed(2)} exceeds client cap $${clientDailyCap.toFixed(2)} (monthly_budget_high/30). Post Discord approval before retrying.`);
    }
  } else if (toolName.includes("update_campaign") || ctx.isUpdate) {
    if (proposedUSD > clientDailyCap * 2) {
      return fail(`budget-guard BLOCKED: proposed $${proposedUSD.toFixed(2)} is >2× client daily cap. Discord approval required.`);
    }
    if (proposedUSD > SINGLE_INCREASE_CAP_USD) {
      return fail(`budget-guard BLOCKED: single increase to $${proposedUSD.toFixed(2)}/day exceeds $${SINGLE_INCREASE_CAP_USD} global threshold. Discord approval required.`);
    }
  }
  return PASS;
}

export function checkUtm(toolName, input) {
  const urls = collectUrls(input);
  if (urls.length === 0) return PASS;
  const missing = [];
  for (const url of urls) {
    let parsed;
    try { parsed = new URL(url); } catch { return fail(`utm-enforcer BLOCKED: invalid destination URL "${url}"`); }
    const lacking = REQUIRED_UTM.filter((k) => !parsed.searchParams.get(k));
    if (lacking.length) missing.push({ url, lacking });
  }
  if (missing.length) {
    const detail = missing.map((m) => `${m.url} → missing ${m.lacking.join(", ")}`).join("; ");
    return fail(`utm-enforcer BLOCKED: required UTM params missing: ${detail}. Fix the destination URL or add a utm_template to the client profile.`);
  }
  return PASS;
}

export function checkCompliance(toolName, input, ctx = {}) {
  const creative = input?.creative || input?.object_story_spec || input || {};
  const primary = pickText(creative, ["primary_text", "message", "body"]);
  const headline = pickText(creative, ["headline", "title", "name"]);
  const description = pickText(creative, ["description", "link_description"]);

  const violations = [];
  if (primary && primary.length > TEXT_LIMITS.primary) violations.push(`primary_text ${primary.length}/${TEXT_LIMITS.primary}`);
  if (headline && headline.length > TEXT_LIMITS.headline) violations.push(`headline ${headline.length}/${TEXT_LIMITS.headline}`);
  if (description && description.length > TEXT_LIMITS.description) violations.push(`description ${description.length}/${TEXT_LIMITS.description}`);

  const profile = profileFor(input, ctx);
  const restricted = (profile?.voice?.restricted_words || []).map((w) => w.toLowerCase());
  const allText = [primary, headline, description].filter(Boolean).join(" ").toLowerCase();

  const restrictedHits = restricted.filter((w) => new RegExp(`\\b${escapeRegex(w)}\\b`).test(allText));
  if (restrictedHits.length) violations.push(`restricted words: ${restrictedHits.join(", ")}`);

  const policyHits = POLICY_FLAGS.filter((p) => allText.includes(p));
  if (policyHits.length) violations.push(`Meta policy flags: ${policyHits.join(", ")}`);

  if (violations.length) return fail(`creative-compliance BLOCKED: ${violations.join("; ")}`);
  return PASS;
}

export async function checkPixel(toolName, input, ctx = {}) {
  if (!toolName.includes("create_campaign")) return PASS;
  const objective = input?.objective;
  if (!objective || !CONVERSION_OBJECTIVES.has(objective)) return PASS;

  const profile = profileFor(input, ctx);
  const pixelId = profile?.accounts?.pixel_id;
  const slug = profile?.slug || profile?.client_slug;
  if (!pixelId) {
    return fail(`pixel-check BLOCKED: conversion campaign requires a pixel_id in the client profile (slug=${slug || "?"}).`);
  }
  const token = ctx.token || process.env.META_ACCESS_TOKEN;
  if (!token) {
    return fail(`pixel-check BLOCKED: META_ACCESS_TOKEN unavailable — cannot verify pixel ${pixelId} is firing.`);
  }

  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const url = `https://graph.facebook.com/${API_VERSION}/${pixelId}/stats?start_time=${since}&access_token=${encodeURIComponent(token)}`;
  let firing = false;
  let detail = "";
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      detail = `error ${json.error.code}/${json.error.type}: ${json.error.message} (fbtrace_id=${json.error.fbtrace_id})`;
    } else {
      const events = json?.data || [];
      firing = events.some((e) => Number(e?.count || 0) > 0);
      detail = `${events.length} event types, total ${events.reduce((s, e) => s + Number(e?.count || 0), 0)}`;
    }
  } catch (e) {
    detail = `fetch failed: ${e.message}`;
  }
  if (!firing) {
    return fail(`pixel-check BLOCKED: pixel ${pixelId} has no events in the last 7 days. ${detail} Fix pixel installation before launching a conversion campaign.`);
  }
  return PASS;
}

/**
 * AI-disclosure compliance (Phase 3.2). Since Mar 2026, Meta rejects (and can
 * penalize) ads built from GenAI imagery/video that aren't disclosed. Fail-closed:
 * if a creative is marked AI-generated it MUST carry an explicit disclosure flag,
 * and when SMOS_REQUIRE_AI_DISCLOSURE=1 every ad must declare ai_generated true/false
 * (no silent omission). Detection is explicit-flag based — we never guess "is this AI".
 */
export function checkAiDisclosure(toolName, input = {}) {
  if (!toolName.includes("create_ad")) return PASS;
  const creative = input?.creative || input || {};
  const aiGenerated =
    input.ai_generated === true ||
    creative.ai_generated === true ||
    // Advantage+ Creative AI transforms imply generated assets
    !!creative.degrees_of_freedom_spec?.creative_features_spec?.standard_enhancements;
  const disclosed =
    input.ai_disclosed === true ||
    creative.ai_disclosed === true ||
    creative.disclaimer_label === "ai_generated";

  if (aiGenerated && !disclosed) {
    return fail(
      "ai-disclosure BLOCKED: creative is AI-generated but missing an AI-content disclosure " +
      "(set ai_disclosed:true). Meta rejects undisclosed GenAI ads since Mar 2026."
    );
  }
  if (process.env.SMOS_REQUIRE_AI_DISCLOSURE === "1" && input.ai_generated === undefined && creative.ai_generated === undefined) {
    return fail("ai-disclosure BLOCKED: SMOS_REQUIRE_AI_DISCLOSURE=1 requires every ad to declare ai_generated (true|false).");
  }
  return PASS;
}

/**
 * Absolute blocks (CLAUDE.md "never do without explicit written instruction").
 * Fail-closed: only an explicit env override lets these through.
 */
export function checkDestructive(ctx = {}) {
  const { method, path = "", data = {} } = ctx;
  const allowDelete = process.env.SMOS_ALLOW_DELETE === "1";

  if (String(method).toUpperCase() === "DELETE") {
    if (allowDelete) return PASS;
    return fail(`destructive-guard BLOCKED: DELETE ${path} is an absolute block (archive instead). Set SMOS_ALLOW_DELETE=1 with explicit written instruction to override.`);
  }

  // Updates target an existing entity: POST to a bare numeric id (no /collection suffix).
  const isEntityUpdate = /^\/?(act_)?\d+$/.test(String(path).replace(/^\//, ""));
  if (isEntityUpdate && data && typeof data === "object") {
    if ("lifetime_budget" in data && !allowDelete) {
      return fail(`destructive-guard BLOCKED: changing lifetime_budget on a live entity (${path}) is an absolute block. Override requires explicit written instruction.`);
    }
    if ("objective" in data && !allowDelete) {
      return fail(`destructive-guard BLOCKED: changing objective on a running campaign (${path}) is an absolute block.`);
    }
  }
  return PASS;
}

/**
 * Phase 0 (zero-start) preflight. Established-client skills (/audit, /audience-map,
 * /launch, /publish) presuppose a Page, IG account, ad account and pixel already
 * exist. For a brand-new business those are null/TBD and the downstream skill would
 * otherwise halt with a cryptic "accounts.x is missing". This returns a clear,
 * actionable result naming WHICH setup skill to run first.
 *
 * Pure (no I/O): pass the loaded profile. `need` selects which assets a caller
 * requires — e.g. /publish needs page+ig+token but not pixel; /launch needs all.
 *   checkZeroStartPrereqs(profile, { need: ["page","ig","ad_account","pixel","website"] })
 */
export function checkZeroStartPrereqs(profile, { need = ["page", "ad_account"] } = {}) {
  const a = profile?.accounts || {};
  const missing = [];
  const isSet = (v) => v != null && String(v).trim() !== "" && !/^<?TBD/i.test(String(v).trim());

  const checks = {
    page:       { val: a.facebook_page_id,      label: "Facebook Page",          fix: "create the Page manually, then run /setup-accounts to record the id" },
    ig:         { val: a.instagram_business_id, label: "Instagram business account", fix: "create + convert to Professional and link to the Page, then run /setup-accounts" },
    ad_account: { val: a.ad_account_id,         label: "Meta ad account",        fix: "run /setup-accounts (it creates the ad account via the API once the business is verified)" },
    pixel:      { val: a.pixel_id,              label: "Meta pixel/dataset",      fix: "run /setup-accounts (creates the pixel), then install it via /setup-web or /capi-setup" },
    website:    { val: a.website_url,           label: "website / landing page",  fix: "run /setup-web to buy a domain + deploy a landing page" },
  };

  for (const key of need) {
    const c = checks[key];
    if (c && !isSet(c.val)) missing.push({ asset: key, label: c.label, fix: c.fix });
  }

  return {
    ok: missing.length === 0,
    missing,
    message: missing.length
      ? `Zero-start prerequisites missing: ${missing.map((m) => `${m.label} (→ ${m.fix})`).join("; ")}`
      : "All required accounts present.",
  };
}

// ====================== chokepoint orchestrator ======================

/**
 * Map a Graph write (method + path) to the equivalent MCP tool intent so the
 * same rules apply on both paths.
 */
export function classifyGraphWrite(method, path = "") {
  const m = String(method).toUpperCase();
  const p = String(path);
  const acctMatch = p.match(/act_(\d+)/);
  const adAccountId = acctMatch ? acctMatch[1] : null;

  if (m === "DELETE") return { toolName: "delete", isUpdate: false, isDelete: true, adAccountId };
  if (/\/campaigns$/.test(p)) return { toolName: "create_campaign", isUpdate: false, isDelete: false, adAccountId };
  if (/\/adsets$/.test(p)) return { toolName: "create_adset", isUpdate: false, isDelete: false, adAccountId };
  if (/\/ads$/.test(p)) return { toolName: "create_ad", isUpdate: false, isDelete: false, adAccountId };
  if (/\/adcreatives$/.test(p)) return { toolName: "create_ad", isUpdate: false, isDelete: false, adAccountId };
  // bare entity id → an update/edit
  if (/^\/?(act_)?\d+$/.test(p.replace(/^\//, ""))) return { toolName: "update_campaign", isUpdate: true, isDelete: false, adAccountId };
  return { toolName: "other", isUpdate: false, isDelete: false, adAccountId };
}

/**
 * The single chokepoint. Runs every applicable rule for a direct Graph write
 * and throws GuardError on the first block. Called by meta-graph.js post()/delete().
 */
export async function guardGraphWrite({ method, path, data = {}, token } = {}) {
  const { toolName, isUpdate, isDelete, adAccountId } = classifyGraphWrite(method, path);
  const ctx = { method, path, data, token, isUpdate, adAccountId };

  // 1. Absolute blocks first (fail-closed).
  let r = checkDestructive(ctx);
  if (!r.ok) throw new GuardError(r.reason, "destructive");
  if (isDelete) return; // delete allowed via override — nothing else to check

  // 2. Per-tool rules.
  r = checkNaming(toolName, data);
  if (!r.ok) throw new GuardError(r.reason, "naming");

  r = checkBudget(toolName, data, ctx);
  if (!r.ok) throw new GuardError(r.reason, "budget");

  if (toolName === "create_ad") {
    r = checkUtm(toolName, data);
    if (!r.ok) throw new GuardError(r.reason, "utm");
    r = checkCompliance(toolName, data, ctx);
    if (!r.ok) throw new GuardError(r.reason, "compliance");
    r = checkAiDisclosure(toolName, data);
    if (!r.ok) throw new GuardError(r.reason, "ai-disclosure");
  }

  if (toolName === "create_campaign") {
    r = await checkPixel(toolName, data, ctx);
    if (!r.ok) throw new GuardError(r.reason, "pixel");
  }
}

// ---- shared text helpers (used by checkUtm / checkCompliance) ----
function collectUrls(obj, acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && /^https?:\/\//.test(v) && /link|url|destination/i.test(k)) acc.push(v);
    else if (typeof v === "object") collectUrls(v, acc);
  }
  return acc;
}

function pickText(obj, keys) {
  for (const k of keys) if (typeof obj?.[k] === "string") return obj[k];
  const spec = obj?.link_data || obj?.video_data;
  if (spec) for (const k of keys) if (typeof spec[k] === "string") return spec[k];
  return null;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
