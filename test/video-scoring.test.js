import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { computeVideoScore } from "../scripts/lib/video_scoring.js";
import { makeClient, cleanup, runSkill, readClientJson, clientPath } from "./helpers/pipeline.js";

// B3 — score video creative on hook + retention, not thumbnail.

test("strong hook + retention scores high and reads as a scaling candidate", () => {
  const s = computeVideoScore({
    impressions: 1000, video_3s_views: 300, video_plays: 300,
    p75: 150, p100: 60, avg_time_watched_sec: 12, video_length_sec: 20,
  });
  assert.equal(s.hook_rate, 30); // 300/1000
  assert.equal(s.hold_rate, 50); // 150/300
  assert.equal(s.completion_rate, 20);
  assert.ok(s.score >= 7, `expected strong score, got ${s.score}`);
  assert.match(s.diagnosis, /scaling candidate/);
});

test("weak hook scores low and diagnoses the hook", () => {
  const s = computeVideoScore({
    impressions: 1000, video_3s_views: 50, video_plays: 50, p75: 5, p100: 1,
  });
  assert.ok(s.score < 4, `expected weak score, got ${s.score}`);
  assert.match(s.diagnosis, /weak hook/);
});

test("good hook but retention collapse is diagnosed at the midpoint", () => {
  const s = computeVideoScore({
    impressions: 1000, video_3s_views: 300, video_plays: 300, p75: 30, p100: 5,
  });
  assert.match(s.diagnosis, /retention collapses/);
});

test("missing metrics degrade to null, never NaN", () => {
  const s = computeVideoScore({});
  assert.equal(s.hook_rate, null);
  assert.equal(s.hold_rate, null);
  assert.equal(s.score, null);
  assert.match(s.diagnosis, /no video metrics/);
});

test("aggregate ranks a strong video above a mediocre image and reports retention", () => {
  const SLUG = "__it_video_audit";
  try {
    const strongVideoScore = computeVideoScore({
      impressions: 1000, video_3s_views: 350, video_plays: 350, p75: 200, p100: 90,
    });
    const assets = {
      client_slug: SLUG,
      assets: [
        {
          asset_id: "vid_1", type: "ad", format: "video", permalink: null,
          copy: "Watch this", restricted_word_hits: [],
          video_score: strongVideoScore,
          vision_scores: { visual_quality: null, brand_consistency: null, cta_present: null, text_density_pct: null, messaging_clarity: null, notes: null },
        },
        {
          asset_id: "img_1", type: "ad", format: "image", permalink: null,
          copy: "Buy now", restricted_word_hits: [],
          video_score: null,
          vision_scores: { visual_quality: 5, brand_consistency: 5, cta_present: true, text_density_pct: 10, messaging_clarity: 5, notes: "ok" },
        },
      ],
    };
    makeClient(SLUG, {});
    writeFileSync(clientPath(SLUG, "creative_assets.json"), JSON.stringify(assets, null, 2));

    const r = runSkill("skills/audit-creative/audit-creative.js", SLUG, "aggregate");
    assert.equal(r.status, 0, `aggregate failed:\n${r.stderr}`);

    const summary = readClientJson(SLUG, "creative_audit_summary.json");
    assert.equal(summary.formats.video.count, 1);
    assert.ok(summary.formats.video.avg_retention_score != null, "video retention score missing from summary");
    assert.equal(summary.formats.video.avg_hook_rate_pct, 35); // 350/1000
    // The strong video must top the ranking over the average image.
    assert.equal(summary.top3[0].asset_id, "vid_1", "strong video should rank #1");
  } finally {
    cleanup(SLUG);
  }
});
