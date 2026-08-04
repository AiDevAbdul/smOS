#!/usr/bin/env node
/**
 * Helper: merge vision scores back into creative_assets.json
 * Usage: node skills/audit-creative/merge-scores.js <slug> <scores_file>
 *
 * The scores_file should be a JSON with structure:
 * {
 *   "batch_id": 0,
 *   "scores": [
 *     { "asset_id": "123", "visual_quality": 8, "brand_consistency": 7, ... },
 *     ...
 *   ]
 * }
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as P from "../../scripts/lib/paths.js";

const [slug, scoresFile] = process.argv.slice(2);
if (!slug || !scoresFile) {
  console.error("Usage: node merge-scores.js <slug> <scores_file>");
  process.exit(1);
}

if (!existsSync(scoresFile)) {
  console.error(`Scores file not found: ${scoresFile}`);
  process.exit(1);
}

const assetsPath = P.clientFile(slug, "creative_assets.json");
if (!existsSync(assetsPath)) {
  console.error(`Assets file not found: ${assetsPath}`);
  process.exit(1);
}

const scores = JSON.parse(readFileSync(scoresFile, "utf8"));
const data = JSON.parse(readFileSync(assetsPath, "utf8"));

// Merge scores back into assets
if (scores.scores && Array.isArray(scores.scores)) {
  for (const score of scores.scores) {
    const asset = data.assets.find((a) => a.asset_id === score.asset_id);
    if (asset) {
      asset.vision_scores = {
        visual_quality: score.visual_quality,
        brand_consistency: score.brand_consistency,
        cta_present: score.cta_present,
        text_density_pct: score.text_density_pct,
        messaging_clarity: score.messaging_clarity,
        notes: score.notes,
      };
    }
  }
}

writeFileSync(assetsPath, JSON.stringify(data, null, 2));
console.log(`Merged ${scores.scores?.length || 0} scores from batch ${scores.batch_id}`);
