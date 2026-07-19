#!/usr/bin/env node
/**
 * /research companion script — competitor Ad Library intel.
 *
 * Orchestrates the existing Python pipeline (client.py → analyzer.py → classifier.py → report.py)
 * and produces clients/<slug>/competitor_intel.json + a ranked HTML report.
 *
 * Usage:
 *   node skills/research/research.js <slug>
 *   node skills/research/research.js <slug> --days 90 --country US
 *   node skills/research/research.js <slug> --skip-classify   # skip LLM angle taxonomy
 *   node skills/research/research.js <slug> --discover         # auto-discover competitors via Ad Library category sweep
 *
 * Halts if profile.competitors is empty or fewer than 2 entries (unless --discover finds suggestions).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";
import { competitorIntel as competitorSchema } from "../../schemas/index.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

function argVal(args, flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

function argHas(args, flag) { return args.includes(flag); }

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function resolveCompetitorPageId(graph, nameOrId, country) {
  // If numeric, assume Page ID
  if (/^\d{6,}$/.test(String(nameOrId))) return { name: nameOrId, page_id: String(nameOrId) };
  // Otherwise search the Ad Library via Graph
  try {
    const res = await graph.get("/ads_archive", {
      search_terms: nameOrId,
      ad_reached_countries: `["${country}"]`,
      ad_active_status: "ACTIVE",
      fields: "page_id,page_name",
      limit: 25,
    });
    const ads = res.data || [];
    if (!ads.length) return { name: nameOrId, page_id: null, status: "inactive_or_not_found" };
    // Tally page_ids and pick the most common
    const tally = new Map();
    for (const ad of ads) {
      if (!ad.page_id) continue;
      const k = `${ad.page_id}|${ad.page_name || ""}`;
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    if (!tally.size) return { name: nameOrId, page_id: null, status: "no_page_id_in_ads" };
    const [topKey] = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0];
    const [pageId, pageName] = topKey.split("|");
    return { name: pageName || nameOrId, page_id: pageId, ad_count_in_country: tally.get(topKey) };
  } catch (e) {
    return { name: nameOrId, page_id: null, status: `error:${e.message}` };
  }
}

function runPy(args, opts = {}) {
  const res = spawnSync("python3", args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
  if (res.status !== 0) {
    throw new Error(`python3 ${args.join(" ")} failed (code ${res.status}): ${res.stderr || res.stdout}`);
  }
  return { stdout: res.stdout, stderr: res.stderr };
}

/**
 * Auto-discover competitors by sweeping the Ad Library for the client's
 * business category + geo. Uses discover_pk.py (category sweep) and
 * optionally term_expansion.py (LLM term expansion) under the hood.
 *
 * Returns an array of {page_name, page_id, active_ads, reason} suggestions.
 * Never auto-adds to profile.competitors — only suggests for human review.
 */
function discoverCompetitors(profile, country, days, reportsDir) {
  const category = profile.business?.category || profile.business?.niche || null;
  if (!category) {
    console.error("[research] --discover: no business.category or business.niche in profile — skipping discovery");
    return [];
  }

  const geoLabel = country || "US";

  // Build seed search terms from the category
  const seedTerms = [category];
  if (profile.business?.niche && profile.business.niche !== category) {
    seedTerms.push(profile.business.niche);
  }
  // Add any service keywords from the profile
  const services = profile.business?.services || profile.services || [];
  for (const svc of services.slice(0, 5)) {
    const term = typeof svc === "string" ? svc : svc.name;
    if (term) seedTerms.push(term);
  }

  // Step 1: Expand terms via term_expansion.py (best-effort)
  let expandedTerms = seedTerms;
  try {
    const expandResult = runPy([
      "scripts/meta-ad-library/term_expansion.py",
      "--category", category.toLowerCase().replace(/\s+/g, "_"),
      "--label", category,
      "--seeds", ...seedTerms,
      "--cache-dir", resolve(reportsDir, ".term_cache"),
      "--no-llm",  // stay fast for discovery; LLM expansion is opt-in via market.py
    ]);
    const parsed = JSON.parse(expandResult.stdout.trim());
    if (Array.isArray(parsed) && parsed.length) expandedTerms = parsed;
  } catch (e) {
    console.error(`[research] term expansion failed (${e.message.split("\n")[0]}) — using seed terms`);
  }

  // Step 2: Run discover_pk.py with the terms
  const discoveryOutput = resolve(reportsDir, `discovery_${ts()}.json`);
  try {
    runPy([
      "scripts/meta-ad-library/discover_pk.py",
      "--terms", ...expandedTerms.slice(0, 10),
      "--country", geoLabel,
      "--max-pages", "3",
      "--since", new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
      "--output", discoveryOutput,
    ]);
  } catch (e) {
    console.error(`[research] discover_pk.py failed: ${e.message.split("\n")[0]}`);
    return [];
  }

  if (!existsSync(discoveryOutput)) return [];

  const discovery = JSON.parse(readFileSync(discoveryOutput, "utf8"));
  const pages = discovery.pages || [];

  // Filter out the client's own page and any already-named competitors
  const existingIds = new Set(
    (profile.competitors || []).map((c) => String(typeof c === "string" ? c : (c.page_id || c.name)))
  );
  const clientPageId = String(profile.meta?.page_id || profile.facebook?.page_id || "");

  const suggestions = pages
    .filter((p) => !existingIds.has(p.page_id) && !existingIds.has(p.page_name) && p.page_id !== clientPageId)
    .slice(0, 15)
    .map((p) => ({
      page_name: p.page_name,
      page_id: p.page_id,
      active_ads: p.ad_count_sampled,
      reason: `top advertiser in ${category} in ${geoLabel}`,
    }));

  return suggestions;
}

/**
 * Auto-persist the analyzed snapshot to Supabase via persist.py.
 * Best-effort: if Supabase creds are missing or persist fails, log and continue.
 */
function autoPersistSnapshot(analyzedPath, slug, profile) {
  const clientId = profile.meta?.ad_account_id || profile.ad_account?.id || slug;
  try {
    runPy([
      "scripts/meta-ad-library/persist.py",
      "competitor",
      "--input", analyzedPath,
      "--client-id", String(clientId),
      "--slug", slug,
    ]);
    console.error(`[research] snapshot persisted to Supabase`);
  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("SUPABASE_URL") || msg.includes("SUPABASE_SERVICE_KEY")) {
      console.error("[research] snapshot persistence skipped — Supabase credentials not configured");
    } else {
      console.error(`[research] snapshot persistence failed (best-effort): ${msg.split("\n")[0]}`);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv[0];
  if (!slug) {
    console.error("Usage: node skills/research/research.js <slug> [--days N] [--country CC] [--skip-classify]");
    process.exit(1);
  }
  const days = parseInt(argVal(argv, "--days", "90"), 10);
  const skipClassify = argHas(argv, "--skip-classify");
  const wantsDiscover = argHas(argv, "--discover");

  const profilePath = P.clientFile(slug, "client_profile.json");
  if (!existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));

  const intelPathEarly = P.clientFile(slug, "competitor_intel.json");

  // ── Synthesis mode ──────────────────────────────────────────────────────────
  // When the client opts out of a live named-competitor Ad Library pull, /research
  // ships a synthesized *category* intel instead of a ranked benchmark. We still
  // owe a rendered deliverable so the client hub (/bundle) finds the research phase.
  // Trigger explicitly with --synthesis, or implicitly when competitors are absent
  // but a synthesis-mode competitor_intel.json already exists.
  const existingIntel = existsSync(intelPathEarly)
    ? (() => { try { return JSON.parse(readFileSync(intelPathEarly, "utf8")); } catch { return null; } })()
    : null;
  const isSynthesisIntel = existingIntel
    && (existingIntel.mode === "generic_keyword_synthesis" || existingIntel.category_landscape);
  const wantsSynthesis = argHas(argv, "--synthesis")
    || ((profile.competitors || []).length < 2 && isSynthesisIntel);

  if (wantsSynthesis) {
    if (!isSynthesisIntel) {
      throw new Error(
        "--synthesis requires an existing synthesis-mode competitor_intel.json " +
        "(mode:'generic_keyword_synthesis' or a category_landscape block). " +
        "Create the synthesized intel first, then rerun with --synthesis.");
    }
    const dateS = new Date().toISOString().slice(0, 10);
    const htmlS = P.ensureParent(P.clientReport(slug, dateS, "competitor", "html"));
    console.error(`[research] synthesis mode — rendering HTML from ${intelPathEarly}…`);
    runPy(["scripts/meta-ad-library/report.py", "--input", intelPathEarly, "--output", htmlS]);
    const pdfS = htmlS.replace(/\.html$/, ".pdf");
    try {
      runPy(["scripts/render_pdf.py", htmlS, "--output", pdfS]);
      console.error(`[research] PDF rendered: ${pdfS}`);
    } catch (e) {
      console.error(`[research] PDF render skipped: ${e.message.split("\n")[0]}`);
    }
    console.log(JSON.stringify({
      slug,
      mode: "synthesis",
      html_report: htmlS,
      pdf_report: existsSync(pdfS) ? pdfS : null,
      intel_path: intelPathEarly,
      next: "review the report, run /bundle to include it, then /strategy-brief",
    }, null, 2));
    return;
  }

  const competitors = profile.competitors || [];
  if (competitors.length < 2) {
    throw new Error(
      `profile.competitors must have ≥ 2 entries — found ${competitors.length}. ` +
      "Add competitor names/Page IDs and rerun, OR ship a synthesized category intel: " +
      "author competitor_intel.json (mode:'generic_keyword_synthesis') then rerun with --synthesis.");
  }

  const geoTargets = profile.audience?.geo_targets || (profile.location?.country ? [profile.location.country] : ["US"]);
  const country = argVal(argv, "--country", geoTargets[0] || "US");

  const today = new Date().toISOString().slice(0, 10);
  const htmlReportPath = P.ensureParent(P.clientReport(slug, today, "competitor", "html"));
  const reportsDir = dirname(htmlReportPath);

  // Step 1: resolve competitor names → page IDs
  console.error(`[research] resolving ${competitors.length} competitors in ${country}…`);
  const graph = createGraph();
  const resolved = [];
  for (const c of competitors) {
    const entry = typeof c === "string" ? c : (c.page_id || c.name);
    const r = await resolveCompetitorPageId(graph, entry, country);
    resolved.push(r);
    console.error(`  - ${r.name}: ${r.page_id || "NOT FOUND"}`);
  }

  const activePageIds = resolved.filter((r) => r.page_id).map((r) => r.page_id);
  if (!activePageIds.length) throw new Error("No active page IDs resolved — check competitor names or supply Page IDs directly");

  const stamp = ts();
  const rawPath = resolve(reportsDir, `raw_${stamp}.json`);
  const analyzedPath = resolve(reportsDir, `analyzed_${stamp}.json`);
  const htmlPath = htmlReportPath;

  // Step 2: client.py fetch
  console.error(`[research] fetching ads from Ad Library (last ${days}d)…`);
  runPy([
    "scripts/meta-ad-library/client.py",
    "--page-ids", ...activePageIds,
    "--country", country,
    "--days", String(days),
    "--output", rawPath,
  ]);

  // Step 3: analyzer.py
  console.error(`[research] analyzing creative angles…`);
  runPy([
    "scripts/meta-ad-library/analyzer.py",
    "--input", rawPath,
    "--output", analyzedPath,
  ]);

  // Step 4: classifier.py (LLM angle taxonomy)
  if (!skipClassify) {
    console.error(`[research] classifying ad angles via LLM…`);
    try {
      runPy([
        "scripts/meta-ad-library/classifier.py",
        "--analyzed", analyzedPath,
        "--raw", rawPath,
      ]);
    } catch (e) {
      console.error(`[research] classifier failed (${e.message}) — continuing with regex-derived angles`);
    }
  }

  // Step 5: report.py → HTML
  console.error(`[research] rendering HTML report…`);
  runPy([
    "scripts/meta-ad-library/report.py",
    "--input", analyzedPath,
    "--output", htmlPath,
  ]);

  // Step 6: render PDF if helper exists
  const pdfPath = htmlPath.replace(/\.html$/, ".pdf");
  try {
    runPy(["scripts/render_pdf.py", htmlPath, "--output", pdfPath]);
    console.error(`[research] PDF rendered: ${pdfPath}`);
  } catch (e) {
    console.error(`[research] PDF render skipped: ${e.message.split("\n")[0]}`);
  }

  // Step 7: diff against prior snapshot if any
  const priorRawFiles = readdirSync(reportsDir)
    .filter((f) => f.startsWith("analyzed_") && f.endsWith(".json") && !f.includes(stamp))
    .sort();
  let diffPath = null;
  if (priorRawFiles.length) {
    const prior = resolve(reportsDir, priorRawFiles[priorRawFiles.length - 1]);
    diffPath = resolve(reportsDir, `snapshot_diff_${stamp}.json`);
    try {
      runPy([
        "scripts/meta-ad-library/differ.py",
        "--prior", prior,
        "--current", analyzedPath,
        "--output", diffPath,
      ]);
      console.error(`[research] diff written: ${diffPath}`);
    } catch (e) {
      console.error(`[research] differ failed (${e.message.split("\n")[0]}) — skipping diff`);
      diffPath = null;
    }
  }

  // Step 8: auto-discover competitors if --discover flag is set
  let suggestedCompetitors = [];
  if (wantsDiscover) {
    console.error(`[research] running competitor auto-discovery for ${profile.business?.category || profile.business?.niche || "unknown category"}…`);
    suggestedCompetitors = discoverCompetitors(profile, country, days, reportsDir);
    if (suggestedCompetitors.length) {
      console.error(`\n── Suggested competitors to review: ──────────────────`);
      for (const s of suggestedCompetitors) {
        console.error(`  ${String(s.active_ads).padStart(3)}  ${s.page_name}  (${s.page_id}) — ${s.reason}`);
      }
      console.error(`──────────────────────────────────────────────────────\n`);
    } else {
      console.error("[research] no new competitor suggestions found");
    }
  }

  // Step 9: load diff summary for trend data
  let trendData = null;
  if (diffPath && existsSync(diffPath)) {
    try {
      trendData = JSON.parse(readFileSync(diffPath, "utf8"));
      const s = trendData.summary || {};
      console.error(`\n── Trend Summary (vs prior snapshot) ─────────────────`);
      console.error(`  New ads:        ${s.total_new_ads || 0}`);
      console.error(`  Killed ads:     ${s.total_killed_ads || 0}`);
      console.error(`  Movers:         ${(s.competitors_with_changes || []).length} competitor(s)`);
      for (const name of (s.competitors_with_changes || []).slice(0, 10)) {
        const c = trendData.competitors?.[name];
        if (!c) continue;
        const bits = [];
        if (c.new_ad_count) bits.push(`+${c.new_ad_count} new`);
        if (c.killed_ad_count) bits.push(`-${c.killed_ad_count} killed`);
        bits.push(...(c.changes || []));
        console.error(`    · ${name}: ${bits.join("; ")}`);
      }
      console.error(`──────────────────────────────────────────────────────\n`);
    } catch (e) {
      console.error(`[research] could not load diff for trend summary: ${e.message.split("\n")[0]}`);
    }
  }

  // Step 10: build competitor_intel.json from analyzed output
  const analyzed = JSON.parse(readFileSync(analyzedPath, "utf8"));
  // Normalize to canonical shape — crucially this derives the top-level `angles`
  // array (from analyzed.angles or aggregated from competitors[].angles) that
  // /strategy-brief reads to pick creative angles.
  const intelData = {
    client_slug: slug,
    generated_at: new Date().toISOString(),
    country,
    days_window: days,
    competitors: analyzed.competitors || analyzed.pages || [],
    gaps: analyzed.gaps || [],
    angles: analyzed.angles || [],
    artifacts: {
      raw: rawPath,
      analyzed: analyzedPath,
      html: htmlPath,
      pdf: existsSync(pdfPath) ? pdfPath : null,
      diff: diffPath,
    },
    resolved_page_ids: resolved,
  };

  // Include trend data from diff if available
  if (trendData) {
    intelData.trend = trendData;
  }

  // Include discovery suggestions (separate from competitors — never auto-added)
  if (suggestedCompetitors.length) {
    intelData.suggested_competitors = suggestedCompetitors;
  }

  const intel = competitorSchema.normalize(intelData);

  const intelPath = P.clientFile(slug, "competitor_intel.json", { forWrite: true });
  writeFileSync(intelPath, JSON.stringify(intel, null, 2));

  // Step 11: auto-persist snapshot to Supabase (best-effort)
  autoPersistSnapshot(analyzedPath, slug, profile);

  console.log(JSON.stringify({
    slug,
    competitors_resolved: activePageIds.length,
    competitors_skipped: resolved.length - activePageIds.length,
    days,
    country,
    intel_path: intelPath,
    html_report: htmlPath,
    pdf_report: existsSync(pdfPath) ? pdfPath : null,
    diff: diffPath,
    trend_summary: trendData?.summary || null,
    suggested_competitors: suggestedCompetitors.length ? suggestedCompetitors : undefined,
    gap_count: (intel.gaps || []).length,
    next: "review competitor_intel.json, then /strategy-brief",
  }, null, 2));
}

main().catch((e) => {
  console.error("[research] FATAL:", e.message);
  process.exit(1);
});
