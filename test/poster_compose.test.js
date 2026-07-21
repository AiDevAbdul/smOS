import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { buildContactBarSvg, composePoster } from "../scripts/lib/poster_compose.js";
import { renderAdLayer } from "../scripts/lib/poster_text_layer.js";
import { checkPosterInputs } from "../scripts/lib/guards.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const isPng = (buf) => Buffer.isBuffer(buf) && buf.subarray(0, 4).equals(PNG_MAGIC);

test("buildContactBarSvg: renders only fields that are set", () => {
  const svg = buildContactBarSvg({
    width: 1080,
    barHeight: 130,
    colors: { primary: "#112233" },
    contact: { phone: "555-0100", website_display: null, social_handles: { instagram: "blueroseauto" } },
  });
  assert.match(svg, /555-0100/);
  assert.match(svg, /@blueroseauto/);
  assert.doesNotMatch(svg, /undefined/);
  assert.doesNotMatch(svg, /null/);
});

test("buildContactBarSvg: no contact fields set -> bar with no text node", () => {
  const svg = buildContactBarSvg({ width: 1080, barHeight: 130, colors: {}, contact: {} });
  assert.match(svg, /<rect/);
  assert.doesNotMatch(svg, /<text/);
});

test("checkPosterInputs: fails closed with no logo and no contact", () => {
  const r = checkPosterInputs({ visual: {} }, { contact: {} });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 2);
});

test("checkPosterInputs: fails when logo present but not approved", () => {
  const brand = { visual: { logo: { primary_url: "https://x/logo.png" }, logo_approved_at: null } };
  const r = checkPosterInputs(brand, { contact: { phone: "555-0100" } });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].asset, "logo");
});

test("checkPosterInputs: passes with approved logo + one contact field", () => {
  const brand = { visual: { logo: { primary_url: "https://x/logo.png" }, logo_approved_at: "2026-01-01T00:00:00Z" } };
  const profile = { contact: { phone: null, website_display: null, social_handles: { instagram: "blueroseauto" } } };
  const r = checkPosterInputs(brand, profile);
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
});

test("renderAdLayer: produces a transparent PNG of the requested size (no network)", async () => {
  const png = await renderAdLayer({
    width: 1080,
    height: 1080,
    brand: { visual: { colors: { primary: "#29ABE2", accent: "#29ABE2" } } },
    copy: { eyebrow: "Blue Rose Auto", headline: "Premium PPF Protection", subhead: "Paint Protection Film", benefits: ["Self-healing", "Crystal clear", "10-year warranty"], cta: "Get a Quote" },
    logoBuffer: null, // no logo → still renders text layer
    contact: { phone: "(541) 641-8877", website_display: "blueroseauto.com", address: "3436 Olympic St, Springfield, OR 97478", social_handles: { instagram: "blueroseauto" } },
  });
  assert.ok(isPng(png));
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1080);
  assert.equal(meta.channels, 4); // RGBA — transparent background preserved
});

test("composePoster: copy with a headline routes to the ad layer and returns a PNG", async () => {
  const bg = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#334455" } }).png().toBuffer();
  const out = await composePoster({
    backgroundBuffer: bg,
    brand: { visual: { colors: { primary: "#29ABE2" } } }, // no logo URL → no fetch
    contact: { phone: "555-0100" },
    copy: { eyebrow: "X", headline: "Big Headline", subhead: "", benefits: ["a", "b"], cta: "Book Now" },
    width: 400,
    height: 400,
  });
  assert.ok(isPng(out));
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 400);
});
