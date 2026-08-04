#!/usr/bin/env node
/**
 * Load all batches and generate vision scoring skeleton ready for analysis.
 * Usage: node analyze-all-batches.js <slug>
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import * as P from "../../scripts/lib/paths.js";

const [slug] = process.argv.slice(2);
if (!slug) {
  console.error("Usage: node analyze-all-batches.js <slug>");
  process.exit(1);
}

const assetsPath = P.clientFile(slug, "creative_assets.json");
if (!existsSync(assetsPath)) {
  console.error(`Assets file not found: ${assetsPath}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(assetsPath, "utf8"));

// Generate analysis for each batch
const analysis = data.batches.map((batch) => {
  const images = batch.image_paths.map((path) => {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    return {
      asset_id: path.split("/").pop().replace(".jpg", ""),
      path,
      size_kb: Math.round(stat.size / 1024),
    };
  }).filter(Boolean);

  return {
    batch_id: batch.batch_id,
    asset_ids: batch.asset_ids,
    image_count: images.length,
    images,
  };
});

console.log("Batch Analysis:");
analysis.forEach((b) => {
  console.log(`\n=== Batch ${b.batch_id} ===`);
  console.log(`Assets: ${b.asset_ids.join(", ")}`);
  console.log(`Images to score: ${b.image_count}`);
  b.images.forEach((img) => {
    console.log(`  - ${img.asset_id}: ${img.size_kb}KB`);
  });
});

console.log("\n\nTotal images to score:", analysis.reduce((sum, b) => sum + b.image_count, 0));
console.log("Total batches:", analysis.length);
