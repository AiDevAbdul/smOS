// scripts/lib/media_upload.js — build the POST bodies for Meta media uploads.
//
// /adimages accepts either a hosted `url` or raw `bytes` (base64). /advideos
// accepts a hosted `file_url` or a multipart `source` (handled in ads.js, since
// it needs FormData). These pure builders keep the param logic testable and out
// of the MCP handler.

import { readFileSync } from "node:fs";

/**
 * Build the body for POST /act_X/adimages.
 * Source priority: explicit base64 bytes → local file path (read+base64) → URL.
 * Exactly one source must resolve.
 */
export function imageUploadBody({ image_url, image_bytes, image_path } = {}) {
  if (image_bytes) return { bytes: image_bytes };
  if (image_path) return { bytes: readFileSync(image_path).toString("base64") };
  if (image_url) return { url: image_url };
  throw new Error("upload_image requires one of: image_url, image_bytes (base64), or image_path");
}

/**
 * Build the body for a URL-based POST /act_X/advideos (Meta fetches the file).
 * Returns null when no URL is given, signalling the caller to fall back to a
 * multipart file upload from video_path.
 */
export function videoUploadBodyFromUrl({ video_url, title, name } = {}) {
  if (!video_url) return null;
  const body = { file_url: video_url };
  if (title) body.title = title;
  if (name) body.name = name;
  return body;
}
