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
import { clientFile } from "./paths.js";
import { flattenStatsBuckets } from "./meta-stats.js";
import { checkPalette } from "./contrast.js";

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
  // Canonical clients/<slug>/profile.json, with legacy client_profile.json fallback.
  const p = clientFile(slug, "client_profile.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function loadBrandProfile(slug) {
  if (!slug) return null;
  const p = resolve(ROOT, "clients", slug, "brand_profile.json");
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
  // Order matters: "create_adset".includes("create_ad") is true, so adset is
  // tested before ad.
  let kind;
  if (toolName.includes("create_campaign")) kind = "campaign";
  else if (toolName.includes("create_adset")) kind = "adset";
  else if (toolName.includes("create_ad")) kind = "ad";
  else return PASS;
  const name = input?.name;
  // Fail-closed: a create_* with no name must be BLOCKED, not waved through. A
  // direct Graph write (or an aliased field) would otherwise skip naming entirely.
  if (!name) {
    return fail(`naming-check BLOCKED: ${kind} create requires a 'name'. Expected: ${NAMING_HINTS[kind]}`);
  }
  if (!NAMING_PATTERNS[kind].test(name)) {
    return fail(`naming-check BLOCKED: "${name}" does not match ${kind} convention. Expected: ${NAMING_HINTS[kind]}`);
  }
  return PASS;
}

export function checkBudget(toolName, input, ctx = {}) {
  const raw = input?.daily_budget;
  // A genuinely absent budget is legitimate (e.g. CBO ad sets carry no budget) →
  // PASS. But if a value IS supplied it must be a finite, non-negative number; a
  // NaN/garbage value must never coerce to falsy and slip through as "no budget".
  if (raw == null || raw === "") return PASS;
  const proposedCents = Number(raw);
  if (!Number.isFinite(proposedCents) || proposedCents < 0) {
    return fail(`budget-guard BLOCKED: daily_budget "${raw}" is not a valid non-negative number.`);
  }
  if (proposedCents === 0) return PASS;
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

/**
 * AI brand/compliance approval guard (Phase 6 moat). Goes beyond Meta-policy
 * compliance (checkCompliance) to enforce the CLIENT'S brand against every ad
 * creative — the thing no incumbent suite does. Two deterministic, fail-closed
 * dimensions (tone is intentionally NOT auto-judged — guards never guess):
 *
 *   1. Off-brand language — the client's own `voice.avoid` list (client_profile)
 *      plus the brand's `verbal.voice.dont` list (brand_profile). checkCompliance
 *      only reads `voice.restricted_words`, so `voice.avoid` was silently ignored.
 *   2. Logo/color lock for AI-generated visuals — once a brand's visual kit is
 *      approved (visual.logo_approved_at) AND strict mode is on (env
 *      SMOS_REQUIRE_BRAND_KIT=1 or brand.visual.brand_kit_locked), an AI-generated
 *      creative must DECLARE the brand kit it used (creative.brand_kit:{colors,logo_url})
 *      and it must match the approved palette/logo — so AI can't ship off-brand art.
 *      Detection is explicit-flag based (mirrors ai-disclosure); we never inspect pixels.
 */
export function checkBrandCompliance(toolName, input = {}, ctx = {}) {
  if (!toolName.includes("create_ad") && toolName !== "create_organic_post") return PASS;
  const creative = input?.creative || input?.object_story_spec || input || {};
  const profile = profileFor(input, ctx);
  const slug = profile?.slug || profile?.client_slug || ctx?.slug || null;
  const brand = ctx?.brand || (slug ? loadBrandProfile(slug) : null);

  const violations = [];

  // 1. Off-brand language.
  const avoid = collectAvoidWords(profile, brand);
  if (avoid.length) {
    const text = gatherCreativeText(creative).toLowerCase();
    const hits = avoid.filter((w) => new RegExp(`\\b${escapeRegex(w)}\\b`).test(text));
    if (hits.length) violations.push(`off-brand language (voice.avoid): ${hits.join(", ")}`);
  }

  // 2. Logo/color lock for AI-generated visuals.
  const kitViolation = checkBrandKitLock(input, creative, brand);
  if (kitViolation) violations.push(kitViolation);

  if (violations.length) return fail(`brand-compliance BLOCKED: ${violations.join("; ")}`);
  return PASS;
}

function collectAvoidWords(profile, brand) {
  const out = new Set();
  for (const w of profile?.voice?.avoid || []) if (w) out.add(String(w).toLowerCase());
  for (const w of profile?.voice?.restricted_words || []) if (w) out.add(String(w).toLowerCase());
  for (const w of brand?.verbal?.voice?.dont || []) if (w) out.add(String(w).toLowerCase());
  return [...out];
}

function checkBrandKitLock(input, creative, brand) {
  const approvedAt = brand?.visual?.logo_approved_at;
  const strict = process.env.SMOS_REQUIRE_BRAND_KIT === "1" || brand?.visual?.brand_kit_locked === true;
  if (!approvedAt || !strict) return null; // opt-in: only enforce on locked brands

  const aiGenerated =
    input?.ai_generated === true ||
    creative?.ai_generated === true ||
    !!creative?.degrees_of_freedom_spec?.creative_features_spec?.standard_enhancements;
  if (!aiGenerated) return null; // human-made art isn't kit-locked here

  const declared = creative?.brand_kit || input?.brand_kit;
  if (!declared) {
    return "AI-generated visual must declare creative.brand_kit {colors, logo_url} matching the approved brand kit (visual kit is locked)";
  }

  const approved = normalizeHexSet([
    brand?.visual?.colors?.primary,
    brand?.visual?.colors?.secondary,
    brand?.visual?.colors?.accent,
    ...(brand?.visual?.colors?.neutrals || []),
  ]);
  const used = normalizeHexSet(asColorArray(declared.colors));
  const offPalette = used.filter((c) => !approved.includes(c));
  if (offPalette.length) {
    return `AI visual uses off-palette colors ${offPalette.join(", ")} (approved: ${approved.join(", ") || "none"})`;
  }

  const approvedLogos = [
    brand?.visual?.logo?.primary_url, brand?.visual?.logo?.mark_url,
    brand?.visual?.logo?.wordmark_url, brand?.visual?.logo?.mono_url,
    brand?.visual?.logo?.reverse_url, brand?.visual?.logo?.svg_url,
  ].filter(Boolean);
  if (declared.logo_url && approvedLogos.length && !approvedLogos.includes(declared.logo_url)) {
    return `AI visual uses an unapproved logo "${declared.logo_url}" (not in the approved brand kit)`;
  }
  return null;
}

function asColorArray(c) {
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

function normalizeHexSet(arr) {
  const out = [];
  for (const c of arr) {
    if (!c) continue;
    const hex = String(c).trim().toLowerCase().replace(/\s+/g, "");
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

/**
 * WCAG contrast guard (E2). Fail-closed on a brand palette whose PRIMARY color
 * cannot reach 4.5:1 against any neutral in its own palette — an unreadable
 * brand color is inherited silently by the brand book, social templates, poster
 * text layer and every ad creative, and nothing downstream measures it.
 *
 * Pure (no I/O): pass the loaded brand_profile. Enforced at the point the colors
 * are chosen (`/brand-visual` persist) and mirrored on the MCP creative path by
 * hooks/contrast-check.js. Override: SMOS_ALLOW_LOW_CONTRAST=1 (explicit,
 * logged by the caller) for the rare intentional case — a display-only accent
 * brand that never sets its primary as text.
 */
export function checkBrandContrast(brand, { min } = {}) {
  const colors = brand?.visual?.colors || brand?.colors || {};
  const r = checkPalette(colors, min ? { min } : {});
  if (r.ok) return { ...PASS, report: r };
  if (process.env.SMOS_ALLOW_LOW_CONTRAST === "1") {
    return { ok: true, overridden: true, report: r, reason: `contrast-guard OVERRIDDEN (SMOS_ALLOW_LOW_CONTRAST=1): ${r.message}` };
  }
  return {
    ...fail(
      `contrast-guard BLOCKED: ${r.message}. Darken/lighten the color or add a neutral it can sit on. ` +
      `Override with SMOS_ALLOW_LOW_CONTRAST=1 only for a brand whose primary is never used as text.`
    ),
    report: r,
  };
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
  // aggregation=event buckets counts per event name; /stats returns hourly
  // buckets each with a nested data array ({start_time, data:[{value,count}]}),
  // so it must go through flattenStatsBuckets rather than reading top-level
  // fields directly (see skills/capi-setup/capi-setup.js for the same shape).
  const url = `https://graph.facebook.com/${API_VERSION}/${pixelId}/stats?start_time=${since}&aggregation=event&access_token=${encodeURIComponent(token)}`;
  let firing = false;
  let detail = "";
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.error) {
      detail = `error ${json.error.code}/${json.error.type}: ${json.error.message} (fbtrace_id=${json.error.fbtrace_id})`;
    } else {
      const rows = flattenStatsBuckets(json);
      const total = rows.reduce((s, r) => s + Number(r?.count || 0), 0);
      firing = rows.some((r) => Number(r?.count || 0) > 0);
      detail = `${new Set(rows.map((r) => r.name)).size} event types, total ${total}`;
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
  if (!toolName.includes("create_ad") && toolName !== "create_organic_post") return PASS;
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
 * DELETE is not one rule — it is two (E6).
 *
 * The constitution's absolute block is about ADVERTISING structure: "delete any
 * campaign, adset, or ad (archive instead)". It was implemented as a blanket
 * DELETE block, which also blocked the ordinary organic moderation a social OS
 * has to perform — removing a spam or abusive comment from a client's Page is a
 * routine, reversible-in-consequence action, not a destruction of ad structure.
 * With the blanket rule, `moderate_comments` action:"delete" could only work by
 * setting SMOS_ALLOW_DELETE=1, which simultaneously unlocked campaign deletes.
 *
 * So deletes are classified by RESOURCE CLASS, and the split stays fail-closed:
 * only classes on ORGANIC_DELETABLE are allowed, an unclassified delete is
 * blocked (we never infer a class from a bare numeric Meta id — FB and IG ids
 * are not distinguishable by shape, and guessing here would be guessing about a
 * live ad account). Callers declare it: graph.delete(path, params, {resource}).
 */
export const ORGANIC_DELETABLE = new Set([
  "comment",       // a comment/reply on a Page post or IG media (moderation)
  "comment_reply", // our own reply to a comment
]);

/** Classes we block on purpose, each with the reason the block exists. */
export const BLOCKED_DELETE_CLASSES = new Map([
  ["campaign", "deleting ad structure is an absolute block (archive instead)"],
  ["adset", "deleting ad structure is an absolute block (archive instead)"],
  ["ad", "deleting ad structure is an absolute block (archive instead)"],
  ["adcreative", "deleting ad structure is an absolute block (archive instead)"],
  ["pixel", "removing a pixel from an ad account is an absolute block"],
  ["dataset", "removing a dataset from an ad account is an absolute block"],
  ["custom_audience", "an audience cannot be rebuilt from history once deleted"],
  ["ad_rule", "an automated rule governs live spend — pause it instead of deleting it"],
]);
/** @deprecated kept for callers that only need the ad-structure subset. */
export const AD_STRUCTURE_CLASSES = new Set(["campaign", "adset", "ad", "adcreative"]);

/**
 * Resolve the resource class of a DELETE. An explicit caller-declared class
 * wins; otherwise the only inference we trust is an unambiguous path suffix
 * (e.g. `/{id}/comments`). Everything else is "unknown" → blocked.
 */
export function classifyDeleteTarget({ path = "", resource = null } = {}) {
  if (resource) return String(resource).toLowerCase();
  const p = String(path);
  if (/\/comments\/?$/.test(p)) return "comment";
  if (/\/campaigns\/?$/.test(p)) return "campaign";
  if (/\/adsets\/?$/.test(p)) return "adset";
  if (/\/ads\/?$/.test(p)) return "ad";
  return "unknown";
}

/**
 * Absolute blocks (CLAUDE.md "never do without explicit written instruction").
 * Fail-closed: only an explicit env override lets these through.
 */
export function checkDestructive(ctx = {}) {
  const { method, path = "", data = {}, resource = null } = ctx;
  const allowDelete = process.env.SMOS_ALLOW_DELETE === "1";

  if (String(method).toUpperCase() === "DELETE") {
    if (allowDelete) return PASS;
    const cls = classifyDeleteTarget({ path, resource });
    if (ORGANIC_DELETABLE.has(cls)) return PASS; // organic moderation, not ad structure
    if (BLOCKED_DELETE_CLASSES.has(cls)) {
      return fail(`destructive-guard BLOCKED: DELETE ${path} targets a ${cls} — ${BLOCKED_DELETE_CLASSES.get(cls)}. Set SMOS_ALLOW_DELETE=1 with explicit written instruction to override.`);
    }
    return fail(`destructive-guard BLOCKED: DELETE ${path} has no declared resource class, so it is treated as ad structure (absolute block). Declare an organic class — graph.delete(path, params, { resource: "comment" }) — or set SMOS_ALLOW_DELETE=1 with explicit written instruction.`);
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

/**
 * Preflight for branded poster generation (see scripts/lib/poster_compose.js,
 * skills/image-gen/image-gen.js, skills/image-gen/image-gen-ads.js). A poster
 * without the client's logo, or with no contact/handle info at all, is not a
 * valid poster for this feature — fail closed with a clear fix, same style as
 * checkZeroStartPrereqs above, rather than silently shipping a blank bar.
 *
 * Pure (no I/O): pass the loaded brand_profile + client_profile.
 */
export function checkPosterInputs(brand, clientProfile) {
  const missing = [];
  const logo = brand?.visual?.logo || {};
  const logoUrl = logo.reverse_url || logo.primary_url || logo.mono_url;
  if (!brand?.visual?.logo_approved_at || !logoUrl) {
    missing.push({ asset: "logo", label: "approved brand logo", fix: "run /brand-visual to design + approve a logo first" });
  }

  const contact = clientProfile?.contact || {};
  const handles = contact.social_handles || {};
  const hasContact = Boolean(contact.phone || contact.website_display || handles.instagram || handles.facebook || handles.tiktok);
  if (!hasContact) {
    missing.push({
      asset: "contact",
      label: "contact/handle info",
      fix: "set at least one of client_profile.contact.{phone, website_display, social_handles.instagram, social_handles.facebook, social_handles.tiktok}",
    });
  }

  return {
    ok: missing.length === 0,
    missing,
    message: missing.length
      ? `Poster inputs missing: ${missing.map((m) => `${m.label} (→ ${m.fix})`).join("; ")}`
      : "Logo + contact info present.",
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
export async function guardGraphWrite({ method, path, data = {}, token, resource = null } = {}) {
  const { toolName, isUpdate, isDelete, adAccountId } = classifyGraphWrite(method, path);
  const ctx = { method, path, data, token, isUpdate, adAccountId, resource };

  // 1. Absolute blocks first (fail-closed).
  let r = checkDestructive(ctx);
  if (!r.ok) throw new GuardError(r.reason, "destructive");
  if (isDelete) return; // delete permitted (organic class or explicit override) — no create rules apply

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
    r = checkBrandCompliance(toolName, data, ctx);
    if (!r.ok) throw new GuardError(r.reason, "brand-compliance");
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

const TEXT_KEYS = /^(primary_text|message|body|headline|title|name|description|link_description|caption|call_to_action)$/i;
function gatherCreativeText(obj, acc = []) {
  if (!obj || typeof obj !== "object") return acc.join(" ");
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && TEXT_KEYS.test(k)) acc.push(v);
    else if (v && typeof v === "object") gatherCreativeText(v, acc);
  }
  return acc.join(" ");
}

function pickText(obj, keys) {
  for (const k of keys) if (typeof obj?.[k] === "string") return obj[k];
  const spec = obj?.link_data || obj?.video_data;
  if (spec) for (const k of keys) if (typeof spec[k] === "string") return spec[k];
  return null;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
