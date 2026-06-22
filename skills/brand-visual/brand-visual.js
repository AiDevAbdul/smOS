#!/usr/bin/env node
/**
 * /brand-visual companion — persists the visual layer and (only on explicit human
 * approval) stamps the logo gate.
 *
 * Usage:
 *   node skills/brand-visual/brand-visual.js <slug> --in visual.json
 *   node skills/brand-visual/brand-visual.js <slug> --approve-logo
 */
import { readFileSync, existsSync } from "node:fs";
import { loadBrand, saveBrand, stampGate } from "../../scripts/lib/brand.js";

function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: brand-visual.js <slug> [--in visual.json] [--approve-logo]"); process.exit(1); }

  const b = loadBrand(slug);
  // Fail-closed human gate: the name MUST be approved before any visual layer is
  // persisted or the logo gate is stamped. `--in` only supplies the input file —
  // it is NOT a reason to bypass this gate.
  if (!b.verbal.name_approved_at) {
    console.error("Name not approved. Run /brand-name and --approve-name before visual identity.");
    process.exit(3);
  }

  if (args.includes("--approve-logo")) {
    if (!b.visual.logo.primary_url) { console.error("No logo set (visual.logo.primary_url empty). Persist --in visual.json first."); process.exit(3); }
    const out = stampGate(slug, "logo");
    console.log(JSON.stringify({ slug, gate: "logo", approved_at: out.visual.logo_approved_at, status: out.status, next: "/brand-book then /brand-social" }, null, 2));
    return;
  }

  const inIdx = args.indexOf("--in");
  if (inIdx < 0) { console.error("Provide --in visual.json or --approve-logo"); process.exit(1); }
  const inPath = args[inIdx + 1];
  if (!existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(2); }
  const visual = JSON.parse(readFileSync(inPath, "utf8"));

  const out = saveBrand(slug, { visual }, { stage: "visual" });
  console.log(JSON.stringify({
    slug, layer: "visual", status: out.status,
    logo: out.visual.logo.primary_url, primary_color: out.visual.colors.primary,
    ai_generated: out.visual.ai_generated,
    next: "Present logo options to the client. On approval: --approve-logo",
  }, null, 2));
}

main();
