#!/usr/bin/env node
/**
 * /brand-social companion — persists the social layer (profile/cover/highlights/
 * templates/bios) and marks the brand profile complete when it validates.
 *
 * Usage: node skills/brand-social/brand-social.js <slug> --in social.json
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { loadBrand, saveBrand, brandPath } from "../../scripts/lib/brand.js";
import * as brandProfile from "../../schemas/brand_profile.js";

function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: brand-social.js <slug> --in social.json"); process.exit(1); }

  const b = loadBrand(slug);
  if (!b.visual.logo_approved_at) {
    console.error("Logo not approved. Run /brand-visual and --approve-logo before social assets.");
    process.exit(3);
  }

  const inIdx = args.indexOf("--in");
  if (inIdx < 0) { console.error("Provide --in social.json"); process.exit(1); }
  const inPath = args[inIdx + 1];
  if (!existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(2); }
  const social = JSON.parse(readFileSync(inPath, "utf8"));

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
    complete: full.ok,
    next: full.ok ? "Brand is fully built. Run /setup-accounts to create the real Page/IG/ad account and upload these assets." : `Still missing: ${full.errors.join("; ")}`,
  }, null, 2));
}

main();
