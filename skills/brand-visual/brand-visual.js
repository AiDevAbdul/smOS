#!/usr/bin/env node
/**
 * /brand-visual companion — persists the visual layer, RENDERS the logo system
 * to real files, and (only on explicit human approval) stamps the logo gate.
 *
 * Usage:
 *   node skills/brand-visual/brand-visual.js <slug> --in visual.json
 *   node skills/brand-visual/brand-visual.js <slug> --in visual.json --render
 *   node skills/brand-visual/brand-visual.js <slug> --render      # re-render from stored palette
 *   node skills/brand-visual/brand-visual.js <slug> --approve-logo
 *
 * Two guards run before anything is written:
 *   - GATE 2 (name approved) — fail-closed, --in is not a bypass.
 *   - WCAG contrast (E2) — a primary that can't reach 4.5:1 on any of its own
 *     neutrals is unreadable everywhere downstream, so it is blocked here rather
 *     than discovered in a client's ad. Override: SMOS_ALLOW_LOW_CONTRAST=1.
 */
import { readFileSync, existsSync } from "node:fs";
import { loadBrand, saveBrand, stampGate, draftBrand } from "../../scripts/lib/brand.js";
import { checkBrandContrast } from "../../scripts/lib/guards.js";
import { renderLogoSystem } from "../../scripts/lib/brand_render.js";

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: brand-visual.js <slug> [--in visual.json] [--render] [--approve-logo]"); process.exit(1); }

  const b = loadBrand(slug);
  // Fail-closed human gate: the name MUST be approved before any visual layer is
  // persisted or the logo gate is stamped. `--in` only supplies the input file —
  // it is NOT a reason to bypass this gate.
  if (!b.verbal.name_approved_at) {
    console.error("Name not approved. Run /brand-name and --approve-name before visual identity.");
    process.exit(3);
  }

  if (args.includes("--approve-logo")) {
    if (!b.visual.logo.primary_url) { console.error("No logo set (visual.logo.primary_url empty). Persist --in visual.json (add --render to generate one) first."); process.exit(3); }
    const out = stampGate(slug, "logo");
    console.log(JSON.stringify({ slug, gate: "logo", approved_at: out.visual.logo_approved_at, status: out.status, next: "/brand-book then /brand-social" }, null, 2));
    return;
  }

  const wantRender = args.includes("--render");
  const inIdx = args.indexOf("--in");
  if (inIdx < 0 && !wantRender) { console.error("Provide --in visual.json, --render, or --approve-logo"); process.exit(1); }

  let visual = {};
  if (inIdx >= 0) {
    const inPath = args[inIdx + 1];
    if (!inPath || !existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(2); }
    visual = JSON.parse(readFileSync(inPath, "utf8"));
  }

  // Contrast is checked on the MERGED palette (stored + incoming), before write.
  const draft = draftBrand(slug, { visual });
  const contrast = checkBrandContrast(draft);
  if (!contrast.ok) { console.error(contrast.reason); process.exit(4); }
  if (contrast.overridden) console.error(contrast.reason);

  let rendered = null;
  if (wantRender) {
    if (!draft.visual.colors.primary) { console.error("--render needs visual.colors.primary (and typography) — supply them with --in first."); process.exit(2); }
    const r = await renderLogoSystem(slug, draft);
    rendered = r;
    visual = { ...visual, logo: { ...(visual.logo || {}), ...r.logo } };
  }

  const out = saveBrand(slug, { visual }, { stage: "visual" });
  console.log(JSON.stringify({
    slug, layer: "visual", status: out.status,
    logo: out.visual.logo.primary_url, primary_color: out.visual.colors.primary,
    ai_generated: out.visual.ai_generated,
    contrast: { ok: contrast.ok, overridden: !!contrast.overridden, pairs: contrast.report?.pairs?.length ?? 0, warnings: contrast.report?.warnings ?? [] },
    rendered_files: rendered ? rendered.files : [],
    next: "Present logo options to the client. On approval: --approve-logo",
  }, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
