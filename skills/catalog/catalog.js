#!/usr/bin/env node
/**
 * /catalog companion script — product catalog management.
 *
 * Usage:
 *   node skills/catalog/catalog.js <slug> list
 *   node skills/catalog/catalog.js <slug> create [--name NAME]
 *   node skills/catalog/catalog.js <slug> sync
 *   node skills/catalog/catalog.js <slug> feed --url URL [--schedule daily]
 *   node skills/catalog/catalog.js <slug> items
 *   node skills/catalog/catalog.js <slug> sets list
 *   node skills/catalog/catalog.js <slug> sets create --name NAME --filter '{"brand":{"eq":"Nike"}}'
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const REQUIRED_FIELDS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];
const AVAILABILITY_VALUES = new Set(["in stock", "out of stock", "preorder", "available for order", "discontinued"]);
const CONDITION_VALUES = new Set(["new", "refurbished", "used"]);
const PRICE_RE = /^\d+(\.\d{1,2})?\s+[A-Z]{3}$/;

function argVal(rest, flag) {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : null;
}

function parseCsv(text) {
  // Lightweight CSV parser — handles quoted fields with commas + escaped quotes.
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length && r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function loadProducts(slug) {
  const csvPath = resolve(ROOT, "clients", slug, "products.csv");
  const jsonPath = resolve(ROOT, "clients", slug, "products.json");
  if (existsSync(csvPath)) return parseCsv(readFileSync(csvPath, "utf8"));
  if (existsSync(jsonPath)) {
    const data = JSON.parse(readFileSync(jsonPath, "utf8"));
    if (!Array.isArray(data)) throw new Error("products.json must be an array of product objects");
    return data;
  }
  throw new Error(`No products.csv or products.json in clients/${slug}/`);
}

function validateProduct(p, seenIds) {
  const errors = [];
  for (const f of REQUIRED_FIELDS) {
    if (!p[f] || String(p[f]).trim() === "") errors.push(`missing:${f}`);
  }
  if (p.availability && !AVAILABILITY_VALUES.has(String(p.availability).toLowerCase())) {
    errors.push(`bad_availability:${p.availability}`);
  }
  if (p.condition && !CONDITION_VALUES.has(String(p.condition).toLowerCase())) {
    errors.push(`bad_condition:${p.condition}`);
  }
  if (p.price && !PRICE_RE.test(String(p.price))) {
    errors.push(`bad_price_format:${p.price}`);
  }
  if (p.link && !/^https?:\/\//.test(p.link)) errors.push("bad_link");
  if (p.image_link && !/^https?:\/\//.test(p.image_link)) errors.push("bad_image_link");
  if (p.id) {
    if (seenIds.has(String(p.id))) errors.push("duplicate_id");
    seenIds.add(String(p.id));
  }
  return errors;
}

async function listCatalogs(graph, businessId) {
  return graph.get(`/${businessId}/owned_product_catalogs`, {
    fields: "id,name,vertical,product_count,feed_count",
    limit: 200,
  });
}

async function createCatalog(graph, businessId, name) {
  return graph.post(`/${businessId}/owned_product_catalogs`, { name, vertical: "commerce" });
}

export async function syncProducts(graph, catalogId, products) {
  const seenIds = new Set();
  const accepted = [];
  const rejected = [];
  for (const p of products) {
    const errors = validateProduct(p, seenIds);
    if (errors.length) {
      rejected.push({ id: p.id || null, errors, sample: { title: p.title, brand: p.brand } });
    } else {
      accepted.push(p);
    }
  }

  if (!accepted.length) {
    return { accepted: 0, rejected: rejected.length, rejected_list: rejected, upload: null };
  }

  const requests = accepted.map((item) => ({
    method: "CREATE",
    retailer_id: String(item.id),
    data: item,
  }));

  // Meta accepts up to 5000 per batch; chunk for safety
  const chunks = [];
  for (let i = 0; i < requests.length; i += 5000) chunks.push(requests.slice(i, i + 5000));

  const uploads = [];
  for (const chunk of chunks) {
    const res = await graph.post(`/${catalogId}/items_batch`, {
      requests: JSON.stringify(chunk),
      item_type: "PRODUCT_ITEM",
    });
    uploads.push(res);
  }

  // Post-upload verification (SKILL.md step 4): GET the catalog's live item count
  // and compare to the number we accepted. The batch API returns 200 even when
  // individual items are silently dropped server-side, so a 200 is NOT proof the
  // items landed. We must read back the count before claiming success.
  const verification = await verifyItemCount(graph, catalogId, accepted.length);

  return {
    accepted: accepted.length,
    rejected: rejected.length,
    rejected_list: rejected,
    uploads,
    verification,
  };
}

/**
 * Read back the catalog's live product_count and compare to what we expected to
 * upload. Meta's catalog node exposes product_count directly, so a single GET is
 * enough — no need to paginate the full items collection.
 *
 * Degrades honestly: if the count GET fails or the field is absent, we record
 * status:"count_unverified" with the reason rather than asserting success.
 */
async function verifyItemCount(graph, catalogId, expected) {
  let live;
  try {
    const res = await graph.get(`/${catalogId}`, { fields: "product_count" });
    live = res && typeof res.product_count !== "undefined" ? Number(res.product_count) : null;
  } catch (e) {
    return { status: "count_unverified", expected, reason: e.message };
  }
  if (live == null || Number.isNaN(live)) {
    return { status: "count_unverified", expected, reason: "product_count not returned by Meta" };
  }
  if (live >= expected) {
    // >= rather than === : a catalog may already hold items from prior syncs, so
    // the live total only has to cover everything we just uploaded.
    return { status: "matched", expected, live_product_count: live };
  }
  return {
    status: "discrepancy",
    expected,
    live_product_count: live,
    missing: expected - live,
  };
}

async function createFeed(graph, catalogId, name, url, scheduleInterval) {
  const body = { name, file_format: "CSV" };
  if (scheduleInterval) body.schedule = JSON.stringify({ interval: scheduleInterval.toUpperCase() });
  const feed = await graph.post(`/${catalogId}/product_feeds`, body);
  const upload = await graph.post(`/${feed.id}/uploads`, { url });
  return { feed_id: feed.id, upload };
}

async function main() {
  const [slug, mode, ...rest] = process.argv.slice(2);
  if (!slug || !mode) {
    console.error("Usage: node skills/catalog/catalog.js <slug> <list|create|sync|feed|items|sets> [args]");
    process.exit(1);
  }

  const profilePath = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const acct = profile.accounts || {};
  const businessId = acct.business_id;
  let catalogId = acct.catalog_id;

  const graph = createGraph();

  try {
    let result;
    switch (mode) {
      case "list": {
        if (isTbd(businessId)) throw new Error("accounts.business_id is TBD");
        result = await listCatalogs(graph, businessId);
        break;
      }
      case "create": {
        if (isTbd(businessId)) throw new Error("accounts.business_id is TBD");
        const name = argVal(rest, "--name") || `${profile.name} Catalog`;
        result = await createCatalog(graph, businessId, name);
        // Write back to profile
        profile.accounts = profile.accounts || {};
        profile.accounts.catalog_id = result.id;
        writeFileSync(profilePath, JSON.stringify(profile, null, 2));
        console.error(`[catalog] saved catalog_id=${result.id} to client_profile.json`);
        break;
      }
      case "sync": {
        if (isTbd(catalogId)) throw new Error("accounts.catalog_id is TBD — run 'create' first");
        const products = loadProducts(slug);
        result = await syncProducts(graph, catalogId, products);
        result.input_total = products.length;
        const logPath = resolve(ROOT, "clients", slug, "catalog_sync_log.json");
        writeFileSync(logPath, JSON.stringify({ slug, generated_at: new Date().toISOString(), ...result }, null, 2));
        console.error(`[catalog] wrote ${logPath}`);
        const v = result.verification;
        if (v?.status === "discrepancy") {
          console.error(
            `[catalog] WARNING discrepancy: uploaded ${v.expected} but catalog shows ${v.live_product_count} (${v.missing} missing) — NOT all items landed`
          );
        } else if (v?.status === "count_unverified") {
          console.error(`[catalog] count_unverified — could not confirm item count: ${v.reason}`);
        } else if (v?.status === "matched") {
          console.error(`[catalog] verified: catalog holds ${v.live_product_count} items (>= ${v.expected} uploaded)`);
        }
        break;
      }
      case "feed": {
        if (isTbd(catalogId)) throw new Error("accounts.catalog_id is TBD — run 'create' first");
        const url = argVal(rest, "--url");
        if (!url) throw new Error("feed mode requires --url");
        const schedule = argVal(rest, "--schedule");
        const name = argVal(rest, "--name") || `${profile.name} feed`;
        result = await createFeed(graph, catalogId, name, url, schedule);
        break;
      }
      case "items": {
        if (isTbd(catalogId)) throw new Error("accounts.catalog_id is TBD");
        result = await graph.get(`/${catalogId}/products`, {
          fields: "id,retailer_id,name,availability,price,brand,link,image_url",
          limit: 200,
        });
        break;
      }
      case "sets": {
        if (isTbd(catalogId)) throw new Error("accounts.catalog_id is TBD");
        const sub = rest[0];
        if (sub === "list") {
          result = await graph.get(`/${catalogId}/product_sets`, { fields: "id,name,product_count,filter", limit: 100 });
        } else if (sub === "create") {
          const name = argVal(rest, "--name");
          const filterStr = argVal(rest, "--filter");
          if (!name || !filterStr) throw new Error("sets create requires --name and --filter '<json>'");
          result = await graph.post(`/${catalogId}/product_sets`, { name, filter: filterStr });
        } else {
          throw new Error("sets sub-mode must be list or create");
        }
        break;
      }
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }

    console.log(JSON.stringify({ slug, mode, result }, null, 2));
  } catch (e) {
    console.error(`[catalog] ${mode} failed: ${e.message}`);
    process.exit(1);
  }
}

// Only run the CLI when invoked directly — importing for tests must not execute main().
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error("[catalog] FATAL:", e.message);
    process.exit(1);
  });
}
