import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBrandFonts, posterFonts, FONT_FAMILIES } from "../scripts/lib/poster_fonts.js";

test("resolveBrandFonts: matches a client brand kit's named heading/body fonts", () => {
  const brand = { visual: { typography: { heading: "Fraunces (serif) — matches the wordmark", body: "SF Pro Text (system sans; ui-sans-serif fallback)" } } };
  const { display, body } = resolveBrandFonts(brand);
  assert.equal(display.name, "Fraunces");
  // "SF Pro Text" has no redistributable bundle — falls back to the house body face.
  assert.equal(body.name, "Inter");
});

test("resolveBrandFonts: matches another client's distinct named heading font", () => {
  const brand = { visual: { typography: { heading: "Space Grotesk", body: "Inter" } } };
  const { display, body } = resolveBrandFonts(brand);
  assert.equal(display.name, "SpaceGrotesk");
  assert.equal(body.name, "Inter");
});

test("resolveBrandFonts: generic descriptions and missing brand fall back to the house default", () => {
  assert.equal(resolveBrandFonts({ visual: { typography: { heading: "sans-serif (bold, condensed)" } } }).display.name, "Oswald");
  assert.equal(resolveBrandFonts(null).display.name, "Oswald");
  assert.equal(resolveBrandFonts(null).body.name, "Inter");
  assert.equal(resolveBrandFonts({}).display.name, "Oswald");
});

test("posterFonts: loads real font bytes for a matched brand kit without throwing, keyed to fixed logical names", () => {
  const brand = { visual: { typography: { heading: "Fraunces", body: "Inter" } } };
  const fonts = posterFonts(brand);
  assert.equal(fonts.length, 4);
  assert.ok(fonts.every((f) => f.name === FONT_FAMILIES.display || f.name === FONT_FAMILIES.body));
  assert.ok(fonts.every((f) => f.data && f.data.byteLength > 0));
});

test("posterFonts: no brand argument preserves the prior Oswald/Inter default", () => {
  const fonts = posterFonts();
  assert.ok(fonts.every((f) => f.data && f.data.byteLength > 0));
});
