#!/usr/bin/env node
/**
 * /image-gen companion script.
 *
 * Fills missing `image_url` fields on clients/<slug>/content_calendar.json items
 * (format: "image") by generating creative via the Krea API, hosting the result
 * on Supabase Storage (a stable public URL, not the provider's temporary CDN
 * link), and registering it in the client's DAM (assets.json). Every generated
 * item is stamped ai_generated:true / ai_disclosed:true so /publish's
 * ai-disclosure guard (scripts/lib/guards.js) has what it needs.
 *
 * Scope (v1): single "image" format items only. "reels"/"video" need real video
 * generation (out of scope) and "carousel" multi-slide generation is not yet
 * wired — both are reported as skipped, never silently dropped.
 *
 * Usage:
 *   node skills/image-gen/image-gen.js <slug> [--item <id>] [--prompt "..."] [--model bfl/flux-1-dev] [--theme dark|light] [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { storageConfigured } from "../../scripts/lib/media_storage.js";
import { generateBrandedPoster } from "../../scripts/lib/poster_pipeline.js";
import { checkPosterInputs } from "../../scripts/lib/guards.js";
import { posterCopyFromItem } from "../../scripts/lib/poster_spec.js";
import * as P from "../../scripts/lib/paths.js";

loadEnv();

// Standard social ratios at a 1080px base edge — mirrors the map in
// image-gen-ads.js (kept separate since these two scripts have no shared
// module for CLI-level concerns).
const RATIOS = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

function ratioSlug(ratio) {
  return ratio.replace(":", "x");
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

function buildPrompt(item, profile) {
  const biz = profile?.business?.product_description || profile?.name || "";
  const parts = [item.message, biz, "professional social media ad photography, high detail, single photograph (not a collage, not a grid, not multiple panels), no text overlay, no logos, no watermarks"].filter(Boolean);
  return parts.join(". ");
}

function isTargetable(item) {
  return item.format === "image" && !item.image_url;
}

async function generateForItem(item, { slug, profile, brand, model, promptOverride, dryRun, theme }) {
  const prompt = promptOverride || buildPrompt(item, profile);
  const copy = posterCopyFromItem(item, { brandName: brand?.verbal?.name });
  if (dryRun) return { id: item.id, prompt, copy, theme, dry_run: true };

  const { image_url, local_path, brand_kit } = await generateBrandedPoster({
    slug,
    prompt,
    idTag: item.id,
    brand,
    contact: profile?.contact,
    copy,
    model,
    theme,
    tags: [item.pillar_id].filter(Boolean),
    altText: item.alt_text,
  });

  // Light-mode variants are additional copies, not replacements — only the
  // default dark render is the item's canonical image_url/local_path so
  // /publish keeps shipping the original unless told otherwise.
  if (theme !== "light") {
    item.image_url = image_url;
    item.local_path = local_path;
  } else {
    item.image_url_light = image_url;
    item.local_path_light = local_path;
  }
  item.ai_generated = true;
  item.ai_disclosed = true;
  item.brand_kit = brand_kit;

  return { id: item.id, prompt, theme, image_url, local_path };
}

/** All prior (`--ratios` unaware) generations used the 1080x1080 default, so a
 *  legacy `image_url` backfills cleanly into `images["1:1"]` without needing
 *  to inspect actual pixel dimensions. */
function missingRatiosForItem(item, requestedRatios) {
  if (!item.images && item.image_url) {
    item.images = { "1:1": { image_url: item.image_url, local_path: item.local_path || null } };
  }
  const have = item.images || {};
  return requestedRatios.filter((r) => !have[r]);
}

async function generateForItemRatio(item, ratio, { slug, profile, brand, model, promptOverride, dryRun }) {
  const prompt = promptOverride || buildPrompt(item, profile);
  const { width, height } = RATIOS[ratio];
  const copy = posterCopyFromItem(item, { brandName: brand?.verbal?.name });
  if (dryRun) return { id: item.id, ratio, prompt, width, height, copy, dry_run: true };

  const { image_url, local_path, brand_kit } = await generateBrandedPoster({
    slug,
    prompt,
    idTag: `${item.id}-${ratioSlug(ratio)}`,
    brand,
    contact: profile?.contact,
    copy,
    model,
    width,
    height,
    tags: [item.pillar_id].filter(Boolean),
    altText: item.alt_text,
  });

  item.images = item.images || {};
  item.images[ratio] = { image_url, local_path };
  if (!item.image_url || ratio === "1:1") {
    item.image_url = image_url;
    item.local_path = local_path;
  }
  item.ai_generated = true;
  item.ai_disclosed = true;
  item.brand_kit = brand_kit;

  return { id: item.id, ratio, prompt, width, height, image_url, local_path };
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug || slug.startsWith("--")) {
    console.error("Usage: node skills/image-gen/image-gen.js <slug> [--item <id>] [--ratios 1:1,9:16,4:5] [--prompt \"...\"] [--model bfl/flux-1-dev] [--theme dark|light] [--dry-run]");
    process.exit(1);
  }
  const itemIdx = args.indexOf("--item");
  const itemId = itemIdx >= 0 ? args[itemIdx + 1] : null;
  const promptIdx = args.indexOf("--prompt");
  const promptOverride = promptIdx >= 0 ? args[promptIdx + 1] : null;
  const modelIdx = args.indexOf("--model");
  const model = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  const themeIdx = args.indexOf("--theme");
  const theme = themeIdx >= 0 ? args[themeIdx + 1] : "dark";
  if (theme !== "dark" && theme !== "light") {
    console.error(`Unknown --theme "${theme}" — must be "dark" or "light".`);
    process.exit(1);
  }
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
  const calendarPath = P.clientFile(slug, "content_calendar.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  if (!existsSync(calendarPath)) {
    console.error(`No content_calendar.json for ${slug}. Run /content-plan first.`);
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

  const calendar = JSON.parse(readFileSync(calendarPath, "utf8"));
  const items = calendar.items || [];

  let targets;
  if (itemId) {
    const found = items.find((i) => i.id === itemId);
    if (!found) {
      console.error(`No calendar item with id ${itemId}`);
      process.exit(5);
    }
    targets = [found];
  } else if (ratios) {
    targets = items.filter((i) => i.format === "image" && missingRatiosForItem(i, ratios).length > 0);
  } else {
    targets = items.filter(isTargetable);
  }

  const skippedFormats = items.filter((i) => !isTargetable(i) && !i.image_url && (i.format === "carousel" || i.format === "reels" || i.format === "video"));

  const generated = [];
  const errors = [];
  if (ratios) {
    for (const item of targets) {
      for (const ratio of missingRatiosForItem(item, ratios)) {
        try {
          generated.push(await generateForItemRatio(item, ratio, { slug, profile, brand, model, promptOverride: itemId ? promptOverride : null, dryRun }));
        } catch (e) {
          errors.push({ id: item.id, ratio, error: e.message });
          item.error = e.message;
        }
      }
    }
  } else {
    for (const item of targets) {
      try {
        generated.push(await generateForItem(item, { slug, profile, brand, model, promptOverride: itemId ? promptOverride : null, dryRun, theme }));
      } catch (e) {
        errors.push({ id: item.id, error: e.message });
        item.error = e.message;
      }
    }
  }

  if (!dryRun) writeFileSync(calendarPath, JSON.stringify(calendar, null, 2));

  console.log(JSON.stringify({
    slug,
    mode: dryRun ? "DRY_RUN" : "LIVE",
    generated,
    errors,
    skipped_unsupported_format: skippedFormats.map((i) => ({ id: i.id, format: i.format, reason: `${i.format} generation not yet supported by /image-gen` })),
  }, null, 2));
}

main().catch((e) => {
  console.error("[image-gen] FATAL:", e.message);
  process.exit(1);
});
