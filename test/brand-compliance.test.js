import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrandCompliance, guardGraphWrite, GuardError } from "../scripts/lib/guards.js";

const clientWithAvoid = {
  profile: { slug: "acme", voice: { avoid: ["miracle", "guaranteed", "best ever"] } },
};

test("brand: non-create_ad tool is ignored", () => {
  assert.equal(checkBrandCompliance("create_campaign", { name: "anything miracle" }, clientWithAvoid).ok, true);
});

test("brand: clean on-brand copy passes", () => {
  const r = checkBrandCompliance("create_ad", { primary_text: "Honest auto repair, 30+ years." }, clientWithAvoid);
  assert.equal(r.ok, true);
});

test("brand: client voice.avoid word blocks", () => {
  const r = checkBrandCompliance("create_ad", { primary_text: "Our miracle service!" }, clientWithAvoid);
  assert.equal(r.ok, false);
  assert.match(r.reason, /off-brand language/);
  assert.match(r.reason, /miracle/);
});

test("brand: multi-word avoid phrase blocks", () => {
  const r = checkBrandCompliance("create_ad", { headline: "The best ever shop" }, clientWithAvoid);
  assert.equal(r.ok, false);
  assert.match(r.reason, /best ever/);
});

test("brand: avoid word matched whole-word only (no false positive on substring)", () => {
  // "guaranteed" must not trip on "guarantee-free" style substrings of other words
  const r = checkBrandCompliance("create_ad", { primary_text: "We are miracleworkers nearby" }, clientWithAvoid);
  assert.equal(r.ok, true); // "miracleworkers" is not the word "miracle"
});

test("brand: brand_profile verbal.voice.dont also enforced", () => {
  const ctx = {
    profile: { slug: "acme" },
    brand: { verbal: { voice: { dont: ["cheap"] } } },
  };
  const r = checkBrandCompliance("create_ad", { primary_text: "cheap and fast" }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.reason, /cheap/);
});

// ---- logo/color lock for AI-generated visuals ----

const lockedBrand = {
  visual: {
    logo_approved_at: "2026-06-01T00:00:00Z",
    brand_kit_locked: true,
    colors: { primary: "#0A1F44", secondary: "#FFFFFF", accent: "#E63946", neutrals: ["#888888"] },
    logo: { primary_url: "https://cdn/acme-logo.svg" },
  },
};

test("brand: AI visual on a locked brand must declare brand_kit", () => {
  const ctx = { profile: { slug: "acme" }, brand: lockedBrand };
  const r = checkBrandCompliance("create_ad", { ai_generated: true, primary_text: "On brand." }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.reason, /must declare creative\.brand_kit/);
});

test("brand: AI visual with off-palette color blocks", () => {
  const ctx = { profile: { slug: "acme" }, brand: lockedBrand };
  const r = checkBrandCompliance(
    "create_ad",
    { ai_generated: true, creative: { brand_kit: { colors: ["#00FF00"] } } },
    ctx
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /off-palette colors/);
});

test("brand: AI visual with matching kit + approved logo passes", () => {
  const ctx = { profile: { slug: "acme" }, brand: lockedBrand };
  const r = checkBrandCompliance(
    "create_ad",
    { ai_generated: true, creative: { brand_kit: { colors: ["#0a1f44", "#ffffff"], logo_url: "https://cdn/acme-logo.svg" } } },
    ctx
  );
  assert.equal(r.ok, true);
});

test("brand: AI visual with unapproved logo blocks", () => {
  const ctx = { profile: { slug: "acme" }, brand: lockedBrand };
  const r = checkBrandCompliance(
    "create_ad",
    { ai_generated: true, creative: { brand_kit: { colors: ["#0a1f44"], logo_url: "https://cdn/other.png" } } },
    ctx
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /unapproved logo/);
});

test("brand: human-made visual is not kit-locked even on a locked brand", () => {
  const ctx = { profile: { slug: "acme" }, brand: lockedBrand };
  const r = checkBrandCompliance("create_ad", { primary_text: "Photographer shot." }, ctx);
  assert.equal(r.ok, true);
});

test("brand: AI visual on an UNlocked brand is not kit-enforced (opt-in)", () => {
  delete process.env.SMOS_REQUIRE_BRAND_KIT;
  const unlocked = { visual: { logo_approved_at: "2026-06-01T00:00:00Z", colors: { primary: "#0A1F44" } } };
  const ctx = { profile: { slug: "acme" }, brand: unlocked };
  const r = checkBrandCompliance("create_ad", { ai_generated: true, primary_text: "x" }, ctx);
  assert.equal(r.ok, true);
});

test("brand: SMOS_REQUIRE_BRAND_KIT=1 enforces kit even without brand_kit_locked flag", () => {
  process.env.SMOS_REQUIRE_BRAND_KIT = "1";
  const brand = { visual: { logo_approved_at: "2026-06-01T00:00:00Z", colors: { primary: "#0A1F44" } } };
  const ctx = { profile: { slug: "acme" }, brand };
  const r = checkBrandCompliance("create_ad", { ai_generated: true }, ctx);
  delete process.env.SMOS_REQUIRE_BRAND_KIT;
  assert.equal(r.ok, false);
  assert.match(r.reason, /must declare creative\.brand_kit/);
});

test("chokepoint: clean create_ad with no resolvable client still passes brand-compliance", async () => {
  // No client resolves from act_999 → no avoid list, unlocked brand → brand-compliance must not false-block.
  await assert.doesNotReject(
    guardGraphWrite({
      method: "POST",
      path: "/act_999/ads",
      data: {
        name: "IMG_PAIN_v1",
        link_url: "https://x.com/?utm_source=fb&utm_medium=paid&utm_campaign=c",
        primary_text: "Honest, on-brand auto repair copy.",
      },
    })
  );
});
