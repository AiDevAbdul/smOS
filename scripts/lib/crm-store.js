// scripts/lib/crm-store.js — shared read/write for the agency pipeline (Phase 5).
//
// /crm owns the interactive commands; /proposal, /contract, /billing need to read a
// deal and patch it (links, stage) without reimplementing storage. This is the one
// place that touches crm/pipeline.json + the best-effort Supabase `deals` mirror, so
// every writer stays consistent with schemas/deal.js.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deal as dealSchema } from "../../schemas/index.js";
import { upsert, supabaseConfigured } from "./supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PIPELINE = resolve(ROOT, "crm", "pipeline.json");

export function loadPipeline() {
  if (!existsSync(PIPELINE)) return [];
  try { return JSON.parse(readFileSync(PIPELINE, "utf8")).map(dealSchema.normalize); } catch { return []; }
}

export function getDeal(slug) {
  return loadPipeline().find((d) => d.slug === slug) || null;
}

export function savePipeline(deals) {
  mkdirSync(dirname(PIPELINE), { recursive: true });
  writeFileSync(PIPELINE, JSON.stringify(deals.map(dealSchema.normalize), null, 2));
}

async function mirror(d) {
  if (!supabaseConfigured()) return;
  try {
    await upsert("deals", {
      slug: d.slug, company_name: d.company_name, stage: d.stage,
      monthly_retainer: d.deal.monthly_retainer, currency: d.deal.currency,
      probability: d.probability, links: d.links, updated_at: d.updated_at,
    }, "slug");
  } catch { /* best-effort */ }
}

/**
 * Upsert one deal (by slug) into the pipeline, validated. Returns the saved deal.
 * Creates the deal if it doesn't exist yet (so /proposal can run on a bare slug).
 */
export async function upsertDeal(slug, patch) {
  const deals = loadPipeline();
  const existing = deals.find((d) => d.slug === slug);
  const merged = dealSchema.normalize({
    ...(existing || { slug, company_name: slug, created_at: new Date().toISOString() }),
    ...patch,
    slug,
    links: { ...(existing?.links || {}), ...(patch.links || {}) },
    deal: { ...(existing?.deal || {}), ...(patch.deal || {}) },
    updated_at: new Date().toISOString(),
  });
  const v = dealSchema.validate(merged);
  if (!v.ok) throw new Error(`deal invalid:\n  - ${v.errors.join("\n  - ")}`);
  if (existing) Object.assign(existing, merged); else deals.push(merged);
  savePipeline(deals);
  await mirror(merged);
  return merged;
}

export { ROOT };
