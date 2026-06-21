// scripts/lib/launch_media.js — resolve and attach creative media for /launch.
//
// Before this, /launch built link-only creatives (no image/video), so even when
// a design brief or DAM asset existed, the ad shipped without the chosen visual.
// These helpers let launch upload an asset (or reuse an existing hash/id) and
// attach it to the creative's object_story_spec. Pure helpers are testable;
// resolveAssetMedia does the upload via the shared guarded graph client.

import { imageUploadBody } from "./media_upload.js";

/**
 * Pull a creative-asset reference off a brief creative angle. Supports flat
 * fields (image_hash/image_url/image_path/video_id/video_url) and a nested
 * `asset` object ({media_type, uri, hash}). Returns null when nothing is set.
 */
export function readAssetRef(angle) {
  if (!angle) return null;
  const a = angle.asset || {};
  const isVideo = (a.media_type || "").toLowerCase() === "video" || angle.format === "single_video";
  const ref = {};
  if (angle.image_hash) ref.image_hash = angle.image_hash;
  if (angle.image_url) ref.image_url = angle.image_url;
  if (angle.image_path) ref.image_path = angle.image_path;
  if (angle.video_id) ref.video_id = angle.video_id;
  if (angle.video_url) ref.video_url = angle.video_url;
  if (a.hash && !isVideo) ref.image_hash ??= a.hash; // a video "hash" is not a video_id — image only
  if (a.uri) { if (isVideo) ref.video_url ??= a.uri; else ref.image_url ??= a.uri; }
  return Object.keys(ref).length ? ref : null;
}

/**
 * Merge resolved media ({image_hash} | {video_id}) into a creative payload's
 * object_story_spec. A video_id converts the link_data creative into a
 * video_data creative (carrying over message/title/CTA). Returns a new object;
 * a no-op media leaves the payload untouched.
 */
export function attachMedia(payload, media = {}) {
  if (!media || (!media.image_hash && !media.video_id)) return payload;
  const next = JSON.parse(JSON.stringify(payload));
  const oss = next.object_story_spec || (next.object_story_spec = {});
  if (media.video_id) {
    const ld = oss.link_data || {};
    oss.video_data = {
      video_id: media.video_id,
      message: ld.message || "",
      title: ld.name || "",
      ...(ld.call_to_action ? { call_to_action: ld.call_to_action } : {}),
    };
    delete oss.link_data;
  } else if (media.image_hash) {
    oss.link_data = oss.link_data || {};
    oss.link_data.image_hash = media.image_hash;
  }
  return next;
}

/**
 * Resolve an asset reference to attachable media, uploading when needed.
 * Existing hash/id is reused as-is; a URL or local path is uploaded via the
 * guarded graph client. Returns {} when there's nothing to attach.
 */
export async function resolveAssetMedia(graph, actPath, ref) {
  if (!ref) return {};
  if (ref.image_hash) return { image_hash: ref.image_hash };
  if (ref.video_id) return { video_id: ref.video_id };
  if (ref.image_url || ref.image_path) {
    const body = imageUploadBody({ image_url: ref.image_url, image_path: ref.image_path });
    const res = await graph.post(`/${actPath}/adimages`, body);
    const first = Object.values(res?.images || {})[0];
    if (first?.hash) return { image_hash: first.hash };
    throw new Error("adimages upload returned no hash");
  }
  if (ref.video_url) {
    const res = await graph.post(`/${actPath}/advideos`, { file_url: ref.video_url });
    if (res?.id) return { video_id: res.id };
    throw new Error("advideos upload returned no id");
  }
  return {};
}
