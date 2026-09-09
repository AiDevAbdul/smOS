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
import {
  spineSummary,
  spinePath,
  measurementSpineMarkdown,
  reconcileConversions,
  recordReconciliation,
  persistSpineSnapshot,
  asCount,
} from "../../scripts/lib/measurement_spine.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: attribution.js <slug> [--method M] [--study-id ID]"); process.exit(2); }
const method = (process.argv.find((a) => a.startsWith("--method="))?.split("=")[1]) || "meta_lift_study";
const OFFLINE = process.env.SMOS_OFFLINE === "1";

const dir = resolve(P.clientRoot(slug));
const profilePath = P.clientFile(slug, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

// ── measurement spine (E4) ────────────────────────────────────────────────
// One spine, two skills: /capi-setup writes Event Match Quality + conversion
// reconciliation into clients/<slug>/data/measurement_spine.json, and this
// skill READS it (JSON handoff — it never re-pulls the dataset). An
// incrementality number published on top of a dataset matching 2/10, or on
// platform-reported conversions nobody has reconciled, now says so.
const argv = process.argv.slice(2);
const flag = (name) => {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return null;
};

// `--observed N` records a reconciliation through the SAME writer /capi-setup
// uses, because CRM-observed conversions usually surface during an
// incrementality conversation rather than during a pixel check.
const observedArg = flag("--observed");
if (observedArg != null) {
  const rec = reconcileConversions({
    platform_reported: asCount(flag("--platform-conversions")),
    observed: asCount(observedArg),
    platform_source: flag("--platform-conversions") != null ? "--platform-conversions (operator-supplied)" : null,
    observed_source: flag("--observed-source") || "unstated",
    observed_audited: argv.includes("--observed-audited"),
    event: flag("--event"),
    window: flag("--window") || (periodLabel()),
    recorded_by: "attribution",
  });
  recordReconciliation(slug, rec);
  await persistSpineSnapshot(slug, { reconciliation: rec });
  console.error(`attribution: recorded reconciliation (coverage_ratio=${rec.coverage_ratio ?? "null"}, verdict=${rec.verdict}) → ${spinePath(slug)}`);
}

function periodLabel() {
  const s = process.env.SMOS_PERIOD_START, e = process.env.SMOS_PERIOD_END;
  return s || e ? `${s || "?"}→${e || "?"}` : null;
}

const spine = spineSummary(slug);

// `--spine` is a read-only inspection mode: print what the spine currently
// holds and exit. Deliberately does NOT require lift data, so measurement
// quality can be checked before a lift study exists.
if (argv.includes("--spine")) {
  console.log(JSON.stringify({ ...spine, spine_path: spinePath(slug) }, null, 2));
  process.exit(0);
}

async function pullLiftStudy(studyId, token) {
  const graph = createGraph(token);
  const study = await graph.get(`/${studyId}`, {
    fields: "id,name,type,start_time,end_time,cells{id,name,results,result_set,spend}",
  });
  return { study, rows: mapLiftStudy(study) };
}

// Source priority: (1) a live Meta Conversion Lift study when a study id +
// token are available, (2) a provided export (lift_export.json), (3) HALT.
const exportPath = P.clientFile(slug, "lift_export.json");
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
      writeFileSync(P.clientFile(slug, "lift_study_raw.json", { forWrite: true }), JSON.stringify(study, null, 2));
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
  period_start: periodStart, period_end: periodEnd,
  // The measurement context this lift number sits on top of. Carried in the
  // report (schema.normalize preserves extra keys) so a consumer — /report,
  // /portal, /bundle — gets the EMQ + reconciliation state with the lift, not
  // separately, and never has to re-derive either.
  measurement_spine: { ...spine, spine_path: spinePath(slug) } });

const v = schema.validate(report);
if (!v.ok) { console.error("attribution_report INVALID:\n  - " + v.errors.join("\n  - ")); process.exit(5); }

writeFileSync(P.clientFile(slug, "attribution_report.json", { forWrite: true }), JSON.stringify(report, null, 2));

const md = [
  `# Incrementality Report — ${slug}`,
  `**Method:** ${report.method}  ·  **Period:** ${report.period_start || "?"} → ${report.period_end || "?"}`,
  ``,
  `| Campaign | Last-click conv | Incremental conv | Incremental CPA | Lift factor |`,
  `|---|--:|--:|--:|--:|`,
  ...report.rows.map((r) =>
    `| ${r.entity_name || r.entity_id} | ${r.last_click_conversions} | ${r.incremental_conversions ?? "—"} | ${r.incremental_cpa != null ? "$" + r.incremental_cpa : "—"} | ${r.incrementality_factor ?? "—"} |`),
  ``,
  `_Last-click conversions are **platform-reported**. Incremental figures come from the declared method (${report.method})._`,
  ``,
  measurementSpineMarkdown(spine),
].join("\n");

writeHtmlAndPdf(P.clientFile(slug, "attribution_report.md", { forWrite: true }), md, { title: `Incrementality — ${slug}`, subtitle: report.method });

if (supabaseConfigured()) {
  try {
    const client_id = await clientIdBySlug(slug);
    await insert("lift_studies", [{ client_id, slug, method: report.method, report }]);
  } catch (e) { console.error("supabase persist skipped:", e.message); }
}
const emqNote = spine.emq?.dataset_avg_score != null
  ? `EMQ ${spine.emq.dataset_avg_score}/10`
  : "EMQ unknown (run /capi-setup)";
const recNote = spine.reconciliation?.coverage_ratio != null
  ? `coverage ${spine.reconciliation.coverage_ratio}`
  : "conversions unreconciled (platform-reported)";
console.log(`attribution: ${report.rows.length} rows · method=${report.method} · ${emqNote} · ${recNote} → attribution_report.{json,html,pdf}`);
