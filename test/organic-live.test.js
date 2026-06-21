import { test } from "node:test";
import assert from "node:assert/strict";
import { benchmarkFromMedia } from "../scripts/lib/organic_bench.js";
import { mapLiftStudy } from "../scripts/lib/lift_study.js";
import { resolveToken } from "../scripts/lib/tokens.js";

// ---- organic competitor benchmark (listening) ----

test("benchmarkFromMedia: empty media → empty object", () => {
  assert.deepEqual(benchmarkFromMedia([], 1000), {});
  assert.deepEqual(benchmarkFromMedia(undefined, 1000), {});
});

test("benchmarkFromMedia: computes engagement rate, cadence, and top formats", () => {
  const media = [
    { like_count: 100, comments_count: 0, timestamp: "2026-06-01T00:00:00+0000", media_type: "IMAGE" },
    { like_count: 200, comments_count: 100, timestamp: "2026-06-08T00:00:00+0000", media_type: "VIDEO" },
    { like_count: 0, comments_count: 0, timestamp: "2026-06-15T00:00:00+0000", media_type: "IMAGE" },
  ];
  const b = benchmarkFromMedia(media, 10000);
  // avg engagement = (100 + 300 + 0)/3 = 133.33 → /10000 *100 = 1.33
  assert.equal(b.engagement_rate, 1.33);
  // span = 14 days = 2 weeks, 3 posts → 1.5/week
  assert.equal(b.posts_per_week, 1.5);
  assert.deepEqual(b.top_formats, ["IMAGE", "VIDEO"]);
});

test("benchmarkFromMedia: null followers → engagement_rate null (no fabrication)", () => {
  const b = benchmarkFromMedia([{ like_count: 5, comments_count: 1, timestamp: "2026-06-01T00:00:00+0000", media_type: "IMAGE" }], 0);
  assert.equal(b.engagement_rate, null);
});

// ---- lift-study mapping (attribution) ----

test("mapLiftStudy: keeps only cells with a measurable incremental figure", () => {
  const study = {
    id: "s1", name: "Q2 lift",
    cells: { data: [
      { id: "test", name: "Test", results: { incremental_conversions: 120, control_conversions: 80, spend: 5000, incremental_cpa: 41.6, confidence: 0.95 } },
      { id: "ctrl", name: "Control", results: {} }, // no incremental → dropped
    ] },
  };
  const rows = mapLiftStudy(study);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_name, "Test");
  assert.equal(rows[0].incremental_conversions, 120);
  assert.equal(rows[0].last_click_conversions, 80);
  assert.equal(rows[0].confidence, 0.95);
});

test("mapLiftStudy: a still-running / shapeless study yields [] so the caller HALTs", () => {
  assert.deepEqual(mapLiftStudy({ id: "x", cells: { data: [{ id: "a", results: {} }] } }), []);
  assert.deepEqual(mapLiftStudy({}), []);
  assert.deepEqual(mapLiftStudy({ cells: [] }), []);
});

test("mapLiftStudy: accepts lift factor alone (no incremental conversions)", () => {
  const rows = mapLiftStudy({ id: "s", cells: [{ id: "t", lift: 1.4 }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].incrementality_factor, 1.4);
  assert.equal(rows[0].incremental_conversions, null);
});

// ---- new 'user' token kind ----

test("resolveToken: 'user' kind resolves the account/system token via global fallback", () => {
  const prev = process.env.META_ACCESS_TOKEN;
  process.env.META_ACCESS_TOKEN = "sys-tok";
  try {
    const t = resolveToken("user", "acme", {});
    assert.equal(t.token, "sys-tok");
    assert.equal(t.global_fallback, true);
  } finally {
    if (prev === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = prev;
  }
});

test("resolveToken: 'user' kind prefers per-client env over global", () => {
  const prevG = process.env.META_ACCESS_TOKEN;
  const prevC = process.env.META_ACCESS_TOKEN_ACME;
  process.env.META_ACCESS_TOKEN = "global";
  process.env.META_ACCESS_TOKEN_ACME = "acme-specific";
  try {
    assert.equal(resolveToken("user", "acme", {}).token, "acme-specific");
  } finally {
    if (prevG === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = prevG;
    if (prevC === undefined) delete process.env.META_ACCESS_TOKEN_ACME; else process.env.META_ACCESS_TOKEN_ACME = prevC;
  }
});
