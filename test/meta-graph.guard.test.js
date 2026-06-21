import { test } from "node:test";
import assert from "node:assert/strict";
import { createGraph } from "../scripts/lib/meta-graph.js";
import { GuardError } from "../scripts/lib/guards.js";

// These assert the guard fires BEFORE any HTTP request. If the guard let the call
// through, axios would attempt a real network call to graph.facebook.com with a
// dummy token; instead each should throw GuardError synchronously-ish (pre-request).

test("meta-graph: delete() is blocked at the chokepoint", async () => {
  delete process.env.SMOS_ALLOW_DELETE;
  const graph = createGraph("dummy-token");
  await assert.rejects(graph.delete("/123456"), GuardError);
});

test("meta-graph: post() of over-cap campaign is blocked before request", async () => {
  const graph = createGraph("dummy-token");
  await assert.rejects(
    graph.post("/act_1/campaigns", { name: "CONV_X_202506", daily_budget: 999900 }),
    GuardError
  );
});

test("meta-graph: post() with bad name is blocked before request", async () => {
  const graph = createGraph("dummy-token");
  await assert.rejects(
    graph.post("/act_1/campaigns", { name: "not valid", daily_budget: 1000 }),
    GuardError
  );
});

test("meta-graph: lifetime_budget change on live entity is blocked", async () => {
  const graph = createGraph("dummy-token");
  await assert.rejects(
    graph.post("/123456", { lifetime_budget: 100000 }),
    GuardError
  );
});
