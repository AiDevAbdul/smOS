// scripts/lib/dam.js — Digital Asset Manager core (Phase 3.4).
//
// A versioned, tagged, content-addressed asset library plus performance rollup.
// Storage is a per-client JSON index (clients/<slug>/assets.json) with best-effort
// Supabase mirror; bytes live wherever uri points (CDN/Drive). asset_id is the
// stable join key into ads + daily_metrics so hook-rate/retention can be attributed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { asset as schema } from "../../schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function indexPath(slug) { return resolve(ROOT, "clients", slug, "assets.json"); }

export function loadIndex(slug) {
  const p = indexPath(slug);
  if (!existsSync(p)) return { client_slug: slug, assets: [] };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { client_slug: slug, assets: [] }; }
}

export function saveIndex(slug, index) {
  writeFileSync(indexPath(slug), JSON.stringify(index, null, 2));
  return index;
}

/** Content hash for dedupe — callers pass raw bytes or a stable string descriptor. */
export function hashBytes(bufOrString) {
  return createHash("sha256").update(bufOrString).digest("hex");
}

/**
 * Register (or version-bump) an asset. If an asset with the same hash exists it is
 * returned unchanged (true dedupe). If asset_id exists with a different hash, a new
 * version is created with parent_asset_id set. Returns the normalized asset.
 */
export function register(slug, raw) {
  const index = loadIndex(slug);
  const incoming = schema.normalize({ ...raw, client_slug: slug });
  const v = schema.validate(incoming);
  if (!v.ok) throw new Error(`asset invalid:\n  - ${v.errors.join("\n  - ")}`);

  if (incoming.hash) {
    const dup = index.assets.find((a) => a.hash === incoming.hash);
    if (dup) return dup;
  }
  const prior = index.assets.filter((a) => a.asset_id === incoming.asset_id);
  if (prior.length) {
    incoming.version = Math.max(...prior.map((a) => a.version)) + 1;
    incoming.parent_asset_id = prior[prior.length - 1].asset_id;
    incoming.asset_id = `${incoming.asset_id}_v${incoming.version}`;
  }
  index.assets.push(incoming);
  saveIndex(slug, index);
  return incoming;
}

/** Attach measured performance to an asset (from daily_metrics rollup). */
export function recordMetrics(slug, assetId, metrics) {
  const index = loadIndex(slug);
  const a = index.assets.find((x) => x.asset_id === assetId);
  if (!a) throw new Error(`recordMetrics: no asset ${assetId}`);
  a.metrics = { ...a.metrics, ...metrics };
  saveIndex(slug, index);
  return a;
}

/** Rank assets by a metric (default hook_rate), winners first; nulls sink. */
export function topPerformers(slug, { by = "hook_rate", limit = 10 } = {}) {
  const index = loadIndex(slug);
  return index.assets
    .filter((a) => a.metrics?.[by] != null)
    .sort((x, y) => y.metrics[by] - x.metrics[by])
    .slice(0, limit);
}
