import { test } from "node:test";
import assert from "node:assert/strict";
import { contentPlan as schema } from "../schemas/index.js";
import { buildPlan } from "../skills/content-plan/content-plan.js";

const profile = {
  business: { niche: "dental" },
  voice: { keywords: ["whitening", "implants", "checkups"] },
};

// Turn the placeholder skeleton into a genuinely publishable plan by attaching
// the per-format media each item needs — the same enrichment the creative agent
// performs before the publishable gate is meant to pass.
function makePublishable(plan) {
  return {
    ...plan,
    items: plan.items.map((it) => {
      const e = { ...it };
      if (it.format === "image") e.image_url = "https://cdn.example/i.jpg";
      if (it.format === "video" || it.format === "reels") e.video_url = "https://cdn.example/v.mp4";
      return e;
    }),
  };
}

test("buildPlan produces a structurally-valid skeleton", () => {
  const plan = buildPlan({ profile, slug: "acme", weeks: 2, from: new Date("2026-06-01T00:00:00Z") });
  assert.ok(plan.pillars.length >= 3);
  assert.equal(plan.items.length, 6); // 3 posts/week * 2 weeks
  // Structural (non-publishable) validation passes for the raw skeleton.
  assert.equal(schema.validate(plan, { requirePublishable: false }).ok, true);
});

test("an enriched plan passes the publishable gate", () => {
  const plan = makePublishable(buildPlan({ profile, slug: "acme", weeks: 2, from: new Date("2026-06-01T00:00:00Z") }));
  const v = schema.validate(plan, { requirePublishable: true });
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("the raw skeleton FAILS the publishable gate (would HALT, not warn)", () => {
  // This is the doc↔code gap being closed: the default run validates with
  // requirePublishable:true, so a plan missing media URLs must fail closed.
  const plan = buildPlan({ profile, slug: "acme", weeks: 1, from: new Date("2026-06-01T00:00:00Z") });
  const v = schema.validate(plan, { requirePublishable: true });
  assert.equal(v.ok, false);
  // Error must name the failing field so the HALT message is actionable.
  assert.ok(v.errors.some((e) => /video_url|image_url/.test(e)), v.errors.join("; "));
});

test("a plan with a corrupt item fails the publishable gate naming the field", () => {
  const plan = makePublishable(buildPlan({ profile, slug: "acme", weeks: 1, from: new Date("2026-06-01T00:00:00Z") }));
  // Break one item the way bad enrichment would: drop the required publish_at.
  plan.items[0].publish_at = null;
  const v = schema.validate(plan, { requirePublishable: true });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /publish_at/.test(e)), v.errors.join("; "));
});
