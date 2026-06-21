// scripts/lib/brand.js — shared load/merge/save/gate helper for the brand track.
//
// The five brand skills each contribute one layer to clients/<slug>/brand_profile.json.
// They must MERGE (never clobber a prior layer) and validate their stage against the
// canonical schema, asserting the prior human gate is stamped. This centralizes that
// so /brand-strategy, /brand-name, /brand-visual, /brand-book, /brand-social behave
// identically and a renamed field can't silently break the chain.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as brandProfile from "../../schemas/brand_profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

export function brandPath(slug) {
  return resolve(ROOT, "clients", slug, "brand_profile.json");
}

export function clientDir(slug) {
  return resolve(ROOT, "clients", slug);
}

/** Load the existing brand profile (normalized) or a fresh draft skeleton. */
export function loadBrand(slug) {
  const p = brandPath(slug);
  if (existsSync(p)) {
    return brandProfile.normalize(JSON.parse(readFileSync(p, "utf8")));
  }
  return brandProfile.normalize({ client_slug: slug, status: "draft" });
}

/** Deep-merge `patch` into the existing profile, normalize, validate the stage,
 *  then write. Throws SchemaError (fail-closed) if the stage doesn't validate —
 *  including when the prior human gate is not yet stamped. */
export function saveBrand(slug, patch, { stage } = {}) {
  const current = loadBrand(slug);
  const merged = deepMerge(current, patch);
  merged.client_slug = slug;
  const normalized = brandProfile.normalize(merged);
  if (stage) {
    const v = brandProfile.validate(normalized, { stage });
    if (!v.ok) {
      throw new Error(`brand_profile (${stage}) failed validation:\n  - ${v.errors.join("\n  - ")}`);
    }
  }
  const dir = clientDir(slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(brandPath(slug), JSON.stringify(normalized, null, 2));
  return normalized;
}

/** Stamp a human-approval gate (positioning / name / logo) with an ISO timestamp.
 *  These are the THREE load-bearing checkpoints AI must never auto-clear — a skill
 *  only calls this on an explicit --approve flag passed by the human operator. */
export function stampGate(slug, gate) {
  const map = {
    positioning: ["strategy", "positioning_approved_at", "positioning_approved"],
    name: ["verbal", "name_approved_at", "named"],
    logo: ["visual", "logo_approved_at", "visual_approved"],
  };
  const spec = map[gate];
  if (!spec) throw new Error(`stampGate: unknown gate "${gate}" (use positioning|name|logo)`);
  const [layer, field, status] = spec;
  const current = loadBrand(slug);
  current[layer][field] = new Date().toISOString();
  current.status = status;
  current.client_slug = slug;
  writeFileSync(brandPath(slug), JSON.stringify(current, null, 2));
  return current;
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === "object" && base && typeof base === "object" && !Array.isArray(base)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(base[k] ?? {}, v) : v;
    }
    return out;
  }
  return patch === undefined ? base : patch;
}

export { ROOT };
