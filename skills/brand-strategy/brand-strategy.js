#!/usr/bin/env node
/**
 * /brand-strategy companion — persists the strategy layer and (only on explicit
 * human approval) stamps the positioning gate.
 *
 * Usage:
 *   node skills/brand-strategy/brand-strategy.js <slug> --in strategy.json
 *   node skills/brand-strategy/brand-strategy.js <slug> --approve-positioning
 */
import { readFileSync, existsSync } from "node:fs";
import { loadBrand, saveBrand, stampGate } from "../../scripts/lib/brand.js";

function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: brand-strategy.js <slug> [--in strategy.json] [--approve-positioning]"); process.exit(1); }

  if (args.includes("--approve-positioning")) {
    const b = loadBrand(slug);
    if (!b.strategy.positioning_statement) {
      console.error("Refusing to approve: strategy.positioning_statement is empty. Write the strategy first.");
      process.exit(3);
    }
    const out = stampGate(slug, "positioning");
    console.log(JSON.stringify({ slug, gate: "positioning", approved_at: out.strategy.positioning_approved_at, status: out.status, next: "/brand-name" }, null, 2));
    return;
  }

  const inIdx = args.indexOf("--in");
  if (inIdx < 0) { console.error("Provide --in strategy.json or --approve-positioning"); process.exit(1); }
  const inPath = args[inIdx + 1];
  if (!existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(2); }
  const strategy = JSON.parse(readFileSync(inPath, "utf8"));

  const out = saveBrand(slug, { strategy }, { stage: "strategy" });
  console.log(JSON.stringify({
    slug, layer: "strategy", status: out.status,
    positioning: out.strategy.positioning_statement,
    approved: !!out.strategy.positioning_approved_at,
    next: "Present the positioning statement to the client. On approval: --approve-positioning",
  }, null, 2));
}

main();
