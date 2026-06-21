import { test } from "node:test";
import assert from "node:assert/strict";
import { brandProfile } from "../schemas/index.js";
import { checkZeroStartPrereqs } from "../scripts/lib/guards.js";

// A fully-built brand profile with all three gates stamped — the baseline we
// selectively break to prove each gate is load-bearing.
function completeBrand() {
  return {
    client_slug: "acme",
    strategy: {
      purpose: "p", mission: "m", vision: "v", values: ["bold", "honest"],
      archetype_primary: "sage",
      value_proposition: "vp", differentiation: "d",
      positioning_statement: "For X who Y, Acme is the Z that W, because R.",
      positioning_approved_at: "2026-06-21T00:00:00Z",
    },
    verbal: {
      name: "Acme", tagline: "t",
      name_screening: { attorney_clearance_flagged: true },
      name_approved_at: "2026-06-21T01:00:00Z",
    },
    visual: {
      logo: { primary_url: "acme.svg" },
      colors: { primary: "#111" },
      typography: { heading: "Inter" },
      logo_approved_at: "2026-06-21T02:00:00Z",
    },
    social: {
      profile_picture_url: "pfp.png",
      bios: { instagram: "Acme · we do X · link below" },
    },
  };
}

// ---------- normalize ----------
test("brand_profile normalize defaults status=draft and coerces archetype shape", () => {
  const n = brandProfile.normalize({ client_slug: "x", strategy: { archetype_primary: "hero" } });
  assert.equal(n.status, "draft");
  assert.equal(n.strategy.archetype.primary, "hero");
  assert.equal(n.visual.ai_generated, false); // explicit-flag, defaults false
  assert.deepEqual(n.strategy.values, []);
});

test("brand_profile normalize accepts aliased field names", () => {
  const n = brandProfile.normalize({
    slug: "x",
    strategy: { positioning: "pos", pillars: ["a"], value_prop: "vp" },
    verbal: { brand_name: "Nm" },
  });
  assert.equal(n.client_slug, "x");
  assert.equal(n.strategy.positioning_statement, "pos");
  assert.deepEqual(n.strategy.messaging_pillars, ["a"]);
  assert.equal(n.strategy.value_proposition, "vp");
  assert.equal(n.verbal.name, "Nm");
});

// ---------- stage gates (the load-bearing guarantee) ----------
test("strategy stage requires positioning_statement + values + valid archetype", () => {
  const v = brandProfile.validate({ strategy: { values: [], archetype_primary: "wizard" } }, { stage: "strategy" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("positioning_statement")));
  assert.ok(v.errors.some((e) => e.includes("values is empty")));
  assert.ok(v.errors.some((e) => e.includes("archetype")));
});

test("GATE 1: /brand-name (verbal stage) refuses until positioning is approved", () => {
  const b = completeBrand();
  b.strategy.positioning_approved_at = null; // un-stamp gate 1
  const v = brandProfile.validate(b, { stage: "verbal" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("positioning_approved_at")), v.errors.join("; "));
});

test("GATE 2: /brand-visual refuses until the name is approved", () => {
  const b = completeBrand();
  b.verbal.name_approved_at = null; // un-stamp gate 2
  const v = brandProfile.validate(b, { stage: "visual" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("name_approved_at")), v.errors.join("; "));
});

test("GATE 3: /brand-book + /brand-social refuse until the logo is approved", () => {
  const b = completeBrand();
  b.visual.logo_approved_at = null; // un-stamp gate 3
  for (const stage of ["guidelines", "social"]) {
    const v = brandProfile.validate(b, { stage });
    assert.equal(v.ok, false, `stage ${stage} should fail`);
    assert.ok(v.errors.some((e) => e.includes("logo_approved_at")), v.errors.join("; "));
  }
});

test("a fully-gated, fully-filled brand profile validates at every stage", () => {
  const b = completeBrand();
  for (const stage of ["strategy", "verbal", "visual", "guidelines", "social", "complete"]) {
    const v = brandProfile.validate(b, { stage });
    assert.equal(v.ok, true, `stage ${stage} failed: ${v.errors.join("; ")}`);
  }
});

test("visual stage names the missing asset fields when a gate IS cleared", () => {
  const b = completeBrand();
  b.visual.colors.primary = null; // logo gate stamped, but a field is missing
  const v = brandProfile.validate(b, { stage: "visual" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes("colors.primary")));
  // gate itself is fine — no gate error
  assert.ok(!v.errors.some((e) => e.includes("name_approved_at")));
});

// ---------- checkZeroStartPrereqs ----------
test("checkZeroStartPrereqs names every missing asset with a fix", () => {
  const r = checkZeroStartPrereqs({ accounts: {} }, { need: ["page", "ig", "ad_account", "pixel"] });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 4);
  assert.ok(r.missing.every((m) => m.fix && m.label));
  assert.ok(r.message.includes("Facebook Page"));
});

test("checkZeroStartPrereqs treats TBD placeholders as missing", () => {
  const profile = { accounts: { facebook_page_id: "TBD_FB_PAGE_ID", ad_account_id: "act_123" } };
  const r = checkZeroStartPrereqs(profile, { need: ["page", "ad_account"] });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].asset, "page");
});

test("checkZeroStartPrereqs passes when required assets are real", () => {
  const profile = { accounts: { facebook_page_id: "123", ad_account_id: "act_9", pixel_id: "p1" } };
  const r = checkZeroStartPrereqs(profile, { need: ["page", "ad_account", "pixel"] });
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
});

test("checkZeroStartPrereqs only checks the assets a caller needs", () => {
  // /publish needs page but not pixel — a missing pixel must NOT block it.
  const profile = { accounts: { facebook_page_id: "123" } };
  const r = checkZeroStartPrereqs(profile, { need: ["page"] });
  assert.equal(r.ok, true);
});
