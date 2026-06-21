#!/usr/bin/env node
/**
 * /pre-audit companion — the Node entry that orchestrates the existing Python
 * pre-audit pipeline into one command (Phase 5 plumbing).
 *
 * The agent gathers the public-data inputs per SKILL.md (page_audit.json,
 * competitor_summary.json, synthesis.json in prospects/<slug>/). This wrapper then:
 *   1. renders the standardized HTML via scripts/meta-ad-library/pre_audit_report.py
 *   2. converts to PDF via scripts/render_pdf.py
 *   3. creates/advances the CRM deal to `audited` and links the artifact
 *   4. best-effort persists a prospect_audits row
 *
 * Usage:
 *   node skills/pre-audit/pre-audit.js <slug> --business "Acme Co" [--niche-html path] [--no-crm]
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { getDeal, upsertDeal } from "../../scripts/lib/crm-store.js";
import { deal as dealSchema } from "../../schemas/index.js";
import { insert, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const nowIso = () => new Date().toISOString();
const REQUIRED_INPUTS = ["page_audit.json", "competitor_summary.json", "synthesis.json"];

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: pre-audit.js <slug> --business \"Name\" [--niche-html path] [--no-crm]"); process.exit(1); }
  const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined; };
  const business = flag("business") || slug;

  const proDir = resolve(ROOT, "prospects", slug);
  const missing = REQUIRED_INPUTS.filter((f) => !existsSync(resolve(proDir, f)));
  if (missing.length) {
    console.error(`Missing pre-audit inputs in prospects/${slug}/: ${missing.join(", ")}.\n` +
      `Gather the public-data inputs first (see skills/pre-audit/SKILL.md) — the agent produces page_audit.json, competitor_summary.json, synthesis.json.`);
    process.exit(2);
  }

  // 1. Render the standardized HTML via the Python template.
  const htmlOut = resolve(proDir, "pre_audit.html");
  const pyArgs = [
    resolve(ROOT, "scripts", "meta-ad-library", "pre_audit_report.py"),
    "--page-audit", resolve(proDir, "page_audit.json"),
    "--competitors", resolve(proDir, "competitor_summary.json"),
    "--synthesis", resolve(proDir, "synthesis.json"),
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

  // 2. PDF via the shared renderer.
  const pdfOut = resolve(proDir, "pre_audit.pdf");
  const r2 = spawnSync("python3", [resolve(ROOT, "scripts", "render_pdf.py"), htmlOut, "--output", pdfOut], { encoding: "utf8" });
  const pdfOk = r2.status === 0;
  if (!pdfOk) console.error(`[pre-audit] PDF render skipped: ${(r2.stderr || "").split("\n")[0]}`);

  // 3. Wire into the CRM pipeline — create/advance the deal to `audited`.
  let crm = { skipped: true };
  if (!args.includes("--no-crm")) {
    const existing = getDeal(slug);
    const current = existing?.stage || "lead";
    const stage = dealSchema.isValidTransition(current, "audited") || current === "audited" ? "audited" : current;
    try {
      const saved = await upsertDeal(slug, {
        company_name: business, source: existing?.source || "pre-audit", stage,
        links: { pre_audit: `prospects/${slug}/pre_audit.html` },
        activities: [...(existing?.activities || []), { at: nowIso(), type: "note", note: "pre-audit completed" }],
      });
      crm = { stage: saved.stage, pre_audit_link: saved.links.pre_audit };
    } catch (e) { crm = { error: e.message }; }
  }

  // 4. Best-effort prospect_audits row.
  let persisted = { skipped: true };
  if (supabaseConfigured()) {
    try { await insert("prospect_audits", [{ slug, business_name: business, generated_at: nowIso(), converted: false }]); persisted = { ok: true }; }
    catch (e) { persisted = { error: e.message }; }
  }

  console.log(JSON.stringify({
    slug, business, html: htmlOut, pdf: pdfOk ? pdfOut : "(PDF skipped — install playwright)",
    crm, persisted,
    next: "Send the report. To pursue: /proposal " + slug + " (deal is now 'audited').",
  }, null, 2));
}

main().catch((e) => { console.error("[pre-audit] FATAL:", e.message); process.exit(1); });
