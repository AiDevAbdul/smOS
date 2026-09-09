import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDestructive, classifyDeleteTarget, guardGraphWrite, GuardError,
  ORGANIC_DELETABLE, BLOCKED_DELETE_CLASSES,
} from "../scripts/lib/guards.js";
import { createGraph } from "../scripts/lib/meta-graph.js";

// E6: DELETE is split by RESOURCE CLASS. Organic moderation (a comment) is
// allowed; ad structure stays an absolute block; an UNDECLARED delete is
// treated as ad structure (fail-closed).

test("delete: an organic comment delete is allowed when declared", () => {
  const r = checkDestructive({ method: "DELETE", path: "/17841_999", resource: "comment" });
  assert.equal(r.ok, true);
});

test("delete: a campaign delete stays blocked even when declared", () => {
  const r = checkDestructive({ method: "DELETE", path: "/120000", resource: "campaign" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /archive instead/);
});

test("delete: an UNDECLARED delete is blocked (never inferred from a bare id)", () => {
  const r = checkDestructive({ method: "DELETE", path: "/120000" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no declared resource class/);
});

test("delete: an automated rule is blocked with its own reason, not 'unclassified'", () => {
  const r = checkDestructive({ method: "DELETE", path: "/555", resource: "ad_rule" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /governs live spend/);
});

test("delete: SMOS_ALLOW_DELETE=1 still overrides everything", () => {
  process.env.SMOS_ALLOW_DELETE = "1";
  try {
    assert.equal(checkDestructive({ method: "DELETE", path: "/120000", resource: "campaign" }).ok, true);
  } finally {
    delete process.env.SMOS_ALLOW_DELETE;
  }
});

test("delete: unambiguous path suffixes are the only inference we trust", () => {
  assert.equal(classifyDeleteTarget({ path: "/123/comments" }), "comment");
  assert.equal(classifyDeleteTarget({ path: "/act_1/campaigns" }), "campaign");
  assert.equal(classifyDeleteTarget({ path: "/999" }), "unknown");
  // An explicit declaration always wins over the path.
  assert.equal(classifyDeleteTarget({ path: "/act_1/campaigns", resource: "comment" }), "comment");
});

test("delete: the two class sets do not overlap", () => {
  for (const c of ORGANIC_DELETABLE) assert.equal(BLOCKED_DELETE_CLASSES.has(c), false, c);
});

test("chokepoint: guardGraphWrite honors the declared class", async () => {
  await guardGraphWrite({ method: "DELETE", path: "/1_2", resource: "comment" }); // resolves
  await assert.rejects(() => guardGraphWrite({ method: "DELETE", path: "/1_2" }), GuardError);
});

test("meta-graph: graph.delete passes the resource class through to the guard", async () => {
  const calls = [];
  const http = async (config) => { calls.push(config); return { data: { success: true } }; };
  const g = createGraph("t", { http, baseDelayMs: 0, sleep: async () => {} });

  const res = await g.delete("/1_2", undefined, { resource: "comment" });
  assert.deepEqual(res, { success: true });
  assert.equal(calls.length, 1);

  // Same call without the declaration never reaches HTTP.
  await assert.rejects(() => g.delete("/1_2"), /destructive-guard BLOCKED/);
  assert.equal(calls.length, 1);
});
