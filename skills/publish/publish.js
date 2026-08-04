#!/usr/bin/env node
/**
 * /publish companion script.
 *
 * Reads clients/<slug>/content_calendar.json, publishes/schedules every item
 * whose publish_at is now-or-past and status is "pending", and writes back
 * the updated calendar + an append-only publish_log.json.
 *
 * Usage:
 *   node skills/publish/publish.js <client_slug> [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { checkAiDisclosure, checkBrandCompliance } from "../../scripts/lib/guards.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const IG_CONTAINER_TIMEOUT_MS = 60_000;
const IG_CONTAINER_POLL_MS = 3000;
const FB_REEL_TIMEOUT_MS = 120_000;
const FB_REEL_POLL_MS = 5000;

function pageTokenFor(slug) {
  const envKey = `META_PAGE_TOKEN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envKey] || process.env.META_PAGE_TOKEN || process.env.META_ACCESS_TOKEN;
}

// A per-client token can belong to a different Meta App than the global default
// (e.g. a client-specific system user under its own app) — appsecret_proof must
// be computed with THAT app's secret or Meta rejects every call.
function appSecretFor(slug) {
  const envKey = `META_APP_SECRET_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envKey] || process.env.META_APP_SECRET;
}

async function pollContainer(graph, containerId) {
  const deadline = Date.now() + IG_CONTAINER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await graph.get(`/${containerId}`, { fields: "status_code,status" });
    if (res.status_code === "FINISHED") return res;
    if (res.status_code === "ERROR" || res.status_code === "EXPIRED") {
      throw new Error(`IG container ${containerId} failed: ${res.status_code} (${res.status || "unknown"})`);
    }
    await new Promise((r) => setTimeout(r, IG_CONTAINER_POLL_MS));
  }
  throw new Error(`IG container ${containerId} did not finish within ${IG_CONTAINER_TIMEOUT_MS}ms`);
}

// Facebook Page video/reels: the three-phase Video Reels API (start → transfer →
// finish). We always transfer via a hosted file_url (Meta fetches the bytes) —
// matching the hosted-URL convention already used for IG video/reels and for ad
// video uploads in scripts/lib/media_upload.js — so no local/binary upload path
// is needed here.
async function pollFacebookReel(graph, videoId) {
  const deadline = Date.now() + FB_REEL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await graph.get(`/${videoId}`, { fields: "status" });
    const state = res.status?.video_status;
    if (state === "ready") return res;
    if (state === "error") throw new Error(`FB reel ${videoId} failed to process: ${JSON.stringify(res.status)}`);
    await new Promise((r) => setTimeout(r, FB_REEL_POLL_MS));
  }
  throw new Error(`FB reel ${videoId} did not finish processing within ${FB_REEL_TIMEOUT_MS}ms`);
}

async function publishFacebookReel(graph, item, pageId, pageToken) {
  if (!item.video_url) throw new Error("facebook reels requires video_url");

  const start = await graph.post(`/${pageId}/video_reels`, {
    access_token: pageToken,
    upload_phase: "start",
  });
  const videoId = start.video_id;
  if (!videoId) throw new Error(`FB video_reels start phase returned no video_id: ${JSON.stringify(start)}`);

  await graph.post(`/${pageId}/video_reels`, {
    access_token: pageToken,
    upload_phase: "transfer",
    video_id: videoId,
    file_url: item.video_url,
  });

  await pollFacebookReel(graph, videoId);

  const finish = await graph.post(`/${pageId}/video_reels`, {
    access_token: pageToken,
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description: item.message || "",
  });

  return { id: videoId, ...finish };
}

async function publishFacebook(graph, item, pageId, pageToken) {
  if (!pageToken) throw new Error("No page access token — set META_PAGE_TOKEN or META_PAGE_TOKEN_<SLUG>");

  if (item.format === "reels" || item.format === "video") {
    return publishFacebookReel(graph, item, pageId, pageToken);
  }

  const body = { access_token: pageToken };
  if (item.message) body.message = item.message;
  if (item.link) body.link = item.link;

  // Native FB scheduling
  if (item.schedule_native && item.publish_at) {
    const ts = Math.floor(new Date(item.publish_at).getTime() / 1000);
    const minFuture = Math.floor(Date.now() / 1000) + 600;
    if (ts < minFuture) {
      throw new Error(`schedule_native requires publish_at ≥ 10 min in future (got ${item.publish_at})`);
    }
    body.scheduled_publish_time = ts;
    body.published = false;
  }

  if (item.image_url) {
    body.url = item.image_url;
    return graph.post(`/${pageId}/photos`, body);
  }
  return graph.post(`/${pageId}/feed`, body);
}

async function publishInstagramSingle(graph, item, igId) {
  const params = {};
  if (item.message) params.caption = item.message;

  if (item.format === "image") {
    if (!item.image_url) throw new Error("instagram image requires image_url");
    params.image_url = item.image_url;
  } else if (item.format === "video") {
    if (!item.video_url) throw new Error("instagram video requires video_url");
    params.media_type = "VIDEO";
    params.video_url = item.video_url;
  } else if (item.format === "reels") {
    if (!item.video_url) throw new Error("instagram reels requires video_url");
    params.media_type = "REELS";
    params.video_url = item.video_url;
    params.share_to_feed = item.share_to_feed !== false;
    if (item.cover_url) params.cover_url = item.cover_url;
  }

  const container = await graph.post(`/${igId}/media`, params);
  if (item.format !== "image") await pollContainer(graph, container.id);
  const publish = await graph.post(`/${igId}/media_publish`, { creation_id: container.id });
  return { container_id: container.id, media_id: publish.id };
}

async function publishInstagramCarousel(graph, item, igId) {
  if (!Array.isArray(item.items) || item.items.length < 2 || item.items.length > 10) {
    throw new Error("instagram carousel requires items: 2–10 slides");
  }

  const childIds = [];
  for (const slide of item.items) {
    const p = { is_carousel_item: true };
    if (slide.media_type === "IMAGE" || slide.format === "image") {
      if (!slide.image_url) throw new Error("carousel IMAGE slide missing image_url");
      p.image_url = slide.image_url;
    } else if (slide.media_type === "VIDEO" || slide.format === "video") {
      if (!slide.video_url) throw new Error("carousel VIDEO slide missing video_url");
      p.media_type = "VIDEO";
      p.video_url = slide.video_url;
    } else {
      throw new Error(`unknown carousel slide format: ${slide.media_type || slide.format}`);
    }
    const c = await graph.post(`/${igId}/media`, p);
    if (p.media_type === "VIDEO") await pollContainer(graph, c.id);
    childIds.push(c.id);
  }

  const parent = await graph.post(`/${igId}/media`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption: item.message,
  });
  await pollContainer(graph, parent.id);
  const publish = await graph.post(`/${igId}/media_publish`, { creation_id: parent.id });
  return { container_id: parent.id, child_ids: childIds, media_id: publish.id };
}

function isDue(item) {
  if (item.status !== "pending") return false;
  if (!item.publish_at) return true;
  return new Date(item.publish_at).getTime() <= Date.now();
}

function isIgLimitError(message) {
  return /application request limit|exceeded the maximum number of posts|100 posts within 24 hours/i.test(message || "");
}

async function main() {
  const slug = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!slug) {
    console.error("Usage: node skills/publish/publish.js <slug> [--dry-run]");
    process.exit(1);
  }

  const profilePath = P.clientFile(slug, "client_profile.json");
  const calendarPath = P.clientFile(slug, "content_calendar.json");
  if (!existsSync(profilePath)) {
    console.error(`Profile not found: ${profilePath}`);
    process.exit(2);
  }
  if (!existsSync(calendarPath)) {
    console.error(`No content_calendar.json for ${slug}.`);
    process.exit(3);
  }

  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  const calendar = JSON.parse(readFileSync(calendarPath, "utf8"));
  const acct = profile.accounts || {};
  const pageId = acct.facebook_page_id;
  const igId = acct.instagram_business_id;
  const pageToken = pageTokenFor(slug);

  const due = (calendar.items || []).filter(isDue);
  console.error(`[publish] ${slug} — ${due.length} due of ${(calendar.items || []).length} total`);

  if (dryRun) {
    console.log(JSON.stringify({
      slug,
      mode: "DRY_RUN",
      due: due.map((d) => ({ id: d.id, platform: d.platform, format: d.format, publish_at: d.publish_at })),
    }, null, 2));
    return;
  }

  const graph = createGraph(pageToken, { appSecret: appSecretFor(slug) });
  const logPath = P.clientFile(slug, "publish_log.json", { forWrite: true });
  let igLimitReached = false;
  const summary = { published: 0, scheduled: 0, errors: 0 };

  for (const item of due) {
    const isIg = item.platform === "instagram";
    if (isIg && igLimitReached) {
      item.error = "skipped — IG 100/day limit reached earlier this run";
      summary.errors++;
      continue;
    }

    try {
      // AI-disclosure / brand-compliance apply to organic posts too — Meta's
      // ai_generated fields never reach the Graph API payload for organic
      // photos/media, so the meta-graph.js chokepoint can't see them; check here
      // against the calendar item itself before anything goes out.
      const disclosureCheck = checkAiDisclosure("create_organic_post", item);
      if (!disclosureCheck.ok) throw new Error(disclosureCheck.reason);
      const brandCheck = checkBrandCompliance("create_organic_post", item, { slug });
      if (!brandCheck.ok) throw new Error(brandCheck.reason);

      let result;
      if (item.platform === "facebook") {
        if (isTbd(pageId)) throw new Error("facebook_page_id is TBD in client_profile");
        result = await publishFacebook(graph, item, pageId, pageToken);
        if (item.schedule_native) {
          item.status = "scheduled";
          summary.scheduled++;
        } else {
          item.status = "published";
          item.published_at = new Date().toISOString();
          summary.published++;
        }
        item.published_id = result.id || result.post_id || null;
      } else if (item.platform === "instagram") {
        if (isTbd(igId)) throw new Error("instagram_business_id is TBD in client_profile");
        result = item.format === "carousel"
          ? await publishInstagramCarousel(graph, item, igId)
          : await publishInstagramSingle(graph, item, igId);
        item.status = "published";
        item.published_id = result.media_id;
        item.published_at = new Date().toISOString();
        summary.published++;
      } else {
        throw new Error(`unknown platform: ${item.platform}`);
      }

      appendFileSync(
        logPath,
        JSON.stringify({ ts: new Date().toISOString(), item_id: item.id, platform: item.platform, format: item.format, published_id: item.published_id }) + "\n"
      );
    } catch (e) {
      item.status = "error";
      item.error = e.message;
      summary.errors++;
      if (isIg && isIgLimitError(e.message)) {
        igLimitReached = true;
        console.error(`[publish] IG 100/day limit hit — stopping further IG publishes`);
      }
      appendFileSync(
        logPath,
        JSON.stringify({ ts: new Date().toISOString(), item_id: item.id, error: e.message }) + "\n"
      );
    }
  }

  // Atomic write of the updated calendar
  const tmpPath = calendarPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(calendar, null, 2));
  renameSync(tmpPath, calendarPath);
  console.error(`[publish] updated ${calendarPath}`);

  console.log(JSON.stringify({
    slug,
    ...summary,
    ig_limit_reached: igLimitReached,
    calendar: calendarPath,
    log: logPath,
  }, null, 2));
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((e) => {
    console.error("[publish] FATAL:", e.message);
    process.exit(1);
  });
}

export { publishFacebook, publishFacebookReel, pollFacebookReel, publishInstagramSingle, publishInstagramCarousel, isDue, isIgLimitError };
