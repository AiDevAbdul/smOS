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
 *
 * Halts if profile.competitors is empty or fewer than 2 entries.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";
import { competitorIntel as competitorSchema } from "../../schemas/index.js";

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

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv[0];
  if (!slug) {
    console.error("Usage: node skills/research/research.js <slug> [--days N] [--country CC] [--skip-classify]");
    process.exit(1);
  }
  const days = parseInt(argVal(argv, "--days", "90"), 10);
  const skipClassify = argHas(argv, "--skip-classify");

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) throw new Error(`Profile not found: ${profilePath}`);
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));

  const competitors = profile.competitors || [];
  if (competitors.length < 2) {
    throw new Error(`profile.competitors must have ≥ 2 entries — found ${competitors.length}. Add competitor names or page IDs and rerun.`);
  }

  const geoTargets = profile.audience?.geo_targets || (profile.location?.country ? [profile.location.country] : ["US"]);
  const country = argVal(argv, "--country", geoTargets[0] || "US");

  const reportsDir = resolve(ROOT, "clients", slug, "reports");
  mkdirSync(reportsDir, { recursive: true });

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
  const htmlPath = resolve(reportsDir, `competitor_report_${stamp}.html`);

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

  // Step 8: build competitor_intel.json from analyzed output
  const analyzed = JSON.parse(readFileSync(analyzedPath, "utf8"));
  // Normalize to canonical shape — crucially this derives the top-level `angles`
  // array (from analyzed.angles or aggregated from competitors[].angles) that
  // /strategy-brief reads to pick creative angles.
  const intel = competitorSchema.normalize({
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
  });

  const intelPath = resolve(ROOT, "clients", slug, "competitor_intel.json");
  writeFileSync(intelPath, JSON.stringify(intel, null, 2));

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
    gap_count: (intel.gaps || []).length,
    next: "review competitor_intel.json, then /strategy-brief",
  }, null, 2));
}

main().catch((e) => {
  console.error("[research] FATAL:", e.message);
  process.exit(1);
});
