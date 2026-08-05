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
 * `localOnly: true` skips the Storage upload (e.g. Supabase unreachable) and
 * returns `image_url: null, hosted: false` — the local PNG still gets written
 * and registered in the DAM (uri = local_path), but callers/downstream skills
 * (`/launch`, `/publish`) can't ship it until it's re-uploaded once hosting is
 * back; this is for reviewing the creative now, not a substitute for hosting.
 *
 * Returns { image_url, local_path, brand_kit, dam_asset_id, hosted }.
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
  theme = "dark",
  localOnly = false,
} = {}) {
  const { urls } = await generateImage({ prompt, model, width, height });
  const backgroundBuffer = await fetchBuffer(urls[0]);
  const composited = await composePoster({ backgroundBuffer, brand, contact, copy, width, height, theme });

  // Theme-suffix the remote/local filenames so a light-mode re-run doesn't
  // clobber the dark-mode original — callers can generate and keep both.
  const idFile = theme === "light" ? `${idTag}-light` : idTag;

  const local_path = resolve(clientRoot(slug), "generated", `${idFile}.png`);
  ensureParent(local_path);
  writeFileSync(local_path, composited);

  let image_url = null;
  if (!localOnly) {
    const remotePath = `clients/${slug}/generated/${idFile}.png`;
    image_url = await uploadPublicAsset(composited, remotePath, { contentType: "image/png" });
  }

  const brand_kit = {
    colors: brand?.visual?.colors || null,
    logo_url: theme === "light"
      ? brand?.visual?.logo?.primary_url || brand?.visual?.logo?.reverse_url || null
      : brand?.visual?.logo?.reverse_url || brand?.visual?.logo?.primary_url || null,
  };

  const dam = register(slug, {
    asset_id: `img_${idFile}`,
    media_type: "image",
    uri: image_url || local_path,
    hash: hashBytes(composited),
    tags,
    alt_text: altText,
    ai_generated: true,
    ai_disclosed: true,
    created_at: new Date().toISOString(),
  });

  return { image_url, local_path, brand_kit, dam_asset_id: dam.asset_id, hosted: !localOnly };
}
