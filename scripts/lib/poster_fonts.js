/**
 * Bundled poster fonts for the Satori text layer (see poster_text_layer.js).
 *
 * WHY bundled in-repo: the previous SVG-text path rendered through librsvg,
 * which resolves `font-family` against whatever fonts the HOST machine has
 * installed (fontconfig) — so branded output was non-deterministic across
 * dev/CI/container. Satori embeds the exact font bytes we ship here, so a
 * poster renders pixel-identically everywhere.
 *
 * Fonts (latin subset, .woff — Satori supports ttf/otf/woff, NOT woff2):
 *   - Oswald  (SemiBold/Medium): condensed bold display face → headlines +
 *     eyebrow, matching the brand's "sans-serif (bold, condensed)" heading spec.
 *   - Inter   (SemiBold/Medium): humanist sans → subhead, benefits, CTA, footer.
 *
 * Sourced from @fontsource (Oswald/Inter, OFL) and copied into
 * scripts/lib/poster_fonts/ so the poster system is self-contained.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(HERE, "poster_fonts");

function load(file) {
  const buf = readFileSync(resolve(FONT_DIR, file));
  // Satori accepts Buffer/ArrayBuffer; hand it a clean ArrayBuffer slice.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

let cache = null;

/**
 * Satori `fonts` array. Two logical families:
 *   "Display" → Oswald  (weights 500/600) — headlines, eyebrow
 *   "Body"    → Inter    (weights 500/600) — everything else
 */
export function posterFonts() {
  if (cache) return cache;
  cache = [
    { name: "Display", data: load("Oswald-SemiBold.woff"), weight: 600, style: "normal" },
    { name: "Display", data: load("Oswald-Medium.woff"), weight: 500, style: "normal" },
    { name: "Body", data: load("Inter-SemiBold.woff"), weight: 600, style: "normal" },
    { name: "Body", data: load("Inter-Medium.woff"), weight: 500, style: "normal" },
  ];
  return cache;
}

export const FONT_FAMILIES = { display: "Display", body: "Body" };
