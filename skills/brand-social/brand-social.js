#!/usr/bin/env node
/**
 * /brand-social companion — persists the social layer (profile/cover/highlights/
 * templates/bios), optionally RENDERS those assets to real files, and marks the
 * brand profile complete when it validates.
 *
 * Usage:
 *   node skills/brand-social/brand-social.js <slug> --in social.json
 *   node skills/brand-social/brand-social.js <slug> --in social.json --render
 *   node skills/brand-social/brand-social.js <slug> --render --highlights "About,Services,Reviews"
 *
 * --render generates the applied social surface (profile picture, FB cover, IG
 * highlight covers, post + story templates) from the APPROVED brand kit, so the
 * urls in brand_profile.json point at files that actually exist. Bios are still
 * written by the skill (copy, not bytes) via --in.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { loadBrand, saveBrand, brandPath, draftBrand } from "../../scripts/lib/brand.js";
import { renderSocialAssets, DEFAULT_HIGHLIGHTS } from "../../scripts/lib/brand_render.js";
import * as brandProfile from "../../schemas/brand_profile.js";

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: brand-social.js <slug> [--in social.json] [--render] [--highlights A,B,C]"); process.exit(1); }

  const b = loadBrand(slug);
  if (!b.visual.logo_approved_at) {
    console.error("Logo not approved. Run /brand-visual and --approve-logo before social assets.");
    process.exit(3);
  }

  const wantRender = args.includes("--render");
  const inIdx = args.indexOf("--in");
  if (inIdx < 0 && !wantRender) { console.error("Provide --in social.json and/or --render"); process.exit(1); }

  let social = {};
  if (inIdx >= 0) {
    const inPath = args[inIdx + 1];
    if (!inPath || !existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(2); }
    social = JSON.parse(readFileSync(inPath, "utf8"));
  }

  let rendered = null;
  if (wantRender) {
    const hIdx = args.indexOf("--highlights");
    const highlights = hIdx >= 0 && args[hIdx + 1]
      ? args[hIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
      : (Array.isArray(social.ig_highlight_covers) && social.ig_highlight_covers.length
        ? social.ig_highlight_covers.map((c) => c.label || c.name || String(c))
        : DEFAULT_HIGHLIGHTS);
    const r = await renderSocialAssets(slug, draftBrand(slug, { social }), { highlights });
    rendered = r;
    // Rendered files win over any recorded url — they are the ones that exist.
    social = { ...social, ...r.social };
  }

  const out = saveBrand(slug, { social }, { stage: "social" });

  // Mark complete once the whole artifact validates.
  const full = brandProfile.validate(out, { stage: "complete" });
  if (full.ok) {
    out.status = "complete";
    writeFileSync(brandPath(slug), JSON.stringify(out, null, 2));
  }

  console.log(JSON.stringify({
    slug, layer: "social", status: out.status,
    profile_picture: out.social.profile_picture_url,
    ig_bio: out.social.bios.instagram,
    rendered_files: rendered ? rendered.files : [],
    complete: full.ok,
    next: full.ok ? "Brand is fully built. Run /setup-accounts to create the real Page/IG/ad account and upload these assets." : `Still missing: ${full.errors.join("; ")}`,
  }, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
