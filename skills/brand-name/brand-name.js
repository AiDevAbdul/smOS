#!/usr/bin/env node
/**
 * /brand-name companion — generates nothing (the LLM does that in the skill body);
 * this SCREENS candidate names against the three independent gates, persists the
 * verbal layer, and (only on explicit human ack) stamps the name gate.
 *
 * Screening is best-effort and fail-OPEN to "unknown" (null), never to a false
 * "available". The trademark check is a knockout filter ONLY — it can rule a name
 * out, never clear one in. attorney_clearance_flagged is always true.
 *
 * Usage:
 *   node skills/brand-name/brand-name.js <slug> --screen "Acme,Northwind"
 *   node skills/brand-name/brand-name.js <slug> --in verbal.json
 *   node skills/brand-name/brand-name.js <slug> --approve-name
 */
import { readFileSync, existsSync } from "node:fs";
import { promises as dns } from "node:dns";
import { loadBrand, saveBrand, stampGate } from "../../scripts/lib/brand.js";

function handleize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// .com availability via DNS — a resolvable A/NS record means it's almost certainly
// taken. No record is a weak "maybe available" signal, so we report null/unknown
// unless RDAP confirms. (Registrar APIs give a definitive answer; wire one in if
// you have credentials.)
async function checkDotCom(name) {
  const domain = `${handleize(name)}.com`;
  try {
    await dns.resolveNs(domain);
    return { domain, available: false }; // has nameservers → registered
  } catch {
    try {
      await dns.resolve(domain);
      return { domain, available: false };
    } catch {
      return { domain, available: null }; // unknown — confirm with a registrar/RDAP lookup
    }
  }
}

// Social handle availability — unauthenticated checks can only PROVE availability,
// not taken-ness: IG/FB/TikTok/X are SPAs that return HTTP 200 (login/app shell)
// for nonexistent handles, so a 200 is NOT evidence the handle is taken. We
// therefore return true ONLY on a clean 404 (definitely free) and null otherwise
// (unknown — verify manually / with an authenticated check). This avoids the
// harmful false-positive of marking an available name as "taken". Verified against
// live IG/FB/TikTok behavior in the v25.0 dry run.
async function checkHandle(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual" });
    if (res.status === 404) return true; // definitively available
    return null;                          // 200/redirect/block → cannot conclude; unknown
  } catch {
    return null;
  }
}

async function checkHandles(name) {
  const h = handleize(name);
  const targets = {
    instagram: `https://www.instagram.com/${h}/`,
    facebook: `https://www.facebook.com/${h}`,
    x: `https://x.com/${h}`,
    tiktok: `https://www.tiktok.com/@${h}`,
    linkedin: `https://www.linkedin.com/company/${h}`,
  };
  const out = {};
  await Promise.all(Object.entries(targets).map(async ([k, url]) => { out[k] = await checkHandle(url); }));
  return out;
}

// Trademark KNOCKOUT only — a hit rules a name OUT; no hit is NEVER clearance.
// The legacy public TESS endpoint was retired and the current USPTO search backend
// (tmsearch.uspto.gov) has no open JSON API — the v25.0 dry run confirmed it 404s.
// Automating this requires a USPTO Open Data Portal API key (developer.uspto.gov,
// trademark APIs). With a key in env we query it; without one we honestly return
// null (manual step) rather than pretend the knockout ran.
async function trademarkKnockout(name) {
  const term = encodeURIComponent(name.trim());
  const key = process.env.USPTO_ODP_API_KEY;
  const manualNote = `verify manually at https://tmsearch.uspto.gov (set USPTO_ODP_API_KEY to automate)`;
  if (!key) return { knockout_clear: null, note: `no USPTO_ODP_API_KEY — ${manualNote}` };
  try {
    const res = await fetch(`https://api.uspto.gov/api/v1/trademarks/search?query=${term}`, {
      headers: { accept: "application/json", "X-API-KEY": key },
    });
    if (!res.ok) return { knockout_clear: null, note: `USPTO returned ${res.status} — ${manualNote}` };
    const json = await res.json().catch(() => null);
    const hits = json?.count ?? json?.results?.length ?? json?.total ?? null;
    if (hits == null) return { knockout_clear: null, note: `USPTO response unparseable — ${manualNote}` };
    return { knockout_clear: hits === 0, hits, note: hits ? `${hits} potentially conflicting live mark(s) — attorney review required` : "no identical live marks in quick search (NOT clearance)" };
  } catch (e) {
    return { knockout_clear: null, note: `USPTO unreachable (${e.message}) — ${manualNote}` };
  }
}

async function screen(names) {
  const rows = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const [dotcom, handles, tm] = await Promise.all([checkDotCom(name), checkHandles(name), trademarkKnockout(name)]);
    rows.push({
      name,
      domain_com_available: dotcom.available,
      domain: dotcom.domain,
      trademark_knockout_clear: tm.knockout_clear,
      trademark_note: tm.note,
      handles_available: handles,
      attorney_clearance_flagged: true, // ALWAYS — knockout is not clearance
    });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: brand-name.js <slug> [--screen 'A,B'] [--in verbal.json] [--approve-name]"); process.exit(1); }

  const b = loadBrand(slug);
  if (!b.strategy.positioning_approved_at && !args.includes("--screen")) {
    console.error("Positioning not approved. Run /brand-strategy and --approve-positioning before naming.");
    process.exit(3);
  }

  if (args.includes("--approve-name")) {
    if (!b.verbal.name) { console.error("No name chosen yet (verbal.name empty). Persist --in verbal.json first."); process.exit(3); }
    if (b.verbal.name_screening?.attorney_clearance_flagged !== true) {
      console.error("Refusing: attorney_clearance_flagged is not set for the chosen name. A human attorney must clear the mark — re-run --screen and acknowledge.");
      process.exit(4);
    }
    const out = stampGate(slug, "name");
    console.log(JSON.stringify({ slug, gate: "name", name: out.verbal.name, approved_at: out.verbal.name_approved_at, status: out.status, next: "/brand-visual" }, null, 2));
    return;
  }

  const screenIdx = args.indexOf("--screen");
  if (screenIdx >= 0) {
    const names = (args[screenIdx + 1] || "").split(",");
    const rows = await screen(names);
    saveBrand(slug, { verbal: { name_candidates: rows } });
    console.log(JSON.stringify({ slug, screened: rows, note: "domain/trademark 'null' = unknown, verify manually. Trademark is a knockout only — attorney clearance still required." }, null, 2));
    return;
  }

  const inIdx = args.indexOf("--in");
  if (inIdx < 0) { console.error("Provide --screen, --in verbal.json, or --approve-name"); process.exit(1); }
  const inPath = args[inIdx + 1];
  if (!existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(2); }
  const verbal = JSON.parse(readFileSync(inPath, "utf8"));
  // carry the chosen name's screen result onto verbal.name_screening for the gate check
  const chosen = (b.verbal.name_candidates || []).find((c) => c.name === verbal.name);
  if (chosen) verbal.name_screening = chosen;
  const out = saveBrand(slug, { verbal }, { stage: "verbal" });
  console.log(JSON.stringify({ slug, layer: "verbal", name: out.verbal.name, status: out.status, next: "Confirm attorney clearance, then --approve-name" }, null, 2));
}

main().catch((e) => { console.error("[brand-name] FATAL:", e.message); process.exit(1); });
