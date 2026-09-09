import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHex, relativeLuminance, contrastRatio, wcagLevel, readableOn, checkPalette,
} from "../scripts/lib/contrast.js";
import { checkBrandContrast } from "../scripts/lib/guards.js";

test("contrast: known WCAG anchors", () => {
  // Black on white is the maximum defined ratio.
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  // Symmetric.
  assert.equal(contrastRatio("#29ABE2", "#000000"), contrastRatio("#000000", "#29ABE2"));
  // Luminance endpoints.
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
});

test("contrast: shorthand + hashless hex parse, garbage returns null", () => {
  assert.deepEqual(parseHex("#fff"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex("29ABE2"), { r: 41, g: 171, b: 226 });
  assert.equal(parseHex("not-a-color"), null);
  assert.equal(contrastRatio("nope", "#fff"), null);
});

test("contrast: level bands", () => {
  assert.equal(wcagLevel(21), "AAA");
  assert.equal(wcagLevel(4.6), "AA");
  assert.equal(wcagLevel(3.2), "AA-large");
  assert.equal(wcagLevel(2.9), "fail");
});

test("contrast: readableOn picks the legible ink", () => {
  assert.equal(readableOn("#ffffff"), "#000000");
  assert.equal(readableOn("#111111"), "#ffffff");
});

test("palette: primary passes when it clears 4.5:1 on any of its own neutrals", () => {
  // #29ABE2 fails on white (2.62) but passes on black (7.21) — the brand has a
  // legible pairing, so it is usable.
  const r = checkPalette({ primary: "#29ABE2", neutrals: ["#FFFFFF", "#000000"] });
  assert.equal(r.ok, true);
  assert.equal(r.failures.length, 0);
  assert.ok(r.pairs.some((p) => p.pass));
});

test("palette: primary with NO legible neutral fails", () => {
  const r = checkPalette({ primary: "#F5D76E", neutrals: ["#FFFFFF", "#F5F5F7"] });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /colors\.primary/);
  assert.match(r.message, /needs 4\.5:1/);
});

test("palette: no neutrals declared → measured against plain white", () => {
  assert.equal(checkPalette({ primary: "#111111" }).ok, true);
  assert.equal(checkPalette({ primary: "#EEEEEE" }).ok, false);
  assert.deepEqual(checkPalette({ primary: "#111111" }).backgrounds, ["#ffffff"]);
});

test("palette: secondary/accent are warnings, never blocks", () => {
  const r = checkPalette({ primary: "#111111", secondary: "#F5D76E", accent: "#EEEEEE" });
  assert.equal(r.ok, true);
  assert.equal(r.failures.length, 0);
  assert.equal(r.warnings.length, 2);
});

test("palette: an unparseable primary is a failure, not a silent pass", () => {
  const r = checkPalette({ primary: "rebeccapurple" });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /not a valid hex/);
});

test("guard: checkBrandContrast blocks a low-contrast brand", () => {
  const brand = { visual: { colors: { primary: "#F5D76E", neutrals: ["#FFFFFF"] } } };
  const r = checkBrandContrast(brand);
  assert.equal(r.ok, false);
  assert.match(r.reason, /contrast-guard BLOCKED/);
});

test("guard: SMOS_ALLOW_LOW_CONTRAST=1 overrides but says so", () => {
  const brand = { visual: { colors: { primary: "#F5D76E", neutrals: ["#FFFFFF"] } } };
  process.env.SMOS_ALLOW_LOW_CONTRAST = "1";
  try {
    const r = checkBrandContrast(brand);
    assert.equal(r.ok, true);
    assert.equal(r.overridden, true);
    assert.match(r.reason, /OVERRIDDEN/);
  } finally {
    delete process.env.SMOS_ALLOW_LOW_CONTRAST;
  }
});

test("guard: real client palettes (blue-rose-auto shape) pass", () => {
  const brand = { visual: { colors: { primary: "#29ABE2", secondary: "#939598", accent: "#29ABE2", neutrals: ["#000000", "#FFFFFF"] } } };
  assert.equal(checkBrandContrast(brand).ok, true);
});
