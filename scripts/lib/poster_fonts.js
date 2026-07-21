/**
 * Bundled poster fonts for the Satori text layer (see poster_text_layer.js).
 *
 * WHY bundled in-repo: the previous SVG-text path rendered through librsvg,
 * which resolves `font-family` against whatever fonts the HOST machine has
 * installed (fontconfig) — so branded output was non-deterministic across
 * dev/CI/container. Satori embeds the exact font bytes we ship here, so a
 * poster renders pixel-identically everywhere.
 *
 * PER-CLIENT BRAND FONTS: `brand_profile.json`'s `visual.typography.heading`/
 * `.body` are free-text brand-kit descriptions (e.g. "Fraunces (serif) —
 * matches the wordmark", "Space Grotesk", "sans-serif (bold, condensed)").
 * `FONT_REGISTRY` below maps recognized font names found in those strings to
 * bundled font files; `posterFonts(brand)` resolves each role independently
 * and falls back to the house default (Oswald/Inter) when the brand kit names
 * a font we don't have bytes for (e.g. "SF Pro Text" — a system font with no
 * redistributable license — or a generic description like "sans-serif").
 * Every poster is still deterministic: the same brand always resolves to the
 * same bundled files, just not necessarily Oswald/Inter for every client.
 *
 * To add a new brand font: `npm pack @fontsource/<name>`, copy its 500/600
 * weight latin .woff files into scripts/lib/poster_fonts/, and add an entry
 * to FONT_REGISTRY (OFL-licensed fonts only, matching the existing bundle).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(HERE, "poster_fonts");

// Keyed by a lowercase substring matched against the brand's typography spec
// string. Order matters only in that more specific keys should win, which
// isn't a concern for the current distinct names.
const FONT_REGISTRY = {
  fraunces: { name: "Fraunces", files: { 600: "Fraunces-SemiBold.woff", 500: "Fraunces-Medium.woff" } },
  "space grotesk": { name: "SpaceGrotesk", files: { 600: "SpaceGrotesk-SemiBold.woff", 500: "SpaceGrotesk-Medium.woff" } },
  oswald: { name: "Oswald", files: { 600: "Oswald-SemiBold.woff", 500: "Oswald-Medium.woff" } },
  inter: { name: "Inter", files: { 600: "Inter-SemiBold.woff", 500: "Inter-Medium.woff" } },
};

const DEFAULT_DISPLAY = FONT_REGISTRY.oswald; // condensed bold display — the house default heading face
const DEFAULT_BODY = FONT_REGISTRY.inter; // humanist sans — the house default body face

function matchRegistry(spec, fallback) {
  if (!spec) return fallback;
  const s = String(spec).toLowerCase();
  for (const key of Object.keys(FONT_REGISTRY)) {
    if (s.includes(key)) return FONT_REGISTRY[key];
  }
  return fallback;
}

/** Resolve the {name, files} entries this brand should use for each role. */
export function resolveBrandFonts(brand) {
  const typography = brand?.visual?.typography || {};
  return {
    display: matchRegistry(typography.heading, DEFAULT_DISPLAY),
    body: matchRegistry(typography.body, DEFAULT_BODY),
  };
}

const fileCache = new Map();
function load(file) {
  if (fileCache.has(file)) return fileCache.get(file);
  const buf = readFileSync(resolve(FONT_DIR, file));
  // Satori accepts Buffer/ArrayBuffer; hand it a clean ArrayBuffer slice.
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  fileCache.set(file, data);
  return data;
}

/**
 * Satori `fonts` array. Two logical families that the text layer always
 * references by these fixed names — which BYTES back "Display"/"Body" varies
 * per brand, resolved via resolveBrandFonts(brand):
 *   "Display" → the brand's heading face (weights 500/600) — headlines, eyebrow
 *   "Body"    → the brand's body face (weights 500/600) — everything else
 * Called with no brand (or a brand with no typography spec) returns the house
 * default Oswald/Inter pairing, preserving prior behavior.
 */
export function posterFonts(brand) {
  const { display, body } = resolveBrandFonts(brand);
  return [
    { name: "Display", data: load(display.files[600]), weight: 600, style: "normal" },
    { name: "Display", data: load(display.files[500]), weight: 500, style: "normal" },
    { name: "Body", data: load(body.files[600]), weight: 600, style: "normal" },
    { name: "Body", data: load(body.files[500]), weight: 500, style: "normal" },
  ];
}

export const FONT_FAMILIES = { display: "Display", body: "Body" };
