#!/usr/bin/env node
/**
 * /image-gen (paid mode) companion script.
 *
 * Fills missing `image_url` fields on clients/<slug>/ad_copy.json angles (written
 * by /creative — see skills/creative/creative.js's `design_brief`) so /launch's
 * readAssetRef() (scripts/lib/launch_media.js) has a real creative to ship instead
 * of a link-only ad. Shares the Krea -> composite -> upload -> DAM pipeline with
 * the organic script (skills/image-gen/image-gen.js) via
 * scripts/lib/poster_pipeline.js.
 *
 * Scope (v1): generates ONE size per angle — the first entry in
 * `design_brief.sizes` (1080x1080 square). The other sizes (1080x1920, 1200x628)
 * are reported as skipped, never silently dropped — multi-size generation is a
 * follow-up, not something this script pretends to cover.
 *
 * Usage:
 *   node skills/image-gen/image-gen-ads.js <slug> [--angle <angle_id>] [--prompt "..."] [--model bfl/flux-1-dev] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { storageConfigured } from "../../scripts/lib/media_storage.js";
import { generateBrandedPoster } from "../../scripts/lib/poster_pipeline.js";
import { checkPosterInputs } from "../../scripts/lib/guards.js";
import { posterCopyFromAngle } from "../../scripts/lib/poster_spec.js";
import { adCopy as adCopySchema } from "../../schemas/index.js";
import * as P from "../../scripts/lib/paths.js";

loadEnv();

// Standard social ratios at a 1080px base edge, keyed by the label the rest of
// this script and callers use on the CLI / in `angle.images`.
const RATIOS = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

function ratioSlug(ratio) {
  return ratio.replace(":", "x");
}

/** Classify an existing WxH as one of RATIOS (nearest match) so a legacy
 *  single-size `image_url` can be backfilled into `angle.images` instead of
 *  regenerated. */
function nearestRatio(width, height) {
  const target = width / height;
  let best = null;
  let bestDelta = Infinity;
  for (const [label, dims] of Object.entries(RATIOS)) {
    const delta = Math.abs(dims.width / dims.height - target);
    if (delta < bestDelta) {
      best = label;
      bestDelta = delta;
    }
  }
  return best;
}

function loadBrand(slug) {
  const p = P.clientFile(slug, "brand_profile.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function parseSize(sizeStr) {
  // design_brief sizes may carry an annotation, e.g. "1080x1920 (Reels/Stories)" —
  // only parse the leading WxH, ignore the rest.
  const m = String(sizeStr || "").match(/^(\d+)\s*x\s*(\d+)/i);
  return { width: m ? Number(m[1]) : 1080, height: m ? Number(m[2]) : 1080 };
}

/** Pick ONE frame from a multi-shot design_brief.shot_list. Joining the whole
 *  list into one prompt makes Krea render a multi-panel collage/grid instead of
 *  a single hero image (observed on AWARE_LEGACY) — this generates only ONE
 *  static image per angle (see module doc), so it needs exactly one scene
 *  description. Prefers a "beauty"/hero-labeled shot, else the last shot (the
 *  shot lists here are typically ordered build-up -> payoff), else the first. */
function pickSingleShot(shotList) {
  if (!Array.isArray(shotList) || !shotList.length) return null;
  const beauty = shotList.find((s) => /beauty|hero/i.test(s));
  return beauty || shotList[shotList.length - 1];
}

function buildPrompt(angle, profile) {
  const biz = profile?.business?.product_description || profile?.name || "";
  // design_brief shape varies by producer version: canonical schema uses
  // visual_direction/hook_archetype; some existing ad_copy.json drafts instead
  // carry a shot_list + hook_family. Prefer whichever is actually present.
  const visualDirection = angle.design_brief?.visual_direction || pickSingleShot(angle.design_brief?.shot_list);
  const hookFamily = angle.hook_archetype || angle.hook_family;
  const parts = [
    visualDirection,
    hookFamily ? `Creative angle: ${hookFamily}` : null,
    biz,
    "professional social media ad photography, high detail, single photograph (not a collage, not a grid, not multiple panels), no text overlay, no logos, no watermarks",
  ].filter(Boolean);
  return parts.join(". ");
}

// v1 is single-image only (see module doc). A "Carousel N cards" design_brief
// means the shot_list entries are per-card UI descriptions ("Card 5: Service
// summary + Get a Quote"), not photographable scenes — feeding the last one to
// Krea as if it were a single hero shot produces a garbled multi-panel collage
// with fake text/logos (observed on LEADS_LUXCOS_TRANSFORM). Skip explicitly
// instead of faking a single-image approximation of a carousel concept.
function isCarouselFormat(angle) {
  return /carousel/i.test(angle.design_brief?.primary_format || "");
}

function isTargetable(angle) {
  return !angle.image_url && !isCarouselFormat(angle);
}

async function generateForAngle(angle, { slug, profile, brand, model, promptOverride, dryRun, copySource }) {
  const prompt = promptOverride || buildPrompt(angle, profile);
  const sizes = angle.design_brief?.sizes?.length ? angle.design_brief.sizes : ["1080x1080"];
  const [primarySize, ...skippedSizes] = sizes;
  const { width, height } = parseSize(primarySize);
  // Resolve the on-poster marketing copy (headline/subhead/benefits/CTA) from
  // the angle's own scored variants — no new manual input. `copySource` is the
  // schema-normalized twin of `angle` (flat headlines/descriptions/hooks[]),
  // since /creative's "lint shape" (per-hook-combo nesting) has no top-level
  // headlines/descriptions field for posterCopyFromAngle to read directly.
  const copy = posterCopyFromAngle(copySource || angle, { brandName: brand?.verbal?.name });

  if (dryRun) return { angle_id: angle.angle_id, prompt, size: primarySize, skipped_sizes: skippedSizes, copy, dry_run: true };

  const { image_url, local_path, brand_kit } = await generateBrandedPoster({
    slug,
    prompt,
    idTag: `${angle.angle_id}-ad`,
    brand,
    contact: profile?.contact,
    copy,
    model,
    width,
    height,
    tags: [angle.angle_id].filter(Boolean),
    altText: `${angle.name || angle.angle_id} ad creative`,
  });

  angle.image_url = image_url;
  angle.local_path = local_path;
  angle.ai_generated = true;
  angle.ai_disclosed = true;
  angle.brand_kit = brand_kit;

  return { angle_id: angle.angle_id, prompt, size: primarySize, skipped_sizes: skippedSizes, image_url, local_path };
}

/** Multi-ratio path (--ratios). Backfills `angle.images` from a pre-existing
 *  legacy `image_url` (classified by its recorded design_brief size) so a prior
 *  single-size run isn't regenerated, then fills only the ratios still missing. */
function missingRatiosForAngle(angle, requestedRatios) {
  if (!angle.images && angle.image_url) {
    const [primarySize] = angle.design_brief?.sizes?.length ? angle.design_brief.sizes : ["1080x1080"];
    const { width, height } = parseSize(primarySize);
    const label = nearestRatio(width, height);
    angle.images = { [label]: { image_url: angle.image_url, local_path: angle.local_path || null } };
  }
  const have = angle.images || {};
  return requestedRatios.filter((r) => !have[r]);
}

async function generateForAngleRatio(angle, ratio, { slug, profile, brand, model, promptOverride, dryRun, copySource }) {
  const prompt = promptOverride || buildPrompt(angle, profile);
  const { width, height } = RATIOS[ratio];
  const copy = posterCopyFromAngle(copySource || angle, { brandName: brand?.verbal?.name });

  if (dryRun) return { angle_id: angle.angle_id, ratio, prompt, width, height, copy, dry_run: true };

  const { image_url, local_path, brand_kit } = await generateBrandedPoster({
    slug,
    prompt,
    idTag: `${angle.angle_id}-ad-${ratioSlug(ratio)}`,
    brand,
    contact: profile?.contact,
    copy,
    model,
    width,
    height,
    tags: [angle.angle_id].filter(Boolean),
    altText: `${angle.name || angle.angle_id} ad creative (${ratio})`,
  });

  angle.images = angle.images || {};
  angle.images[ratio] = { image_url, local_path };
  // Keep the legacy flat fields pointing at a real creative for /launch's
  // readAssetRef() — prefer 1:1 as the canonical default when nothing is set yet.
  if (!angle.image_url || ratio === "1:1") {
    angle.image_url = image_url;
    angle.local_path = local_path;
  }
  angle.ai_generated = true;
  angle.ai_disclosed = true;
  angle.brand_kit = brand_kit;

  return { angle_id: angle.angle_id, ratio, prompt, width, height, image_url, local_path };
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug || slug.startsWith("--")) {
    console.error("Usage: node skills/image-gen/image-gen-ads.js <slug> [--angle <angle_id>] [--ratios 1:1,9:16,4:5] [--prompt \"...\"] [--model bfl/flux-1-dev] [--dry-run]");
    process.exit(1);
  }
  const angleIdx = args.indexOf("--angle");
  const angleId = angleIdx >= 0 ? args[angleIdx + 1] : null;
  const promptIdx = args.indexOf("--prompt");
  const promptOverride = promptIdx >= 0 ? args[promptIdx + 1] : null;
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const dryRun = args.includes("--dry-run");
  const ratiosIdx = args.indexOf("--ratios");
  const ratios = ratiosIdx >= 0 ? args[ratiosIdx + 1].split(",").map((r) => r.trim()) : null;
  if (ratios) {
    const unknown = ratios.filter((r) => !RATIOS[r]);
    if (unknown.length) {
      console.error(`Unknown ratio(s) ${unknown.join(", ")} — supported: ${Object.keys(RATIOS).join(", ")}`);
      process.exit(1);
    }
  }

  const profilePath = P.clientFile(slug, "client_profile.json");
  const adCopyPath = P.clientFile(slug, "ad_copy.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  if (!existsSync(adCopyPath)) {
    console.error(`No ad_copy.json for ${slug}. Run /creative first.`);
    process.exit(3);
  }

  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const brand = loadBrand(slug);

  if (!dryRun) {
    if (!process.env.KREA_API_KEY) {
      console.error("KREA_API_KEY is required (krea.ai/settings/api-tokens). Set it and re-run.");
      process.exit(4);
    }
    if (!storageConfigured()) {
      console.error("SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_SECRET_KEY) are required to host generated images.");
      process.exit(4);
    }
    const posterCheck = checkPosterInputs(brand, profile);
    if (!posterCheck.ok) {
      console.error(posterCheck.message);
      process.exit(4);
    }
  }

  const adCopy = JSON.parse(readFileSync(adCopyPath, "utf8"));
  const angles = adCopy.angles || [];
  // Schema-normalized twin, keyed by angle_id, for copy resolution only — the
  // raw `angles` objects (with /creative's original per-hook-combo nesting)
  // are still what gets mutated with image_url and written back to disk.
  const normByAngleId = new Map(adCopySchema.normalize(adCopy).angles.map((a) => [a.angle_id, a]));

  let targets;
  if (angleId) {
    const found = angles.find((a) => a.angle_id === angleId);
    if (!found) {
      console.error(`No ad_copy angle with angle_id ${angleId}`);
      process.exit(5);
    }
    if (isCarouselFormat(found) && !promptOverride) {
      console.error(`${angleId} is a carousel design_brief (${found.design_brief.primary_format}) — its shot_list entries are per-card UI descriptions, not single photographable scenes. Pass --prompt with an explicit single-image description, or generate the individual card images through a carousel-aware path once one exists.`);
      process.exit(6);
    }
    targets = [found];
  } else if (ratios) {
    targets = angles.filter((a) => !isCarouselFormat(a) && missingRatiosForAngle(a, ratios).length > 0);
  } else {
    targets = angles.filter(isTargetable);
  }

  const skippedCarousel = angles.filter((a) => isCarouselFormat(a) && (!angleId || a.angle_id !== angleId) && (ratios ? missingRatiosForAngle(a, ratios).length > 0 : !a.image_url));

  const generated = [];
  const errors = [];
  if (ratios) {
    for (const angle of targets) {
      for (const ratio of missingRatiosForAngle(angle, ratios)) {
        try {
          generated.push(await generateForAngleRatio(angle, ratio, { slug, profile, brand, model, promptOverride: angleId ? promptOverride : null, dryRun, copySource: normByAngleId.get(angle.angle_id) }));
        } catch (e) {
          errors.push({ angle_id: angle.angle_id, ratio, error: e.message });
          angle.error = e.message;
        }
      }
    }
  } else {
    for (const angle of targets) {
      try {
        generated.push(await generateForAngle(angle, { slug, profile, brand, model, promptOverride: angleId ? promptOverride : null, dryRun, copySource: normByAngleId.get(angle.angle_id) }));
      } catch (e) {
        errors.push({ angle_id: angle.angle_id, error: e.message });
        angle.error = e.message;
      }
    }
  }

  if (!dryRun) writeFileSync(adCopyPath, JSON.stringify(adCopy, null, 2));

  console.log(JSON.stringify({
    slug,
    mode: dryRun ? "DRY_RUN" : "LIVE",
    skipped_carousel_format: skippedCarousel.map((a) => ({ angle_id: a.angle_id, format: a.design_brief.primary_format, reason: "carousel design_brief — single-image generation not supported by /image-gen v1, needs an explicit --prompt or a carousel-aware path" })),
    generated,
    errors,
  }, null, 2));
}

main().catch((e) => {
  console.error("[image-gen-ads] FATAL:", e.message);
  process.exit(1);
});
