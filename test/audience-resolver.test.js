import { test } from "node:test";
import assert from "node:assert/strict";
import { audienceName, applyResolved, resolvedIdFor, resolveAudiences } from "../scripts/lib/audience-resolver.js";

test("audienceName: deterministic RT name from pixel layer", () => {
  assert.equal(audienceName("blue-rose-auto", { source: "pixel", window_days: 30 }), "smOS blue-rose-auto RT PIXEL 30d");
});
test("audienceName: lookalike name from ratio", () => {
  assert.equal(audienceName("acme", { type: "lookalike", ratio: 0.01 }), "smOS acme LAL 1pct");
});

test("applyResolved: merges without mutating input", () => {
  const map = { clusters: [] };
  const out = applyResolved(map, { RT_PIX_30D: "23842" });
  assert.equal(out.resolved_audiences.RT_PIX_30D, "23842");
  assert.equal(map.resolved_audiences, undefined); // original untouched
});
test("resolvedIdFor: returns real id or null", () => {
  const map = { resolved_audiences: { RT_PIX_30D: "999" } };
  assert.equal(resolvedIdFor(map, { id: "RT_PIX_30D" }), "999");
  assert.equal(resolvedIdFor(map, { id: "MISSING" }), null);
});

test("resolveAudiences: looks up existing by name, does not create when create=false", async () => {
  const calls = { posts: 0 };
  const fakeGraph = {
    act: (id) => `act_${id}`,
    get: async () => ({ data: [{ id: "555", name: "smOS acme RT PIXEL 30d", subtype: "WEBSITE" }] }),
    post: async () => { calls.posts++; return { id: "new" }; },
  };
  const map = { retargeting_layers: [{ id: "RT_PIX_30D", source: "pixel", window_days: 30 }] };
  const r = await resolveAudiences(fakeGraph, "1", map, { slug: "acme", create: false });
  assert.equal(r.resolved.RT_PIX_30D, "555");
  assert.equal(calls.posts, 0); // never created
});

test("resolveAudiences: warns (no throw) when missing and create=false", async () => {
  const fakeGraph = { act: (id) => `act_${id}`, get: async () => ({ data: [] }), post: async () => ({ id: "x" }) };
  const map = { retargeting_layers: [{ id: "RT_PIX_60D", source: "pixel", window_days: 60 }] };
  const r = await resolveAudiences(fakeGraph, "1", map, { slug: "acme", create: false });
  assert.equal(r.resolved.RT_PIX_60D, undefined);
  assert.ok(r.warnings.some((w) => /RT_PIX_60D/.test(w)));
});

test("resolveAudiences: creates pixel audience when create=true + pixelId", async () => {
  let createdBody = null;
  const fakeGraph = {
    act: (id) => `act_${id}`,
    get: async () => ({ data: [] }),
    post: async (path, body) => { createdBody = body; return { id: "777" }; },
  };
  const map = { retargeting_layers: [{ id: "RT_PIX_30D", source: "pixel", window_days: 30 }] };
  const r = await resolveAudiences(fakeGraph, "1", map, { slug: "acme", create: true, pixelId: "PIX1" });
  assert.equal(r.resolved.RT_PIX_30D, "777");
  assert.equal(createdBody.subtype, "WEBSITE");
  assert.match(createdBody.rule, /PIX1/);
});
