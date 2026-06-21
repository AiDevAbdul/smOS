// schemas/asset.js — canonical shape for the Digital Asset Manager (Phase 3.4).
//
// A versioned, tagged, reusable creative asset plus its measured performance
// (hook-rate / 3s-retention) so winners can be found and re-used. The DAM lib
// (producer) and /creative + /launch (consumers, when they pick an asset) share
// this contract. asset_id is the stable join key into ads + daily_metrics.

import { pick, asArray, isFiniteNumber, isNonEmptyString, result } from "./_shared.js";

export const MEDIA_TYPES = ["image", "video", "carousel"];

export function angleOf(asset) {
  return pick(asset, "angle_id", "angle") ?? null;
}

export function normalize(raw) {
  const r = raw || {};
  return {
    asset_id: pick(r, "asset_id", "id") ?? null,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    media_type: (pick(r, "media_type", "type") || "image").toLowerCase(),
    version: Number(pick(r, "version") ?? 1) || 1,
    parent_asset_id: pick(r, "parent_asset_id", "derived_from") ?? null,
    uri: pick(r, "uri", "url", "image_url", "video_url") ?? null,
    hash: pick(r, "hash", "sha256") ?? null, // dedupe identical bytes across versions
    angle_id: angleOf(r),
    tags: asArray(pick(r, "tags")),
    alt_text: pick(r, "alt_text") ?? null,
    ai_generated: pick(r, "ai_generated") === true,
    ai_disclosed: pick(r, "ai_disclosed") === true,
    // measured performance (nullable until the asset has run)
    metrics: {
      impressions: Number(pick(r.metrics || r, "impressions") ?? 0) || 0,
      hook_rate: isFiniteNumber(pick(r.metrics || r, "hook_rate")) ? pick(r.metrics || r, "hook_rate") : null,
      retention_3s: isFiniteNumber(pick(r.metrics || r, "retention_3s")) ? pick(r.metrics || r, "retention_3s") : null,
      ctr: isFiniteNumber(pick(r.metrics || r, "ctr")) ? pick(r.metrics || r, "ctr") : null,
      roas: isFiniteNumber(pick(r.metrics || r, "roas")) ? pick(r.metrics || r, "roas") : null,
    },
    created_at: pick(r, "created_at") ?? null,
  };
}

export function validate(obj) {
  const errors = [];
  const a = normalize(obj);
  if (!isNonEmptyString(a.asset_id)) errors.push("asset_id missing");
  if (!MEDIA_TYPES.includes(a.media_type)) errors.push(`media_type "${a.media_type}" not in ${MEDIA_TYPES.join("/")}`);
  if (!isNonEmptyString(a.uri)) errors.push("uri missing — an asset must point at real bytes");
  // Safety tie-in: an AI-generated asset must be flagged for disclosure downstream.
  if (a.ai_generated && !a.ai_disclosed) errors.push("ai_generated asset is not marked ai_disclosed (Phase 3.2 disclosure)");
  return result(errors);
}
