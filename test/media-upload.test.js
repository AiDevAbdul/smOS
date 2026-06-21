import { test } from "node:test";
import assert from "node:assert/strict";
import { imageUploadBody, videoUploadBodyFromUrl } from "../scripts/lib/media_upload.js";
import { readAssetRef, attachMedia, resolveAssetMedia } from "../scripts/lib/launch_media.js";
import * as ads from "../mcp/meta-server/tools/ads.js";

// fake guarded client that records calls
function mockClient() {
  const calls = [];
  return {
    calls,
    act: (id) => `act_${String(id).replace(/^act_/, "")}`,
    post: async (path, body) => { calls.push({ path, body }); return { mock: true, path }; },
    get: async () => ({}),
  };
}

// ---- media_upload body builders ----

test("imageUploadBody: base64 bytes preferred, then path, then url", () => {
  assert.deepEqual(imageUploadBody({ image_bytes: "QUJD" }), { bytes: "QUJD" });
  assert.deepEqual(imageUploadBody({ image_url: "https://x/y.jpg" }), { url: "https://x/y.jpg" });
});

test("imageUploadBody: throws when no source", () => {
  assert.throws(() => imageUploadBody({}), /requires one of/);
});

test("videoUploadBodyFromUrl: builds file_url body or null", () => {
  assert.deepEqual(videoUploadBodyFromUrl({ video_url: "https://x/v.mp4", title: "T" }), { file_url: "https://x/v.mp4", title: "T" });
  assert.equal(videoUploadBodyFromUrl({}), null);
});

// ---- MCP ads handlers ----

test("upload_image handler: base64 → POST /adimages with bytes", async () => {
  const c = mockClient();
  await ads.handle("upload_image", { ad_account_id: "123", image_bytes: "QUJD" }, c);
  assert.equal(c.calls[0].path, "/act_123/adimages");
  assert.deepEqual(c.calls[0].body, { bytes: "QUJD" });
});

test("upload_video handler: url → POST /advideos with file_url", async () => {
  const c = mockClient();
  await ads.handle("upload_video", { ad_account_id: "123", video_url: "https://x/v.mp4" }, c);
  assert.equal(c.calls[0].path, "/act_123/advideos");
  assert.deepEqual(c.calls[0].body, { file_url: "https://x/v.mp4" });
});

test("upload_video handler: no source throws", async () => {
  await assert.rejects(ads.handle("upload_video", { ad_account_id: "123" }, mockClient()), /requires video_url or video_path/);
});

// ---- launch media helpers ----

test("readAssetRef: reads flat fields and nested asset object", () => {
  assert.deepEqual(readAssetRef({ image_hash: "abc" }), { image_hash: "abc" });
  assert.deepEqual(readAssetRef({ asset: { uri: "https://x/i.jpg" } }), { image_url: "https://x/i.jpg" });
  assert.deepEqual(readAssetRef({ format: "single_video", asset: { media_type: "video", uri: "https://x/v.mp4" } }), { video_url: "https://x/v.mp4" });
  assert.equal(readAssetRef({}), null);
});

test("attachMedia: image_hash injected into link_data", () => {
  const p = { name: "c", object_story_spec: { page_id: "1", link_data: { message: "hi", link: "https://x" } } };
  const out = attachMedia(p, { image_hash: "H" });
  assert.equal(out.object_story_spec.link_data.image_hash, "H");
  // original untouched (pure)
  assert.equal(p.object_story_spec.link_data.image_hash, undefined);
});

test("attachMedia: video_id converts link_data → video_data", () => {
  const p = { name: "c", object_story_spec: { page_id: "1", link_data: { message: "hi", name: "Head", call_to_action: { type: "SHOP_NOW" } } } };
  const out = attachMedia(p, { video_id: "V1" });
  assert.equal(out.object_story_spec.link_data, undefined);
  assert.deepEqual(out.object_story_spec.video_data, { video_id: "V1", message: "hi", title: "Head", call_to_action: { type: "SHOP_NOW" } });
});

test("attachMedia: empty media is a no-op (same object)", () => {
  const p = { name: "c", object_story_spec: {} };
  assert.equal(attachMedia(p, {}), p);
});

test("resolveAssetMedia: existing hash reused without upload", async () => {
  const c = mockClient();
  assert.deepEqual(await resolveAssetMedia(c, "act_1", { image_hash: "H" }), { image_hash: "H" });
  assert.equal(c.calls.length, 0);
});

test("resolveAssetMedia: image_url uploads and returns hash", async () => {
  const c = mockClient();
  c.post = async (path, body) => { c.calls.push({ path, body }); return { images: { bytes: { hash: "NEWHASH" } } }; };
  const media = await resolveAssetMedia(c, "act_1", { image_url: "https://x/i.jpg" });
  assert.deepEqual(media, { image_hash: "NEWHASH" });
  assert.equal(c.calls[0].path, "/act_1/adimages");
});

test("resolveAssetMedia: video_url uploads and returns video_id", async () => {
  const c = mockClient();
  c.post = async () => ({ id: "VID123" });
  assert.deepEqual(await resolveAssetMedia(c, "act_1", { video_url: "https://x/v.mp4" }), { video_id: "VID123" });
});

test("resolveAssetMedia: null ref → {}", async () => {
  assert.deepEqual(await resolveAssetMedia(mockClient(), "act_1", null), {});
});
