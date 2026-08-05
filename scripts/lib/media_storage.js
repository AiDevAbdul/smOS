/**
 * Supabase Storage — permanent hosting for generated creative (images from
 * scripts/lib/krea.js) so /publish always posts a stable, public image_url
 * instead of a provider's temporary CDN link.
 *
 * NO-OP-safe like supabase.js: throws a clear error if unconfigured rather
 * than silently degrading, because /publish hard-requires a real URL.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const URL_ENV = () => process.env.SUPABASE_URL;
const KEY_ENV = () => process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;
const BUCKET_ENV = () => process.env.SMOS_ASSETS_BUCKET || "smos-assets";

export function storageConfigured() {
  return !!(URL_ENV() && KEY_ENV());
}

/**
 * Download an arbitrary URL (e.g. a Krea job's temporary output) as a Buffer.
 * Also accepts a repo-relative local path (e.g. brand.visual.logo.primary_url
 * recorded as "clients/{slug}/brand/logo.jpeg" before that asset was ever
 * uploaded to Storage) — reads it straight off disk instead of failing with
 * Node fetch's "Failed to parse URL" on a non-absolute string.
 */
export async function fetchBuffer(url) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(String(url))) {
    return readFile(resolve(ROOT, url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchBuffer ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Upload bytes to the configured public bucket and return a permanent public URL.
 * `path` is the object key within the bucket, e.g. "clients/blue-rose-auto/2026-07-21_hero.png".
 */
export async function uploadPublicAsset(buffer, path, { contentType = "image/png", bucket = BUCKET_ENV() } = {}) {
  if (!storageConfigured()) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY (or SUPABASE_SECRET_KEY) must be set to host generated images");
  }
  const base = URL_ENV().replace(/\/+$/, "");
  const key = String(path).replace(/^\/+/, "");
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY_ENV()}`,
      apikey: KEY_ENV(),
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase Storage upload -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return `${base}/storage/v1/object/public/${bucket}/${key}`;
}
