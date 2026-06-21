#!/usr/bin/env node
/**
 * /setup-web companion — registers a domain to the Meta business, surfaces the
 * facebook-domain-verification TXT value, reports Meta's real verification status,
 * and records the live site back into client_profile.json.
 *
 * Domain purchase + Vercel deploy + DNS TXT publishing are driven by the agent in
 * the skill body (Vercel/DNS APIs need their own auth); this handles the Meta side
 * and the profile writeback deterministically.
 *
 * Usage:
 *   node skills/setup-web/setup-web.js <slug> --register example.com
 *   node skills/setup-web/setup-web.js <slug> --verify-status example.com
 *   node skills/setup-web/setup-web.js <slug> --set-website https://example.com
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import * as clientProfile from "../../schemas/client_profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

function profilePathFor(slug) { return resolve(ROOT, "clients", slug, "client_profile.json"); }
function loadProfile(slug) {
  const p = profilePathFor(slug);
  if (!existsSync(p)) { console.error(`Profile not found: ${p} — run /intake first.`); process.exit(2); }
  return clientProfile.normalize(JSON.parse(readFileSync(p, "utf8")));
}
function saveProfile(slug, profile) {
  writeFileSync(profilePathFor(slug), JSON.stringify(clientProfile.normalize(profile), null, 2));
}
const nowIso = () => new Date().toISOString();

async function registerDomain(graph, bizId, domain) {
  // POST /{business_id}/owned_domains {domain_name}; then read back the node to get
  // the verification code + status.
  const res = await graph.post(`/${bizId}/owned_domains`, { domain_name: domain });
  const id = res.id;
  const node = await graph.get(`/${id}`, { fields: "id,domain_name,verification_status,verification_code" }).catch(() => ({}));
  return { id, ...node };
}

async function domainStatus(graph, bizId, domain) {
  const list = await graph.get(`/${bizId}/owned_domains`, { fields: "id,domain_name,verification_status,verification_code" }).catch(() => ({ data: [] }));
  return (list.data || []).find((d) => d.domain_name === domain) || null;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: setup-web.js <slug> [--register d] [--verify-status d] [--set-website url]"); process.exit(1); }
  const profile = loadProfile(slug);
  profile.setup = profile.setup || {};

  const setWebIdx = args.indexOf("--set-website");
  if (setWebIdx >= 0) {
    const url = args[setWebIdx + 1];
    if (!url) { console.error("--set-website needs a URL"); process.exit(1); }
    profile.accounts.website_url = url;
    try { profile.accounts.domain = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    profile.setup.landing_deployed_at = nowIso();
    saveProfile(slug, profile);
    console.log(JSON.stringify({ slug, website_url: url, domain: profile.accounts.domain, next: "Run /capi-setup to install/verify the pixel on this site" }, null, 2));
    return;
  }

  const bizId = profile.accounts.business_id || profile.accounts.bm_id;
  if (isTbd(bizId)) { console.error("Set accounts.business_id first (run /setup-accounts)."); process.exit(3); }
  const graph = createGraph();

  const regIdx = args.indexOf("--register");
  if (regIdx >= 0) {
    const domain = args[regIdx + 1];
    const node = await registerDomain(graph, bizId, domain);
    console.log(JSON.stringify({
      slug, registered: domain, verification_status: node.verification_status || "pending",
      txt_record: node.verification_code ? `facebook-domain-verification=${node.verification_code}` : "(fetch from Business Settings → Brand Safety → Domains)",
      next: "Publish the TXT record via your DNS provider's API, then --verify-status",
    }, null, 2));
    return;
  }

  const vsIdx = args.indexOf("--verify-status");
  if (vsIdx >= 0) {
    const domain = args[vsIdx + 1];
    const node = await domainStatus(graph, bizId, domain);
    if (!node) { console.error(`Domain ${domain} not registered to business ${bizId}. Run --register first.`); process.exit(4); }
    if (node.verification_status === "verified") {
      profile.setup.domain_verified_at = nowIso();
      saveProfile(slug, profile);
    }
    console.log(JSON.stringify({ slug, domain, verification_status: node.verification_status, recorded: node.verification_status === "verified" }, null, 2));
    return;
  }

  console.error("Provide one of --register, --verify-status, --set-website");
  process.exit(1);
}

main().catch((e) => { console.error("[setup-web] FATAL:", e.message); process.exit(1); });
