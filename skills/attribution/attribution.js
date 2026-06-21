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
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: attribution.js <slug> [--method M]"); process.exit(2); }
const method = (process.argv.find((a) => a.startsWith("--method="))?.split("=")[1]) || "meta_lift_study";

const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }

// Source of incremental rows: a provided export (lift_export.json) is preferred.
// (Live pull of the incremental column is wired in SKILL.md; this scaffold reads
// the export so the contract + honesty gate are exercised offline.)
const exportPath = resolve(dir, "lift_export.json");
let rows = [];
if (existsSync(exportPath)) {
  rows = JSON.parse(readFileSync(exportPath, "utf8")).rows || [];
} else {
  console.error(`HALT: no incremental data (${exportPath}). Refusing to emit last-click as "lift". Provide a lift export or wire the Meta incremental-attribution pull.`);
  process.exit(4);
}

const report = schema.normalize({ client_slug: slug, method, rows,
  period_start: process.env.SMOS_PERIOD_START || null, period_end: process.env.SMOS_PERIOD_END || null });

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
