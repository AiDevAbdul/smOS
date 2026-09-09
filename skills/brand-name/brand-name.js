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
 * The knockout screens the name AND its sound-alike respellings (E3): likelihood of
 * confusion turns on sound, not spelling, so an exact-string search that reports
 * "clear" on "Klaritee" while "Clarity" is live registered is the one false
 * negative this filter must not produce.
 *
 * Usage:
 *   node skills/brand-name/brand-name.js <slug> --screen "Acme,Northwind"
 *   node skills/brand-name/brand-name.js <slug> --screen "Acme" --tlds com,co,io
 *   node skills/brand-name/brand-name.js <slug> --in verbal.json
 *   node skills/brand-name/brand-name.js <slug> --approve-name
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";
import { loadBrand, saveBrand, stampGate } from "../../scripts/lib/brand.js";
import { spellingVariants, isConfusable, soundex, consonantSkeleton } from "../../scripts/lib/phonetics.js";

// The TLDs a small brand actually gets asked for. .com decides the screen; the
// rest are reported so a name that only has fallbacks is visibly weaker.
export const DEFAULT_TLDS = ["com", "co", "io", "net"];

function handleize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// .com availability via DNS — a resolvable A/NS record means it's almost certainly
// taken. No record is a weak "maybe available" signal, so we report null/unknown
// unless RDAP confirms. (Registrar APIs give a definitive answer; wire one in if
// you have credentials.)
async function checkDomain(domain, resolver = dns) {
  try {
    await resolver.resolveNs(domain);
    return { domain, available: false }; // has nameservers → registered
  } catch {
    try {
      await resolver.resolve(domain);
      return { domain, available: false };
    } catch {
      return { domain, available: null }; // unknown — confirm with a registrar/RDAP lookup
    }
  }
}

/**
 * Screen the name across several TLDs. `.com` is still the verdict field the gate
 * reads (`domain_com_available`); the rest are context — a name whose only free
 * option is a fallback TLD is a weaker name, and that should be visible rather
 * than hidden behind one boolean.
 */
export async function checkDomains(name, opts = {}) {
  const tlds = opts.tlds?.length ? opts.tlds : DEFAULT_TLDS;
  const base = handleize(name);
  const resolver = opts.resolver || dns;
  const rows = await Promise.all(tlds.map((tld) => checkDomain(`${base}.${tld}`, resolver)));
  const byTld = {};
  rows.forEach((r, i) => { byTld[tlds[i]] = r.available; });
  return {
    base,
    domains: byTld,
    domain: `${base}.com`,
    com_available: byTld.com ?? null,
    // DNS can only PROVE taken-ness (a nameserver exists). No record is a weak
    // "maybe free", so those are reported as unknown, never as available.
    taken_tlds: tlds.filter((t) => byTld[t] === false),
    unknown_tlds: tlds.filter((t) => byTld[t] === null),
  };
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

/**
 * Handle consistency: one brand should be @thesamething everywhere. A name whose
 * handle is free on IG but taken on TikTok forces a per-platform suffix, which is
 * a real cost (it breaks recall and every cross-platform CTA), so the screen
 * reports it as a verdict instead of leaving five booleans for a human to compare.
 *
 * `true` = a clean 404 (definitely free), `null` = unknown. So `consistent` can
 * only ever be true when EVERY platform 404s; anything else is "unknown".
 */
export function handleConsistency(handle, handles) {
  const entries = Object.entries(handles || {});
  const free = entries.filter(([, v]) => v === true).map(([k]) => k);
  const unknown = entries.filter(([, v]) => v !== true).map(([k]) => k);
  return {
    handle: `@${handle}`,
    platforms_checked: entries.length,
    definitely_free: free,
    unknown,
    consistent: entries.length > 0 && unknown.length === 0 ? true : null,
    note: unknown.length
      ? `unverified on ${unknown.join(", ")} — these platforms serve 200 for nonexistent handles, so check them signed-in before committing`
      : "the same handle 404s on every platform checked — consistent set available",
  };
}

// Trademark KNOCKOUT only — a hit rules a name OUT; no hit is NEVER clearance.
// The legacy public TESS endpoint was retired and the current USPTO search backend
// (tmsearch.uspto.gov) has no open JSON API — the v25.0 dry run confirmed it 404s.
// Automating this requires a USPTO Open Data Portal API key (developer.uspto.gov,
// trademark APIs). With a key in env we query it; without one we honestly return
// null (manual step) rather than pretend the knockout ran.
async function queryUspto(term, key, fetchImpl) {
  const res = await fetchImpl(`https://api.uspto.gov/api/v1/trademarks/search?query=${encodeURIComponent(term)}`, {
    headers: { accept: "application/json", "X-API-KEY": key },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = await res.json().catch(() => null);
  const hits = json?.count ?? json?.results?.length ?? json?.total ?? null;
  const marks = (json?.results || json?.trademarks || json?.data || [])
    .map((m) => m?.markText ?? m?.mark_identification ?? m?.markIdentification ?? m?.name)
    .filter((m) => typeof m === "string");
  return { ok: true, hits, marks };
}

export async function trademarkKnockout(name, opts = {}) {
  const key = opts.apiKey ?? process.env.USPTO_ODP_API_KEY;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const queries = spellingVariants(name, { limit: opts.variantLimit ?? 6 });
  const manualNote = `verify manually at https://tmsearch.uspto.gov (set USPTO_ODP_API_KEY to automate)`;
  const phonetics = { soundex: soundex(name), consonant_skeleton: consonantSkeleton(name) };

  if (!key) {
    // Honest: the knockout did not run. But hand over the exact search set a human
    // should paste into TESS, so the manual step is the full neighbourhood.
    return {
      knockout_clear: null, hits: null, queried: queries, similar_marks: [], phonetics,
      note: `no USPTO_ODP_API_KEY — knockout NOT run. ${manualNote}. Search these respellings too: ${queries.join(", ")}`,
    };
  }

  let total = 0;
  const similar = [];
  const failed = [];
  for (const q of queries) {
    let r;
    try { r = await queryUspto(q, key, fetchImpl); }
    catch (e) { failed.push(`${q}: ${e.message}`); continue; }
    if (!r.ok) { failed.push(`${q}: HTTP ${r.status}`); continue; }
    if (r.hits == null) { failed.push(`${q}: unparseable response`); continue; }
    total += r.hits;
    for (const mark of r.marks) {
      const conf = isConfusable(name, mark);
      if (conf.confusable && !similar.some((s) => s.mark === mark)) {
        similar.push({ mark, matched_query: q, reasons: conf.reasons, similarity: Number(conf.similarity.toFixed(2)) });
      }
    }
  }

  // Fail-OPEN to unknown: if any query in the set failed, we did not screen the
  // neighbourhood, so we cannot report a clean sheet even if the ones that ran were clean.
  if (failed.length) {
    return {
      knockout_clear: null, hits: total || null, queried: queries, similar_marks: similar, phonetics,
      note: `knockout incomplete (${failed.length}/${queries.length} queries failed: ${failed.join("; ")}) — ${manualNote}`,
    };
  }
  return {
    knockout_clear: total === 0 && similar.length === 0,
    hits: total,
    queried: queries,
    similar_marks: similar,
    phonetics,
    note: similar.length
      ? `${similar.length} sound-alike/near mark(s) across ${queries.length} respellings — likely knockout, attorney review required`
      : total
        ? `${total} hit(s) across ${queries.length} respellings, none scoring as confusable — attorney review required`
        : `no hits across ${queries.length} respellings (NOT clearance)`,
  };
}

export async function screen(names, opts = {}) {
  const rows = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const [dom, handles, tm] = await Promise.all([
      checkDomains(name, opts),
      opts.checkHandlesImpl ? opts.checkHandlesImpl(name) : checkHandles(name),
      trademarkKnockout(name, opts),
    ]);
    rows.push({
      name,
      domain_com_available: dom.com_available,
      domain: dom.domain,
      domains: dom.domains,
      domains_taken: dom.taken_tlds,
      trademark_knockout_clear: tm.knockout_clear,
      trademark_note: tm.note,
      trademark_queried: tm.queried,
      trademark_similar_marks: tm.similar_marks,
      phonetics: tm.phonetics,
      handles_available: handles,
      handle_consistency: handleConsistency(handleize(name), handles),
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
    const tldIdx = args.indexOf("--tlds");
    const tlds = tldIdx >= 0 ? (args[tldIdx + 1] || "").split(",").map((t) => t.trim().replace(/^\./, "")).filter(Boolean) : null;
    const rows = await screen(names, tlds ? { tlds } : {});
    saveBrand(slug, { verbal: { name_candidates: rows } });
    console.log(JSON.stringify({
      slug, screened: rows,
      note: "domain/trademark/handle 'null' = UNKNOWN, not available — verify manually. The trademark screen covers sound-alike respellings but is a knockout only: attorney clearance is still required.",
    }, null, 2));
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

// Guarded so the screen helpers above are importable (tests inject a fake DNS
// resolver / fetch rather than hitting the live registries).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[brand-name] FATAL:", e.message); process.exit(1); });
}
