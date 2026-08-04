#!/usr/bin/env node
/**
 * Helper: read image files for a batch and prepare base64 encoding for vision analysis.
 * Usage: node skills/audit-creative/score-batches.js <slug> <batch_id>
 */

import { readFileSync, existsSync } from "node:fs";
import * as P from "../../scripts/lib/paths.js";

const [slug, batchId] = process.argv.slice(2);
if (!slug || batchId === undefined) {
  console.error("Usage: node score-batches.js <slug> <batch_id>");
  process.exit(1);
}

const assetsPath = P.clientFile(slug, "creative_assets.json");
if (!existsSync(assetsPath)) {
  console.error(`Assets file not found: ${assetsPath}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(assetsPath, "utf8"));
const batch = data.batches[batchId];

if (!batch) {
  console.error(`Batch ${batchId} not found`);
  process.exit(1);
}

const images = batch.image_paths.map((path) => {
  try {
    const buf = readFileSync(path);
    const b64 = buf.toString("base64");
    return {
      asset_id: path.split("/").pop().replace(".jpg", ""),
      mime: "image/jpeg",
      data: b64,
      path,
    };
  } catch (e) {
    console.error(`Failed to read ${path}: ${e.message}`);
    return null;
  }
}).filter(Boolean);

console.log(JSON.stringify({
  slug,
  batch_id: batchId,
  asset_ids: batch.asset_ids,
  image_count: images.length,
  vision_prompt: batch.vision_prompt,
  images: images.map((img) => ({
    asset_id: img.asset_id,
    mime: img.mime,
    data: img.data.substring(0, 100) + "..." // Preview
  })),
  full_images: images, // Include full base64
}, null, 2));
