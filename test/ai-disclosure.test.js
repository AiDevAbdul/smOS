import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAiDisclosure, guardGraphWrite, GuardError } from "../scripts/lib/guards.js";

test("non-AI ad passes", () => {
  assert.equal(checkAiDisclosure("create_ad", { ai_generated: false }).ok, true);
  assert.equal(checkAiDisclosure("create_ad", {}).ok, true); // no flag, no requirement
});

test("AI-generated WITHOUT disclosure is blocked (fail-closed)", () => {
  const r = checkAiDisclosure("create_ad", { ai_generated: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /AI-content disclosure/);
});

test("AI-generated WITH disclosure passes", () => {
  assert.equal(checkAiDisclosure("create_ad", { ai_generated: true, ai_disclosed: true }).ok, true);
});

test("Advantage+ standard_enhancements counts as AI-generated", () => {
  const input = { creative: { degrees_of_freedom_spec: { creative_features_spec: { standard_enhancements: { enroll_status: "OPT_IN" } } } } };
  assert.equal(checkAiDisclosure("create_ad", input).ok, false);
  input.ai_disclosed = true;
  assert.equal(checkAiDisclosure("create_ad", input).ok, true);
});

test("SMOS_REQUIRE_AI_DISCLOSURE forces an explicit declaration", () => {
  process.env.SMOS_REQUIRE_AI_DISCLOSURE = "1";
  try {
    assert.equal(checkAiDisclosure("create_ad", {}).ok, false);
    assert.equal(checkAiDisclosure("create_ad", { ai_generated: false }).ok, true);
  } finally {
    delete process.env.SMOS_REQUIRE_AI_DISCLOSURE;
  }
});

test("guardGraphWrite blocks an undisclosed AI ad at the chokepoint", async () => {
  await assert.rejects(
    () => guardGraphWrite({
      method: "POST",
      path: "/act_123/ads",
      data: { name: "IMG_PAIN_v1", ai_generated: true, creative: { primary_text: "ok", headline: "ok" } },
      token: "t",
    }),
    (e) => e instanceof GuardError && e.guard === "ai-disclosure"
  );
});
