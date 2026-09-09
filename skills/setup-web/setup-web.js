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
 *   node skills/setup-web/setup-web.js <slug> --probe https://example.com
 *
 * --set-website GETs the URL first and refuses to record one that does not answer
 * with a 2xx (E3 "verify, don't assume") — an unreachable landing page recorded as
 * live poisons /capi-setup, domain verification and every ad link downstream.
 * --force records it anyway and says, in the profile, that it was unverified.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import * as clientProfile from "../../schemas/client_profile.js";
import * as P from "../../scripts/lib/paths.js";
import { probeUrl, describeProbe } from "../../scripts/lib/verify_url.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

function profilePathFor(slug) { return P.clientFile(slug, "client_profile.json"); }
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

  const probeIdx = args.indexOf("--probe");
  if (probeIdx >= 0) {
    const target = args[probeIdx + 1] || profile.accounts.website_url;
    if (!target) { console.error("--probe needs a URL (or set accounts.website_url first)"); process.exit(1); }
    const probe = await probeUrl(target);
    console.log(JSON.stringify({ slug, probe, summary: describeProbe(probe) }, null, 2));
    if (!probe.ok) process.exit(5);
    return;
  }

  const setWebIdx = args.indexOf("--set-website");
  if (setWebIdx >= 0) {
    const url = args[setWebIdx + 1];
    if (!url) { console.error("--set-website needs a URL"); process.exit(1); }
    const force = args.includes("--force");
    const probe = await probeUrl(url);
    if (!probe.ok && !force) {
      console.error(JSON.stringify({
        slug, refused: url, reason: describeProbe(probe), probe,
        fix: "Deploy the landing page (or wait for DNS to propagate) and re-run. Pass --force to record it unverified anyway.",
      }, null, 2));
      process.exit(5);
    }
    // Record the URL the browser actually lands on — http→https and apex→www
    // redirects are the norm, and the final URL is what ads and the pixel must use.
    const recorded = probe.ok ? (probe.final_url || probe.url) : url;
    profile.accounts.website_url = recorded;
    try { profile.accounts.domain = new URL(recorded).hostname.replace(/^www\./, ""); } catch {}
    profile.setup.landing_deployed_at = nowIso();
    profile.setup.landing_verified_at = probe.ok ? probe.checked_at : null;
    profile.setup.landing_probe = {
      url, final_url: probe.final_url, status: probe.status,
      redirects: probe.redirects.length, https: probe.https,
      ok: probe.ok, error: probe.error, checked_at: probe.checked_at,
      forced: probe.ok ? false : true,
    };
    saveProfile(slug, profile);
    console.log(JSON.stringify({
      slug, website_url: recorded, domain: profile.accounts.domain,
      verified: probe.ok, probe_summary: describeProbe(probe),
      warning: probe.ok ? null : "RECORDED UNVERIFIED (--force): the site did not answer. Downstream pixel/domain-verification steps will fail until it does.",
      next: "Run /capi-setup to install/verify the pixel on this site",
    }, null, 2));
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

  console.error("Provide one of --register, --verify-status, --set-website, --probe");
  process.exit(1);
}

main().catch((e) => { console.error("[setup-web] FATAL:", e.message); process.exit(1); });
