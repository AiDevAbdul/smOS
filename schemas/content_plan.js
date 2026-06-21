// schemas/content_plan.js — canonical shape for the Organic Content Strategy
// Engine (Phase 2.2) and the calendar /publish consumes (Phase 2 link-up).
//
// /content-plan (producer) emits pillars + a Reels-first calendar. /publish
// (consumer, already in repo) reads content_calendar.json items. This schema is
// the contract between them — and folds in the Social-SEO layer (Phase 2.6):
// every calendar item carries keyword-first caption + alt_text fields so SEO is
// not optional.

import { pick, asArray, isNonEmptyString, result } from "./_shared.js";

export const PLATFORMS = ["facebook", "instagram", "threads"];
export const FORMATS = ["post", "image", "video", "reels", "carousel", "story", "text"];
export const ITEM_STATES = ["pending", "scheduled", "published", "error", "draft"];

export function normalizePillar(raw) {
  const r = raw || {};
  return {
    id: pick(r, "id", "key") ?? null,
    name: pick(r, "name", "title") ?? null,
    intent: pick(r, "intent", "goal") ?? null, // educate|inspire|convert|community
    cadence_per_week: Number(pick(r, "cadence_per_week", "cadence") ?? 0) || 0,
    keywords: asArray(pick(r, "keywords", "seo_keywords")),
  };
}

export function normalizeItem(raw) {
  const r = raw || {};
  return {
    id: pick(r, "id") ?? null,
    pillar_id: pick(r, "pillar_id", "pillar") ?? null,
    platform: (pick(r, "platform", "network") || "instagram").toLowerCase(),
    format: (pick(r, "format", "type") || "reels").toLowerCase(),
    publish_at: pick(r, "publish_at", "scheduled_for") ?? null,
    message: pick(r, "message", "caption", "copy") ?? "",
    link: pick(r, "link", "url") ?? null,
    image_url: pick(r, "image_url") ?? null,
    video_url: pick(r, "video_url") ?? null,
    items: asArray(pick(r, "items")), // carousel slides
    // Social-SEO (2.6)
    keywords: asArray(pick(r, "keywords", "seo_keywords")),
    alt_text: pick(r, "alt_text") ?? null,
    hashtags: asArray(pick(r, "hashtags")),
    // publish runtime fields (kept so a round-trip through /publish is lossless)
    status: (pick(r, "status") || "pending").toLowerCase(),
    published_id: pick(r, "published_id") ?? null,
    published_at: pick(r, "published_at") ?? null,
    error: pick(r, "error") ?? null,
    schedule_native: pick(r, "schedule_native") === true,
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    period: pick(r, "period") ?? null,
    pillars: asArray(pick(r, "pillars")).map(normalizePillar),
    items: asArray(pick(r, "items")).map(normalizeItem),
  };
}

export function validate(obj, { requirePublishable = false } = {}) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["content_plan is not an object"]);
  const items = asArray(obj.items);
  if (items.length === 0) errors.push("content_plan.items is empty");

  items.forEach((raw, i) => {
    const it = normalizeItem(raw);
    if (!isNonEmptyString(it.id)) errors.push(`items[${i}] missing id`);
    if (!PLATFORMS.includes(it.platform)) errors.push(`items[${i}] platform "${it.platform}" invalid`);
    if (!FORMATS.includes(it.format)) errors.push(`items[${i}] format "${it.format}" invalid`);
    if (!ITEM_STATES.includes(it.status)) errors.push(`items[${i}] status "${it.status}" invalid`);
    if (requirePublishable) {
      // What /publish needs to actually post each format.
      if (!isNonEmptyString(it.publish_at)) errors.push(`items[${i}] (${it.id}) missing publish_at`);
      if ((it.format === "image") && !it.image_url) errors.push(`items[${i}] (${it.id}) image needs image_url`);
      if ((it.format === "video" || it.format === "reels") && !it.video_url) errors.push(`items[${i}] (${it.id}) ${it.format} needs video_url`);
      if (it.format === "carousel" && asArray(it.items).length < 2) errors.push(`items[${i}] (${it.id}) carousel needs ≥2 slides`);
      if (!isNonEmptyString(it.message) && it.format !== "story") errors.push(`items[${i}] (${it.id}) missing caption/message`);
    }
  });
  return result(errors);
}
