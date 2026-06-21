#!/usr/bin/env node
/**
 * /proposal companion (Phase 5) — generates a branded client proposal (HTML+PDF)
 * from a service catalog + the prospect's /pre-audit findings, then advances the
 * CRM deal to `proposed` and links the artifact.
 *
 * Source of truth for pricing: config/services.json (catalog). The recommended
 * package is chosen by --package, else inferred from the deal's retainer, else
 * "growth". Per-deal retainer overrides the catalog price when set.
 *
 * Usage:
 *   node skills/proposal/proposal.js <slug> [--package growth] [--no-crm]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";
import { getDeal, upsertDeal } from "../../scripts/lib/crm-store.js";
import { deal as dealSchema } from "../../schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

export function loadCatalog() {
  const p = resolve(ROOT, "config", "services.json");
  if (!existsSync(p)) throw new Error("config/services.json not found — scaffold the service catalog first.");
  const cat = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(cat.packages) || !cat.packages.length) throw new Error("services.json has no packages");
  return cat;
}

/** Pick the recommended package: explicit > closest-to-retainer > default 'growth'/first. */
export function pickPackage(catalog, { packageId = null, retainer = 0 } = {}) {
  const pkgs = catalog.packages;
  if (packageId) {
    const hit = pkgs.find((p) => p.id === packageId);
    if (!hit) throw new Error(`No package "${packageId}". Available: ${pkgs.map((p) => p.id).join(", ")}`);
    return hit;
  }
  if (retainer > 0) {
    return pkgs.reduce((best, p) =>
      Math.abs(p.monthly_retainer - retainer) < Math.abs(best.monthly_retainer - retainer) ? p : best, pkgs[0]);
  }
  return pkgs.find((p) => p.id === "growth") || pkgs[0];
}

function loadFindings(slug) {
  // Pull the prospect's situation from /pre-audit output if it ran.
  for (const f of ["synthesis.json", "page_audit.json"]) {
    const p = resolve(ROOT, "prospects", slug, f);
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* ignore */ } }
  }
  return null;
}

function asList(arr) { return (arr || []).map((x) => `- ${typeof x === "string" ? x : (x.text || x.title || JSON.stringify(x))}`).join("\n"); }

export function buildProposalMarkdown({ slug, company, catalog, pkg, retainer, findings }) {
  const a = catalog.agency, t = catalog.terms, cur = pkg.currency;
  const price = retainer > 0 ? retainer : pkg.monthly_retainer;
  let md = `# Proposal — ${company}\n\nPrepared by **${a.name}** · ${a.email}\n\n_${a.tagline}_\n\n---\n\n`;

  md += `## The opportunity\n\n`;
  if (findings) {
    const gaps = findings.gaps || findings.opportunities || findings.weaknesses;
    const wins = findings.wins || findings.strengths;
    if (wins) md += `**What's working**\n${asList(wins)}\n\n`;
    if (gaps) md += `**Where we see upside**\n${asList(gaps)}\n\n`;
    if (!wins && !gaps) md += `Based on our audit of ${company}'s current social presence, there's clear room to improve paid efficiency and organic consistency.\n\n`;
  } else {
    md += `Based on our review of ${company}'s social presence, there's clear room to improve paid performance and bring organic and paid under one system.\n\n`;
  }

  md += `## Recommended package — ${pkg.name}\n\n`;
  md += `_${pkg.best_for}_\n\n`;
  md += `**${cur} ${price.toLocaleString()}/month** · one-time setup ${cur} ${pkg.setup_fee.toLocaleString()}\n\n`;
  md += `**Included**\n${asList(pkg.includes)}\n\n`;

  md += `## How we work\n\n`;
  md += `Every account runs on smOS — our operating system for performance social. Campaigns launch PAUSED and only go live with your sign-off; every optimization is logged with its reasoning; and you get HTML + PDF reporting on a fixed cadence.\n\n`;

  md += `## Terms\n\n`;
  md += `- **Term:** ${t.contract_length_months}-month initial commitment\n`;
  md += `- **Ad spend:** ${t.ad_spend}\n`;
  md += `- **Payment:** ${t.payment}\n`;
  md += `- **Cancellation:** ${t.cancellation}\n\n`;

  md += `## Next step\n\n`;
  md += `Reply to approve and we'll send the agreement (e-sign) and onboarding. We can have your accounts set up and first campaigns built within a week.\n`;
  return md;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: proposal.js <slug> [--package growth] [--no-crm]"); process.exit(1); }
  const pkgIdx = args.indexOf("--package");
  const packageId = pkgIdx >= 0 ? args[pkgIdx + 1] : null;

  const catalog = loadCatalog();
  const dealRec = getDeal(slug);
  const company = dealRec?.company_name || slug;
  const retainer = dealRec?.deal?.monthly_retainer || 0;
  const pkg = pickPackage(catalog, { packageId, retainer });
  const findings = loadFindings(slug);

  const md = buildProposalMarkdown({ slug, company, catalog, pkg, retainer, findings });
  const outDir = resolve(ROOT, "proposals", slug);
  mkdirSync(outDir, { recursive: true });
  const mdPath = resolve(outDir, "proposal.md");
  writeFileSync(mdPath, md);
  const { htmlPath, pdfPath, pdfOk } = writeHtmlAndPdf(mdPath, md, { title: `Proposal — ${company}` });

  let crm = { skipped: true };
  if (!args.includes("--no-crm")) {
    const linkPath = pdfOk ? `proposals/${slug}/proposal.pdf` : `proposals/${slug}/proposal.html`;
    // Advance to `proposed` if the state machine allows from the current stage.
    const current = dealRec?.stage || "lead";
    const stage = dealSchema.isValidTransition(current, "proposed") || current === "proposed" ? "proposed" : current;
    try {
      const saved = await upsertDeal(slug, {
        company_name: company,
        stage,
        links: { proposal: linkPath },
        deal: { monthly_retainer: retainer > 0 ? retainer : pkg.monthly_retainer, currency: pkg.currency },
        activities: [...(dealRec?.activities || []), { at: new Date().toISOString(), type: "proposal", note: `proposed ${pkg.name} (${pkg.currency} ${pkg.monthly_retainer}/mo)` }],
      });
      crm = { stage: saved.stage, proposal_link: saved.links.proposal, stage_changed: stage !== current };
    } catch (e) { crm = { error: e.message }; }
  }

  console.log(JSON.stringify({
    slug, company, package: pkg.id,
    monthly: `${pkg.currency} ${retainer > 0 ? retainer : pkg.monthly_retainer}`,
    html: htmlPath, pdf: pdfOk ? pdfPath : "(PDF skipped — install playwright)",
    used_pre_audit: !!findings, crm,
    next: "Send to the prospect. On signature: /contract, then /intake + /billing.",
  }, null, 2));
}

// Only run when invoked directly (so tests can import the helpers).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[proposal] FATAL:", e.message); process.exit(1); });
}
