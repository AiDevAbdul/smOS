#!/usr/bin/env node
/**
 * /setup-accounts companion — drives the manual-gate checklist and executes the
 * API-creatable Meta bootstrap (ad account, pixel, system user/token, asset
 * assignment), writing every id + timestamp back into client_profile.json.
 *
 * The split is deliberate and verified against Graph API v25.0:
 *   - manual gates: recorded only via --done (the skill never fakes a human step)
 *   - API half (--bootstrap): runs through the guarded createGraph() chokepoint
 *
 * Usage:
 *   node skills/setup-accounts/setup-accounts.js <slug> --status
 *   node skills/setup-accounts/setup-accounts.js <slug> --done page_created_at --set facebook_page_id=123
 *   node skills/setup-accounts/setup-accounts.js <slug> --done page_created_at --from-intake
 *   node skills/setup-accounts/setup-accounts.js <slug> --bootstrap
 *
 * --from-intake: resolves the real numeric id from a handle/URL already captured
 * during /intake (profile.notes.facebook_page_url / instagram_url) via a live
 * Graph API GET lookup — never fabricates an id, just saves re-typing a known handle.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import * as clientProfile from "../../schemas/client_profile.js";
import { checkZeroStartPrereqs } from "../../scripts/lib/guards.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const MANUAL_STEPS = [
  "business_verified_at", "page_created_at", "instagram_created_at",
  "instagram_professional_at", "ig_page_linked_at", "payment_method_added_at",
  "asset_access_granted_at",
];

function profilePathFor(slug) { return P.clientFile(slug, "client_profile.json"); }

function loadProfile(slug) {
  const p = profilePathFor(slug);
  if (!existsSync(p)) { console.error(`Profile not found: ${p} — run /intake first.`); process.exit(2); }
  return clientProfile.normalize(JSON.parse(readFileSync(p, "utf8")));
}

function saveProfile(slug, profile) {
  writeFileSync(profilePathFor(slug), JSON.stringify(clientProfile.normalize(profile), null, 2));
}

function nowIso() { return new Date().toISOString(); }

// Manual gates whose id can be resolved from a handle/URL already captured at /intake,
// via a live Graph API lookup (never guessed, never fabricated).
const INTAKE_RESOLVABLE = {
  page_created_at: { accountKey: "facebook_page_id", noteKey: "facebook_page_url" },
  instagram_created_at: { accountKey: "instagram_business_id", noteKey: "instagram_url" },
};

function handleFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/(?:facebook|instagram)\.com\/([^/?#]+)/i);
  return m ? m[1] : String(url).replace(/^@/, "");
}

async function resolveFromIntake(step, profile) {
  const rule = INTAKE_RESOLVABLE[step];
  if (!rule) return { ok: false, reason: `--from-intake has no known source field for step "${step}"` };
  const graph = createGraph(); // throws clearly if META_ACCESS_TOKEN missing

  // Instagram business accounts aren't fetchable by username directly — Graph exposes
  // them only via the linked Page's instagram_business_account edge.
  if (step === "instagram_created_at") {
    const pageId = profile.accounts?.facebook_page_id;
    if (isTbd(pageId)) return { ok: false, reason: "No facebook_page_id on record yet — run --done page_created_at --from-intake first (IG must be linked to the Page to resolve this way)" };
    const res = await graph.get(`/${pageId}`, { fields: "instagram_business_account{id,username}" });
    const ig = res?.instagram_business_account;
    if (!ig?.id) return { ok: false, reason: `Page ${pageId} has no linked instagram_business_account yet — link IG to the Page in Meta Business Suite first, or pass --set ${rule.accountKey}=<id>` };
    return { ok: true, key: rule.accountKey, value: ig.id, source: `page ${pageId} instagram_business_account`, resolvedName: ig.username };
  }

  const url = profile.notes?.[rule.noteKey];
  const handle = handleFromUrl(url);
  if (!handle) return { ok: false, reason: `No profile.notes.${rule.noteKey} captured at /intake — pass --set ${rule.accountKey}=<id> instead` };
  const res = await graph.get(`/${handle}`, { fields: "id,name" });
  if (!res?.id) return { ok: false, reason: `Graph API lookup for "${handle}" returned no id` };
  return { ok: true, key: rule.accountKey, value: res.id, source: url, resolvedName: res.name };
}

function printStatus(slug, profile) {
  const setup = profile.setup || {};
  const acc = profile.accounts || {};
  const manual = MANUAL_STEPS.map((k) => ({ step: k, done: !!setup[k], at: setup[k] || null }));
  const apiAssets = {
    ad_account_id: acc.ad_account_id, pixel_id: acc.pixel_id,
    system_user_id: acc.system_user_id, business_id: acc.business_id,
  };
  const pre = checkZeroStartPrereqs(profile, { need: ["page", "ig", "ad_account", "pixel"] });
  console.log(JSON.stringify({ slug, manual_gates: manual, api_assets: apiAssets, ready: pre.ok, blocking: pre.missing }, null, 2));
}

async function bootstrap(slug, profile) {
  const acc = profile.accounts || {};
  const bizId = acc.business_id || acc.bm_id;
  if (isTbd(bizId)) { console.error("Set accounts.business_id (the client's Business Portfolio id) first."); process.exit(3); }

  const graph = createGraph(); // throws clearly if META_ACCESS_TOKEN missing
  const created = {};
  const errors = [];

  // 1. Ad account (API cap: 5 per business — beyond that is manual UI).
  if (isTbd(acc.ad_account_id)) {
    try {
      const res = await graph.post(`/${bizId}/adaccount`, {
        name: `${profile.name || slug} Ad Account`,
        currency: acc.currency || "USD",
        timezone_id: 1, // America/Los_Angeles; adjust per client tz
        end_advertiser: bizId,
        media_agency: bizId,
        partner: "NONE",
      });
      acc.ad_account_id = res.id || res.account_id || null;
      created.ad_account_id = acc.ad_account_id;
      profile.setup.ad_account_created_at = nowIso();
    } catch (e) { errors.push(`ad_account: ${e.message}`); }
  }

  // 2. Pixel / dataset (cap: 100 per business).
  if (isTbd(acc.pixel_id)) {
    try {
      const res = await graph.post(`/${bizId}/adspixels`, { name: `${profile.name || slug} Pixel` });
      acc.pixel_id = res.id || null;
      created.pixel_id = acc.pixel_id;
      profile.setup.pixel_created_at = nowIso();
    } catch (e) { errors.push(`pixel: ${e.message}`); }
  }

  // 3. System user (+ token). Token printing is sensitive — we record only the id;
  //    the operator generates/stores the token out-of-band or via env.
  if (isTbd(acc.system_user_id)) {
    try {
      const res = await graph.post(`/${bizId}/system_users`, { name: `${slug}-smos-sysuser`, role: "ADMIN" });
      acc.system_user_id = res.id || null;
      created.system_user_id = acc.system_user_id;
      profile.setup.system_user_token_at = nowIso();
    } catch (e) { errors.push(`system_user: ${e.message}`); }
  }

  // 4. Assign owned assets to the system user (page + ad account).
  if (acc.system_user_id) {
    if (!isTbd(acc.facebook_page_id)) {
      try {
        await graph.post(`/${acc.facebook_page_id}/assigned_users`, { user: acc.system_user_id, tasks: ["MANAGE", "CREATE_CONTENT", "MODERATE", "ADVERTISE", "ANALYZE"] });
      } catch (e) { errors.push(`assign page: ${e.message}`); }
    }
    if (!isTbd(acc.ad_account_id)) {
      try {
        await graph.post(`/${graph.act(acc.ad_account_id)}/assigned_users`, { user: acc.system_user_id, tasks: ["MANAGE", "ADVERTISE", "ANALYZE"] });
      } catch (e) { errors.push(`assign ad account: ${e.message}`); }
    }
    profile.setup.assets_assigned_at = nowIso();
  }

  profile.accounts = acc;
  saveProfile(slug, profile);
  return { created, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: setup-accounts.js <slug> [--status] [--done <step> [--set k=v]] [--bootstrap]"); process.exit(1); }
  const profile = loadProfile(slug);
  profile.setup = profile.setup || {};

  if (args.includes("--done")) {
    const step = args[args.indexOf("--done") + 1];
    if (!MANUAL_STEPS.includes(step)) { console.error(`Unknown step "${step}". One of: ${MANUAL_STEPS.join(", ")}`); process.exit(1); }
    profile.setup[step] = nowIso();
    const setIdx = args.indexOf("--set");
    let resolvedFromIntake = null;
    if (setIdx >= 0) {
      const [k, v] = (args[setIdx + 1] || "").split("=");
      if (k && v) profile.accounts[k] = v;
    } else if (args.includes("--from-intake")) {
      const result = await resolveFromIntake(step, profile);
      if (!result.ok) { console.error(`[setup-accounts] ${result.reason}`); process.exit(1); }
      profile.accounts[result.key] = result.value;
      resolvedFromIntake = result;
    }
    saveProfile(slug, profile);
    console.log(JSON.stringify({ slug, recorded: step, at: profile.setup[step], resolved_from_intake: resolvedFromIntake, accounts: profile.accounts }, null, 2));
    return;
  }

  if (args.includes("--bootstrap")) {
    const { created, errors } = await bootstrap(slug, profile);
    console.log(JSON.stringify({ slug, created, errors, next: errors.length ? "Resolve errors (likely Advanced Access / verification — see docs/agency-foundation.md), then re-run --bootstrap" : "Run --status to confirm readiness, then /setup-web + /capi-setup" }, null, 2));
    return;
  }

  // default: --status
  printStatus(slug, profile);
}

main().catch((e) => { console.error("[setup-accounts] FATAL:", e.message); process.exit(1); });
