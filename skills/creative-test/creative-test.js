#!/usr/bin/env node
/**
 * /creative-test companion script (Phase 1 — closes the "no structured creative
 * testing loop" gap). In 2026 performance is won at the creative-volume level, so
 * this skill turns approved angles + copy into a disciplined experiment and, when
 * results come back, calls a winner with real statistical significance.
 *
 * Two modes:
 *   (default / --plan)  Design a concept × hook × format test matrix from
 *                       strategy_brief.creative_angles + ad_copy.json. Writes
 *                       creative_test_plan.json + .md (+ HTML/PDF). Everything PAUSED.
 *   --evaluate          Read clients/<slug>/creative_test_results.json (per-cell
 *                       impressions / results / spend) and pick a winner vs the
 *                       control using a two-proportion z-test gated by a minimum
 *                       conversion count. Fail-closed: refuses to crown a winner on
 *                       insufficient data.
 *
 * Usage:
 *   node skills/creative-test/creative-test.js <slug> [--plan] [--metric=ctr|cvr]
 *   node skills/creative-test/creative-test.js <slug> --evaluate
 *
 * Reads:  clients/<slug>/strategy_brief.json, ad_copy.json
 *         clients/<slug>/creative_test_results.json   (--evaluate only)
 * Writes: clients/<slug>/creative_test_plan.json + .md + .html (+ .pdf)
 *         clients/<slug>/creative_test_decision.json   (--evaluate)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { strategyBrief as briefSchema, adCopy as adCopySchema } from "../../schemas/index.js";
import { twoProportionZ, scaleSignificance, wilsonLowerBound } from "../../scripts/lib/stats.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const MIN_RESULTS_PER_CELL = 50;   // floor before a cell's rate is trustworthy
const MIN_CONVERSIONS_FOR_WIN = 25; // significance gate (mirrors scale.js discipline)

function hookCodeFor(angle) {
  return String(angle.hook_code || angle.angle_id || angle.name || "HOOK")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "HOOK";
}

/** Pure builder: brief + copy → a structured test matrix. No I/O. */
export function buildTestPlan({ brief, adCopy, metric = "ctr" }) {
  const angles = (brief?.creative_angles || []);
  const formats = [...new Set(angles.map((a) => a.format || "single_image"))];
  const primaryMetric = metric === "cvr" ? "CVR (results / impressions)" : "CTR (link clicks / impressions)";

  // One cell per (angle × its format). The control is the first angle — every other
  // cell is measured against it so the test answers "which hook beats the incumbent".
  const cells = angles.map((a, i) => {
    const { copy_used } = adCopySchema.selectTopCopy(a, adCopy) || {};
    return {
      cell_id: `${hookCodeFor(a)}_${(a.format || "IMG").toUpperCase().slice(0, 3)}`,
      angle_id: a.angle_id || null,
      angle: a.name || null,
      hook_code: hookCodeFor(a),
      format: a.format || "single_image",
      is_control: i === 0,
      copy_headline: copy_used?.headline || null,
      status: "PAUSED",
    };
  });

  return {
    schema: "creative_test_plan/v1",
    mode: "plan",
    hypothesis:
      "At least one challenger hook will beat the control hook on the primary metric " +
      "by a statistically significant margin, identifying the angle to scale.",
    design: {
      type: "concept_x_hook_x_format",
      structure: "Launch every cell as its own ad inside ONE ad set (or one Advantage+ " +
        "Creative / Dynamic Creative ad set) so they share audience + budget and compete cleanly.",
      control_cell: cells.find((c) => c.is_control)?.cell_id || null,
      formats_under_test: formats,
      cell_count: cells.length,
    },
    primary_metric: primaryMetric,
    cells,
    min_sample: {
      per_cell_min_results: MIN_RESULTS_PER_CELL,
      rationale: `Each cell needs ≥${MIN_RESULTS_PER_CELL} results before its rate is read; ` +
        `winner declaration additionally requires ≥${MIN_CONVERSIONS_FOR_WIN} conversions on the leader.`,
    },
    win_criteria: {
      test: "two-proportion z-test @ 95% (challenger vs control)",
      significance_gate: `≥${MIN_CONVERSIONS_FOR_WIN} conversions on the candidate (fail-closed)`,
      decision_rule: "Promote the significant winner to its own scaled ad set via /scale; " +
        "pause clear losers; iterate new hooks from the winning concept back through /creative.",
    },
    next: "Hand cells to /launch (one ad set, all cells as ads, PAUSED). After ≥7 days and " +
      "minimum sample, run `--evaluate`.",
  };
}

/** Pure evaluator: plan + per-cell results → a winner decision with significance. */
export function evaluateResults({ plan, results }) {
  const byId = Object.fromEntries((results.cells || []).map((c) => [c.cell_id, c]));
  const controlId = plan.design?.control_cell;
  const control = byId[controlId];
  if (!control) {
    return { ok: false, error: `control cell '${controlId}' missing from results` };
  }
  const rate = (c) => (c.impressions > 0 ? (c.results || 0) / c.impressions : 0);
  const ranked = [];

  for (const cell of plan.cells) {
    const r = byId[cell.cell_id];
    if (!r) continue;
    const z = twoProportionZ(r.results || 0, r.impressions || 0, control.results || 0, control.impressions || 0);
    const sigGate = scaleSignificance(r.results || 0, MIN_CONVERSIONS_FOR_WIN);
    ranked.push({
      cell_id: cell.cell_id,
      hook_code: cell.hook_code,
      is_control: cell.is_control,
      impressions: r.impressions || 0,
      results: r.results || 0,
      rate: rate(r),
      rate_lower_bound_95: wilsonLowerBound(r.results || 0, r.impressions || 0),
      vs_control_significant: !cell.is_control && z.significant && rate(r) > rate(control),
      enough_conversions: sigGate.significant === true,
      z: z.z,
    });
  }

  ranked.sort((a, b) => b.rate_lower_bound_95 - a.rate_lower_bound_95);
  const candidate = ranked.find((c) => !c.is_control && c.vs_control_significant && c.enough_conversions);

  return {
    ok: true,
    mode: "evaluate",
    control_cell: controlId,
    decision: candidate
      ? { verdict: "WINNER", cell_id: candidate.cell_id, action: "Promote to its own ad set via /scale; iterate the winning concept in /creative." }
      : { verdict: "NO_SIGNIFICANT_WINNER", action: "Keep running to reach sample, or refresh hooks — do NOT scale on noise." },
    ranked,
  };
}

function renderPlanMd(plan, name) {
  let md = `## Hypothesis\n\n${plan.hypothesis}\n\n`;
  md += `## Design\n\n${plan.design.structure}\n\n`;
  md += `Primary metric: **${plan.primary_metric}** · Control: **${plan.design.control_cell}** · Cells: **${plan.design.cell_count}**\n\n`;
  md += `## Test Matrix\n\n| Cell | Hook | Format | Role | Headline |\n|---|---|---|---|---|\n`;
  for (const c of plan.cells) {
    md += `| ${c.cell_id} | ${c.hook_code} | ${c.format} | ${c.is_control ? "control" : "challenger"} | ${c.copy_headline || "—"} |\n`;
  }
  md += `\n## Win Criteria\n\n- Test: ${plan.win_criteria.test}\n- Gate: ${plan.win_criteria.significance_gate}\n- Rule: ${plan.win_criteria.decision_rule}\n`;
  md += `\n## Sampling\n\n${plan.min_sample.rationale}\n\n_${plan.next}_\n`;
  return md;
}

function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("usage: creative-test.js <slug> [--plan|--evaluate] [--metric=ctr|cvr]"); process.exit(2); }
  const evaluate = args.includes("--evaluate");
  const metric = (args.find((a) => a.startsWith("--metric=")) || "--metric=ctr").split("=")[1];

  const dir = resolve(ROOT, "clients", slug);
  const readJ = (f) => (existsSync(resolve(dir, f)) ? JSON.parse(readFileSync(resolve(dir, f), "utf8")) : null);

  if (evaluate) {
    const plan = readJ("creative_test_plan.json");
    const results = readJ("creative_test_results.json");
    if (!plan) { console.error("HALT: creative_test_plan.json missing — run --plan first."); process.exit(3); }
    if (!results) { console.error("HALT: creative_test_results.json missing — supply per-cell impressions/results."); process.exit(3); }
    const decision = evaluateResults({ plan, results });
    if (!decision.ok) { console.error(`HALT: ${decision.error}`); process.exit(4); }
    writeFileSync(resolve(dir, "creative_test_decision.json"), JSON.stringify(decision, null, 2));
    console.log(JSON.stringify({ slug, verdict: decision.decision.verdict, cell: decision.decision.cell_id || null }, null, 2));
    return;
  }

  const briefRaw = readJ("strategy_brief.json");
  const adCopy = readJ("ad_copy.json");
  if (!briefRaw) { console.error("HALT: strategy_brief.json missing — run /strategy-brief first."); process.exit(3); }
  const brief = briefSchema.normalize(briefRaw);
  const v = briefSchema.validate(brief);
  if (!v.ok) { console.error("HALT: strategy_brief invalid:\n  - " + v.errors.join("\n  - ")); process.exit(4); }

  const plan = buildTestPlan({ brief, adCopy, metric });
  writeFileSync(resolve(dir, "creative_test_plan.json"), JSON.stringify({ slug, generated_at: new Date().toISOString(), ...plan }, null, 2));

  const name = brief.client_name || slug;
  const mdPath = resolve(dir, "creative_test_plan.md");
  const md = renderPlanMd(plan, name);
  writeFileSync(mdPath, md);
  try {
    writeHtmlAndPdf(mdPath, md, {
      title: `${name} — Creative Test Plan`,
      subtitle: `${plan.design.cell_count} cells · ${plan.primary_metric}`,
      eyebrow: "smOS · Creative Testing",
    });
  } catch (e) {
    console.error(`[creative-test] HTML/PDF render skipped: ${e.message}`);
  }

  console.log(JSON.stringify({
    slug, mode: "plan", cells: plan.design.cell_count,
    control: plan.design.control_cell, metric: plan.primary_metric,
    next: "review creative_test_plan.json, launch cells PAUSED, then --evaluate after sample",
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
