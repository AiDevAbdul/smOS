/**
 * Shared Krea-generate -> composite -> host -> DAM-register sequence, used by
 * both skills/image-gen/image-gen.js (organic, content_calendar.json) and
 * skills/image-gen/image-gen-ads.js (paid, ad_copy.json angles) so the two
 * entry points don't duplicate this pipeline.
 */

import { writeFileSync } from "node:fs";
import { generateImage } from "./krea.js";
import { fetchBuffer, uploadPublicAsset } from "./media_storage.js";
import { composePoster } from "./poster_compose.js";
import { register, hashBytes } from "./dam.js";
import { clientRoot, ensureParent } from "./paths.js";
import { resolve } from "node:path";

/**
 * Generate one branded poster: Krea background -> composite logo/contact bar ->
 * upload to Supabase Storage (canonical, shareable URL) -> also save a local
 * copy under clients/{slug}/generated/ (fast local review, no network round
 * trip needed to eyeball a creative) -> register in the client's DAM.
 *
 * Returns { image_url, local_path, brand_kit, dam_asset_id }.
 */
export async function generateBrandedPoster({
  slug,
  prompt,
  idTag,
  brand,
  contact,
  copy = null,
  model,
  width = 1080,
  height = 1080,
  tags = [],
  altText = null,
} = {}) {
  const { urls } = await generateImage({ prompt, model, width, height });
  const backgroundBuffer = await fetchBuffer(urls[0]);
  const composited = await composePoster({ backgroundBuffer, brand, contact, copy, width, height });

  const remotePath = `clients/${slug}/generated/${idTag}.png`;
  const image_url = await uploadPublicAsset(composited, remotePath, { contentType: "image/png" });

  const local_path = resolve(clientRoot(slug), "generated", `${idTag}.png`);
  ensureParent(local_path);
  writeFileSync(local_path, composited);

  const brand_kit = {
    colors: brand?.visual?.colors || null,
    logo_url: brand?.visual?.logo?.reverse_url || brand?.visual?.logo?.primary_url || null,
  };

  const dam = register(slug, {
    asset_id: `img_${idTag}`,
    media_type: "image",
    uri: image_url,
    hash: hashBytes(composited),
    tags,
    alt_text: altText,
    ai_generated: true,
    ai_disclosed: true,
    created_at: new Date().toISOString(),
  });

  return { image_url, local_path, brand_kit, dam_asset_id: dam.asset_id };
}
