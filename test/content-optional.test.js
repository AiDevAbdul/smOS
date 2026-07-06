import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../skills/content-plan/content-plan.js";
import { normalizeContentPreferences } from "../schemas/client_profile.js";

// AI content production is OPT-IN: clients with their own team (or who don't want
// AI content) get the calendar structure but no AI-written captions.

const FROM = new Date("2026-07-01T00:00:00Z");

test("default profile is ai_assisted (AI drafts captions)", () => {
  const prefs = normalizeContentPreferences(undefined);
  assert.equal(prefs.mode, "ai_assisted");
  assert.equal(prefs.ai_captions, true);
  const plan = buildPlan({ profile: {}, slug: "acme", weeks: 1, from: FROM });
  assert.ok(plan.items.length > 0);
  assert.ok(plan.items.every((i) => i.produced_by === "smos_ai"));
});

test("client_team mode plans the calendar but hands copy to the client", () => {
  const profile = { content_preferences: normalizeContentPreferences({ mode: "client_team" }) };
  const plan = buildPlan({ profile, slug: "acme", weeks: 1, from: FROM });
  // Calendar structure is still produced...
  assert.ok(plan.items.length > 0, "calendar should still be planned");
  assert.ok(plan.pillars.length > 0);
  // ...but every item is flagged client-produced and the caption is a handoff, not AI copy.
  assert.ok(plan.items.every((i) => i.produced_by === "client_team"));
  assert.ok(plan.items.every((i) => /client team to write/i.test(i.message)));
  // SEO keyword intent survives so the client's team still has direction.
  assert.ok(plan.items.every((i) => i.keywords.length > 0));
});

test("ai_off mode also withholds AI captions", () => {
  const profile = { content_preferences: normalizeContentPreferences({ mode: "ai_off" }) };
  const plan = buildPlan({ profile, slug: "acme", weeks: 1, from: FROM });
  assert.ok(plan.items.every((i) => i.produced_by === "client_team"));
});

test("explicit ai_captions:false overrides an otherwise ai_assisted mode", () => {
  const prefs = normalizeContentPreferences({ mode: "ai_assisted", ai_captions: false });
  assert.equal(prefs.ai_captions, false);
});
