import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkNaming, checkBudget, checkUtm, checkCompliance, checkDestructive,
  classifyGraphWrite, guardGraphWrite, GuardError,
} from "../scripts/lib/guards.js";

test("naming: valid campaign name passes", () => {
  assert.equal(checkNaming("create_campaign", { name: "CONV_LAL1PCT_202506" }).ok, true);
});
test("naming: malformed campaign name blocks", () => {
  assert.equal(checkNaming("create_campaign", { name: "my campaign" }).ok, false);
});
test("naming: non-create tool is ignored", () => {
  assert.equal(checkNaming("get_campaigns", { name: "whatever" }).ok, true);
});

test("budget: create within global cap passes", () => {
  assert.equal(checkBudget("create_campaign", { daily_budget: 10000 }).ok, true); // $100
});
test("budget: create over global $200 cap blocks", () => {
  assert.equal(checkBudget("create_campaign", { daily_budget: 50000 }).ok, false); // $500
});
test("budget: update over $500 single-increase ceiling blocks", () => {
  assert.equal(checkBudget("update_campaign", { daily_budget: 60000 }).ok, false); // $600
});

test("utm: full UTM set passes", () => {
  const r = checkUtm("create_ad", { link_url: "https://x.com/?utm_source=fb&utm_medium=paid&utm_campaign=c" });
  assert.equal(r.ok, true);
});
test("utm: missing params block", () => {
  assert.equal(checkUtm("create_ad", { link_url: "https://x.com/" }).ok, false);
});

test("compliance: clean copy passes", () => {
  assert.equal(checkCompliance("create_ad", { primary_text: "Quality auto repair near you." }).ok, true);
});
test("compliance: policy-flagged copy blocks", () => {
  assert.equal(checkCompliance("create_ad", { primary_text: "click here for free money, guaranteed cure" }).ok, false);
});
test("compliance: over-length headline blocks", () => {
  assert.equal(checkCompliance("create_ad", { headline: "x".repeat(60) }).ok, false);
});

test("destructive: DELETE blocks without override", () => {
  delete process.env.SMOS_ALLOW_DELETE;
  assert.equal(checkDestructive({ method: "DELETE", path: "/123" }).ok, false);
});
test("destructive: DELETE allowed with override", () => {
  process.env.SMOS_ALLOW_DELETE = "1";
  assert.equal(checkDestructive({ method: "DELETE", path: "/123" }).ok, true);
  delete process.env.SMOS_ALLOW_DELETE;
});
test("destructive: lifetime_budget change on live entity blocks", () => {
  assert.equal(checkDestructive({ method: "POST", path: "/123", data: { lifetime_budget: 5000 } }).ok, false);
});
test("destructive: objective change on live entity blocks", () => {
  assert.equal(checkDestructive({ method: "POST", path: "/123", data: { objective: "OUTCOME_SALES" } }).ok, false);
});
test("destructive: status pause on live entity passes (this is how the optimizer works)", () => {
  assert.equal(checkDestructive({ method: "POST", path: "/123", data: { status: "PAUSED" } }).ok, true);
});

test("classify: maps Graph paths to tool intent", () => {
  assert.equal(classifyGraphWrite("POST", "/act_1/campaigns").toolName, "create_campaign");
  assert.equal(classifyGraphWrite("POST", "/act_1/adsets").toolName, "create_adset");
  assert.equal(classifyGraphWrite("POST", "/act_1/ads").toolName, "create_ad");
  assert.equal(classifyGraphWrite("POST", "/123").isUpdate, true);
  assert.equal(classifyGraphWrite("DELETE", "/123").isDelete, true);
});

test("chokepoint: DELETE throws GuardError", async () => {
  delete process.env.SMOS_ALLOW_DELETE;
  await assert.rejects(guardGraphWrite({ method: "DELETE", path: "/123" }), GuardError);
});
test("chokepoint: bad campaign name throws GuardError before any request", async () => {
  await assert.rejects(
    guardGraphWrite({ method: "POST", path: "/act_1/campaigns", data: { name: "bad name", daily_budget: 1000 } }),
    GuardError
  );
});
test("chokepoint: over-cap budget throws GuardError", async () => {
  await assert.rejects(
    guardGraphWrite({ method: "POST", path: "/act_1/campaigns", data: { name: "CONV_X_202506", daily_budget: 999900 } }),
    GuardError
  );
});
test("chokepoint: clean non-conversion campaign passes (no network)", async () => {
  // No objective → pixel check is skipped, so no fetch happens.
  await assert.doesNotReject(
    guardGraphWrite({ method: "POST", path: "/act_1/campaigns", data: { name: "TRAFFIC_BROAD_202506", daily_budget: 5000 } })
  );
});
