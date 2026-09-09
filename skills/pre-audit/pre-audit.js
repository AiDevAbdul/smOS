#!/usr/bin/env node
/**
 * /pre-audit companion — the Node entry that orchestrates the full deterministic
 * pre-audit pipeline into one command (Phase 5 plumbing).
 *
 * The pipeline has four scripted stages under scripts/meta-ad-library/:
 *   1. collect.py   — 4 public passes (FB, IG, website, Ad Library) → data/raw/*.json
 *   2. normalize.py — raw → data/signals.csv  (the long-format source of truth)
 *   3. build.py     — signals.csv → page_audit / competitor_summary / synthesis JSON
 *                     (deterministic 0–100 scoring; optional data/narrative.json overlay)
 *   4. pre_audit_report.py + render_pdf.py — the standardized HTML + PDF deliverable
 *
 * This wrapper runs 2→4 by default (data already collected), 1→4 with --collect,
 * or 3→4 with --rebuild. It then advances the CRM deal to `audited` and
 * best-effort persists a prospect_audits row.
 *
 * Usage:
 *   # render from existing signals.csv / JSONs
 *   node skills/pre-audit/pre-audit.js <slug> --business "Acme Co" [--niche-html path] [--no-crm]
 *   # re-derive JSONs from an edited signals.csv, then render
 *   node skills/pre-audit/pre-audit.js <slug> --rebuild --business "Acme Co"
 *   # full run: scrape → csv → json → render
 *   node skills/pre-audit/pre-audit.js <slug> --collect --fb <url> [--ig <h>] [--site <url>] \
 *        [--competitor <url> ...] [--country US] [--days 90] --business "Acme Co"
 *
 * Benchmark tailoring (applies on --collect or --rebuild):
 *   [--vertical auto_repair] [--geo GB]
 *   --vertical picks the benchmark row (see scripts/meta-ad-library/benchmarks.json
 *   `verticals` + `vertical_aliases`); --geo cost-indexes CPM and defaults to
 *   --country. Omit them and every figure is labeled cross-vertical.
 */
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { getDeal, upsertDeal } from "../../scripts/lib/crm-store.js";
import { deal as dealSchema } from "../../schemas/index.js";
import { insert, supabaseConfigured } from "../../scripts/lib/supabase.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const nowIso = () => new Date().toISOString();
const REQUIRED_INPUTS = ["page_audit.json", "competitor_summary.json", "synthesis.json"];
const MLIB = resolve(ROOT, "scripts", "meta-ad-library");

/** Run a python stage; abort the whole wrapper with `code` on failure. */
function py(script, argv, { code, label }) {
  const r = spawnSync("python3", [resolve(MLIB, script), ...argv], { encoding: "utf8", stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[pre-audit] ${label} failed (${script} exit ${r.status}).`);
    process.exit(code);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error('Usage: pre-audit.js <slug> [--collect|--rebuild] --business "Name" [flags]'); process.exit(1); }
  const has = (n) => args.includes(`--${n}`);
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined; };
  const multi = (n) => args.reduce((acc, a, i) => (a === `--${n}` && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
  const business = flag("business") || slug;

  // ── Stage 1: COLLECT (optional) ──
  if (has("collect")) {
    const cArgs = [slug];
    if (flag("fb")) cArgs.push("--fb", String(flag("fb")));
    if (flag("ig")) cArgs.push("--ig", String(flag("ig")));
    if (flag("site")) cArgs.push("--site", String(flag("site")));
    for (const c of multi("competitor")) cArgs.push("--competitor", c);
    if (flag("country")) cArgs.push("--country", String(flag("country")));
    if (flag("days")) cArgs.push("--days", String(flag("days")));
    py("collect.py", cArgs, { code: 4, label: "collect" });
  }

  // ── Stage 2+3: NORMALIZE + BUILD (on --collect or --rebuild) ──
  if (has("collect") || has("rebuild")) {
    py("normalize.py", [slug], { code: 5, label: "normalize" });
    // --vertical/--geo tailor the benchmark table. Omitting --vertical is safe:
    // the report then labels every figure cross-vertical rather than implying
    // it is this category's number. --geo defaults to the collect manifest's
    // country inside build.py.
    const bArgs = [slug];
    if (flag("vertical")) bArgs.push("--vertical", String(flag("vertical")));
    if (flag("geo") || flag("country")) bArgs.push("--geo", String(flag("geo") || flag("country")));
    py("build.py", bArgs, { code: 6, label: "build" });
  }

  // ── Verify the render inputs exist (data/ is canonical) ──
  const missing = REQUIRED_INPUTS.filter((f) => !existsSync(P.prospectData(slug, f)));
  if (missing.length) {
    console.error(`Missing pre-audit inputs in prospects/${slug}/data/: ${missing.join(", ")}.\n` +
      `Run with --collect (scrape) or --rebuild (from signals.csv), or produce them per skills/pre-audit/SKILL.md.`);
    process.exit(2);
  }

  // ── Stage 4a: render standardized HTML ──
  const htmlOut = P.prospectDeliverable(slug, "pre-audit", "html");
  mkdirSync(dirname(htmlOut), { recursive: true });
  const pyArgs = [
    resolve(MLIB, "pre_audit_report.py"),
    "--page-audit", P.prospectData(slug, "page_audit.json"),
    "--competitors", P.prospectData(slug, "competitor_summary.json"),
    "--synthesis", P.prospectData(slug, "synthesis.json"),
    "--business", String(business),
    "--slug", slug,
    "--output", htmlOut,
  ];
  if (flag("niche-html")) pyArgs.push("--niche-html", String(flag("niche-html")));
  const r1 = spawnSync("python3", pyArgs, { encoding: "utf8" });
  if (r1.status !== 0) {
    console.error(`pre_audit_report.py failed:\n${(r1.stderr || r1.stdout || "").slice(0, 500)}`);
    process.exit(3);
  }

  // ── Stage 4b: PDF via the shared renderer ──
  const pdfOut = P.prospectDeliverable(slug, "pre-audit", "pdf");
  const r2 = spawnSync("python3", [resolve(ROOT, "scripts", "render_pdf.py"), htmlOut, "--output", pdfOut], { encoding: "utf8" });
  const pdfOk = r2.status === 0;
  if (!pdfOk) console.error(`[pre-audit] PDF render skipped: ${(r2.stderr || "").split("\n")[0]}`);

  const relHtml = `prospects/${slug}/deliverables/pre-audit/pre-audit.html`;

  // ── CRM: create/advance the deal to `audited` ──
  let crm = { skipped: true };
  if (!has("no-crm")) {
    const existing = getDeal(slug);
    const current = existing?.stage || "lead";
    const stage = dealSchema.isValidTransition(current, "audited") || current === "audited" ? "audited" : current;
    try {
      const saved = await upsertDeal(slug, {
        company_name: business, source: existing?.source || "pre-audit", stage,
        links: { pre_audit: relHtml },
        activities: [...(existing?.activities || []), { at: nowIso(), type: "note", note: "pre-audit completed" }],
      });
      crm = { stage: saved.stage, pre_audit_link: saved.links.pre_audit };
    } catch (e) { crm = { error: e.message }; }
  }

  // ── Best-effort prospect_audits row (live schema column names) ──
  let persisted = { skipped: true };
  if (supabaseConfigured()) {
    let synthesis = {};
    try { synthesis = JSON.parse(readFileSync(P.prospectData(slug, "synthesis.json"), "utf8")); } catch { /* keep defaults */ }
    const row = {
      prospect_slug: slug, business_name: business, generated_at: nowIso(),
      health_score: typeof synthesis.score === "number" ? synthesis.score : null,
      report_path: relHtml, summary: synthesis.headline || null, converted: false,
    };
    try { await insert("prospect_audits", [row]); persisted = { ok: true }; }
    catch (e) { persisted = { error: e.message }; }
  }

  console.log(JSON.stringify({
    slug, business, html: htmlOut, pdf: pdfOk ? pdfOut : "(PDF skipped — install playwright)",
    crm, persisted,
    next: "Send the report. To pursue: /proposal " + slug + " (deal is now 'audited').",
  }, null, 2));
}

main().catch((e) => { console.error("[pre-audit] FATAL:", e.message); process.exit(1); });
