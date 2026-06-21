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

// Social handle availability — HEAD the public profile URL. 404 → likely free,
// 200 → taken. Network failure → null (unknown). Best-effort across platforms.
async function checkHandle(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    if (res.status === 404) return true;
    if (res.status >= 200 && res.status < 400) return false;
    return null;
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

// Trademark KNOCKOUT only — USPTO open-data quick search for live identical marks.
// A hit means "ruled out / needs review"; no hit is NOT clearance. We never return
// "clear: true" with confidence — attorney clearance is always required.
async function trademarkKnockout(name) {
  const term = encodeURIComponent(name.trim());
  try {
    // USPTO trademark search API (open data). Endpoint shape varies; treat any
    // non-2xx or parse failure as "unknown" rather than "clear".
    const res = await fetch(`https://tmsearch.uspto.gov/api/v1/search?query=${term}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { knockout_clear: null, note: `USPTO returned ${res.status} — verify manually` };
    const json = await res.json().catch(() => null);
    const hits = json?.count ?? json?.results?.length ?? null;
    if (hits == null) return { knockout_clear: null, note: "USPTO response unparseable — verify manually" };
    return { knockout_clear: hits === 0, hits, note: hits ? `${hits} potentially conflicting live mark(s)` : "no identical live marks in quick search" };
  } catch (e) {
    return { knockout_clear: null, note: `USPTO unreachable (${e.message}) — verify manually at tmsearch.uspto.gov` };
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
