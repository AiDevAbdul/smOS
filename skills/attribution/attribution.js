#!/usr/bin/env node
/**
 * /attribution companion script (Phase 3.1) — incrementality / conversion lift.
 *
 * Architect-level scaffold: pulls campaign insights and, when an incremental
 * attribution column or lift export is present, builds a canonical
 * attribution_report.json + HTML/PDF. Without measured incrementality it HALTS
 * rather than printing last-click numbers dressed up as lift.
 *
 * Usage: node skills/attribution/attribution.js <slug> [--method meta_lift_study]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { attributionReport as schema } from "../../schemas/index.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";
import { resolveToken } from "../../scripts/lib/tokens.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";
import { mapLiftStudy } from "../../scripts/lib/lift_study.js";
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: attribution.js <slug> [--method M] [--study-id ID]"); process.exit(2); }
const method = (process.argv.find((a) => a.startsWith("--method="))?.split("=")[1]) || "meta_lift_study";
const OFFLINE = process.env.SMOS_OFFLINE === "1";

const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

async function pullLiftStudy(studyId, token) {
  const graph = createGraph(token);
  const study = await graph.get(`/${studyId}`, {
    fields: "id,name,type,start_time,end_time,cells{id,name,results,result_set,spend}",
  });
  return { study, rows: mapLiftStudy(study) };
}

// Source priority: (1) a live Meta Conversion Lift study when a study id +
// token are available, (2) a provided export (lift_export.json), (3) HALT.
const exportPath = resolve(dir, "lift_export.json");
const studyId = (process.argv.find((a) => a.startsWith("--study-id="))?.split("=")[1])
  || process.env.SMOS_LIFT_STUDY_ID || profile?.attribution?.lift_study_id;
let rows = [];
let periodStart = process.env.SMOS_PERIOD_START || null;
let periodEnd = process.env.SMOS_PERIOD_END || null;

if (!OFFLINE && studyId) {
  const tok = resolveToken("user", slug, { profile, require: false });
  if (tok.token) {
    try {
      const { study, rows: liftRows } = await pullLiftStudy(studyId, tok.token);
      rows = liftRows;
      periodStart = periodStart || study.start_time || null;
      periodEnd = periodEnd || study.end_time || null;
      writeFileSync(resolve(dir, "lift_study_raw.json"), JSON.stringify(study, null, 2));
      if (!rows.length) console.error(`note: lift study ${studyId} returned no measurable incremental cells (still running, or unsupported result shape).`);
    } catch (e) { console.error(`lift study pull failed: ${e.message}`); }
  } else {
    console.error(`note: study id set but no token resolved for ${slug} — falling back to export.`);
  }
}

if (!rows.length && existsSync(exportPath)) {
  rows = JSON.parse(readFileSync(exportPath, "utf8")).rows || [];
}

if (!rows.length) {
  console.error(`HALT: no measured incremental data (tried lift study${studyId ? ` ${studyId}` : ""} + ${exportPath}). Refusing to emit last-click as "lift". Provide a lift export, set a lift study id, or run a real lift study.`);
  process.exit(4);
}

const report = schema.normalize({ client_slug: slug, method, rows,
  period_start: periodStart, period_end: periodEnd });

const v = schema.validate(report);
if (!v.ok) { console.error("attribution_report INVALID:\n  - " + v.errors.join("\n  - ")); process.exit(5); }

writeFileSync(resolve(dir, "attribution_report.json"), JSON.stringify(report, null, 2));

const md = [
  `# Incrementality Report — ${slug}`,
  `**Method:** ${report.method}  ·  **Period:** ${report.period_start || "?"} → ${report.period_end || "?"}`,
  ``,
  `| Campaign | Last-click conv | Incremental conv | Incremental CPA | Lift factor |`,
  `|---|--:|--:|--:|--:|`,
  ...report.rows.map((r) =>
    `| ${r.entity_name || r.entity_id} | ${r.last_click_conversions} | ${r.incremental_conversions ?? "—"} | ${r.incremental_cpa != null ? "$" + r.incremental_cpa : "—"} | ${r.incrementality_factor ?? "—"} |`),
].join("\n");

writeHtmlAndPdf(resolve(dir, "attribution_report.md"), md, { title: `Incrementality — ${slug}`, subtitle: report.method });

if (supabaseConfigured()) {
  try {
    const client_id = await clientIdBySlug(slug);
    await insert("lift_studies", [{ client_id, slug, method: report.method, report }]);
  } catch (e) { console.error("supabase persist skipped:", e.message); }
}
console.log(`attribution: ${report.rows.length} rows · method=${report.method} → attribution_report.{json,html,pdf}`);
