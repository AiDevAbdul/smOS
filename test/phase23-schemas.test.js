import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inboxItem, contentPlan, attributionReport, asset, listeningSnapshot,
} from "../schemas/index.js";

// ---------------- inbox_item ----------------
test("inboxItem.normalize coerces aliases + builds a stable inbox_id", () => {
  const n = inboxItem.normalize({ items: [{ network: "instagram", kind: "comment", comment_id: "c1", message: "hi" }] });
  const it = n.items[0];
  assert.equal(it.platform, "instagram");
  assert.equal(it.type, "comment");
  assert.equal(it.external_id, "c1");
  assert.equal(it.inbox_id, "instagram:comment:c1");
  assert.equal(it.text, "hi");
});

test("inboxItem.validate rejects missing external_id", () => {
  const r = inboxItem.validate({ items: [{ platform: "facebook", type: "dm" }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /external_id/);
});

test("inboxItem.validateReply is fail-closed on empty + un-approved auto", () => {
  assert.equal(inboxItem.validateReply({ draft_reply: "" }).ok, false);
  assert.equal(inboxItem.validateReply({ external_id: "x", draft_reply: "thanks!", auto_reply: true }).ok, false);
  assert.equal(inboxItem.validateReply({ external_id: "x", draft_reply: "thanks!", auto_reply: true }, { allowAuto: true }).ok, true);
});

// ---------------- content_plan ----------------
test("contentPlan.normalize maps caption→message + keeps publish fields", () => {
  const n = contentPlan.normalize({ items: [{ id: "p1", network: "instagram", type: "reels", caption: "hey", scheduled_for: "2026-07-01T13:00:00Z" }] });
  const it = n.items[0];
  assert.equal(it.platform, "instagram");
  assert.equal(it.format, "reels");
  assert.equal(it.message, "hey");
  assert.equal(it.publish_at, "2026-07-01T13:00:00Z");
});

test("contentPlan.validate requirePublishable catches missing media", () => {
  const bad = { items: [{ id: "p1", platform: "instagram", format: "reels", publish_at: "2026-07-01T13:00:00Z", message: "x" }] };
  const r = contentPlan.validate(bad, { requirePublishable: true });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /video_url/);
});

// ---------------- attribution_report ----------------
test("attributionReport.validate requires a method", () => {
  const r = attributionReport.validate({ rows: [{ entity_id: "1", incremental_conversions: 5 }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /method/);
});

test("attributionReport.validate rejects rows with no incremental figure", () => {
  const r = attributionReport.validate({ method: "meta_lift_study", rows: [{ entity_id: "1", last_click_conversions: 10 }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /no incremental figure/);
});

test("attributionReport valid when method + incremental present", () => {
  const r = attributionReport.validate({ method: "geo_holdout", rows: [{ entity_id: "1", incremental_conversions: 7, incremental_cpa: 12 }] });
  assert.equal(r.ok, true);
});

// ---------------- asset ----------------
test("asset.validate enforces AI disclosure at the source", () => {
  const bad = asset.validate({ asset_id: "a1", media_type: "video", uri: "https://x/v.mp4", ai_generated: true });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /ai_disclosed/);
  const good = asset.validate({ asset_id: "a1", media_type: "video", uri: "https://x/v.mp4", ai_generated: true, ai_disclosed: true });
  assert.equal(good.ok, true);
});

// ---------------- listening_snapshot ----------------
test("listeningSnapshot.validate requires timestamp + content", () => {
  assert.equal(listeningSnapshot.validate({ competitors: [{ handle: "x" }] }).ok, false); // no captured_at
  assert.equal(listeningSnapshot.validate({ captured_at: "2026-06-21T00:00:00Z" }).ok, false); // empty
  assert.equal(listeningSnapshot.validate({ captured_at: "2026-06-21T00:00:00Z", competitors: [{ handle: "x" }] }).ok, true);
});
