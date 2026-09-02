#!/usr/bin/env node
/**
 * Facebook cover renderer — deterministic, brand-driven, no image generation.
 *
 * WHY a dedicated renderer: the cover is a *typographic* asset (tagline +
 * logo), not a photo poster, so it goes through the same Satori + resvg + sharp
 * path as poster_text_layer.js but with its own layout. Reusing the poster
 * compositor would force a photo background and an ad-shaped copy block.
 *
 * The logo is composited by sharp (Lanczos) OVER the rendered text layer, with
 * its own alpha preserved — no white plate behind it — so a transparent PNG
 * reads as a transparent mark on the gradient. An optional soft shadow is
 * derived from the logo's own alpha for separation on busy/dark grounds.
 *
 * Canvas is 1640×624 (Meta's recommended upload). Content stays inside a
 * centered safe box because the mobile feed crops the cover's left/right edges
 * and the profile picture overlaps the lower-left on desktop.
 *
 * Usage:
 *   node scripts/render_social_cover.js <slug> [--themes dark,deep,light]
 *                                              [--headline "..."] [--subhead "..."]
 *                                              [--accent-from "Real."] [--out-dir <dir>]
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { loadEnv } from "./lib/load-env.js";
import { fetchBuffer } from "./lib/media_storage.js";
import { posterFonts, FONT_FAMILIES } from "./lib/poster_fonts.js";
import * as P from "./lib/paths.js";

loadEnv();

const WIDTH = 1640;
const HEIGHT = 624;
// Meta crops the cover on mobile and overlaps the profile picture lower-left on
// desktop; everything meaningful lives inside this centered box.
const SAFE_WIDTH = 1180;

const el = (type, style, children) => ({ type, props: { style, ...(children !== undefined ? { children } : {}) } });

function hexToRgba(hex, a) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Per-theme ground + ink. Every theme keeps the SAME dual-color heading rule:
 * the lead clause in the primary ink, the accent clause in the brand accent.
 */
function themeTokens(theme, colors) {
  const primary = colors.primary || "#0066CC";
  const secondary = colors.secondary || "#20B2AA";
  const accent = colors.accent || "#34C759";

  if (theme === "light") {
    return {
      background: "#F5F5F7",
      // soft brand aurora on a light canvas
      washes: [
        `radial-gradient(circle at 22% 18%, ${hexToRgba(primary, 0.22)} 0%, rgba(0,0,0,0) 58%)`,
        `radial-gradient(circle at 82% 82%, ${hexToRgba(secondary, 0.26)} 0%, rgba(0,0,0,0) 60%)`,
      ],
      ink: "#1D1D1F",
      inkMuted: "rgba(29,29,31,0.68)",
      accent,
      logoShadow: false,
    };
  }
  if (theme === "deep") {
    return {
      background: "#041C33",
      washes: [
        `radial-gradient(circle at 50% 8%, ${hexToRgba(secondary, 0.5)} 0%, rgba(0,0,0,0) 62%)`,
        `radial-gradient(circle at 12% 92%, ${hexToRgba(primary, 0.55)} 0%, rgba(0,0,0,0) 58%)`,
      ],
      ink: "#FFFFFF",
      inkMuted: "rgba(255,255,255,0.80)",
      accent,
      logoShadow: true,
    };
  }
  // "dark" (default): the brand blue→teal gradient. The top-center radial is
  // DARK, not a highlight — a mid-tone color logo (this brand's mark is the
  // same blue as `primary`) disappears against an undimmed brand gradient.
  return {
    background: primary,
    // NOTE ordering: CSS stacks the FIRST listed background-image on top, so the
    // scrims must precede the brand gradient or they render underneath it and
    // do nothing.
    washes: [
      `radial-gradient(circle at 50% 0%, rgba(2,14,28,0.55) 0%, rgba(0,0,0,0) 78%)`,
      `radial-gradient(circle at 50% 100%, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 62%)`,
      `linear-gradient(115deg, ${hexToRgba(primary, 0.95)} 0%, ${hexToRgba(secondary, 0.95)} 100%)`,
    ],
    ink: "#FFFFFF",
    inkMuted: "rgba(255,255,255,0.82)",
    accent,
    logoShadow: true,
  };
}

/**
 * Split the headline into a lead clause and an accent clause. `accentFrom` is
 * the trailing substring to color with the brand accent (default: the final
 * sentence/word), giving the dual-color treatment used on the poster layer.
 */
function splitHeadline(headline, accentFrom) {
  const text = String(headline || "").trim();
  if (!text) return { lead: "", accent: "" };
  if (accentFrom) {
    const i = text.lastIndexOf(accentFrom);
    if (i > 0) return { lead: text.slice(0, i).trim(), accent: text.slice(i).trim() };
  }
  // Default: color the last sentence ("Proven. Accessible. Real." → "Real.")
  const parts = text.split(/(?<=\.)\s+/).filter(Boolean);
  if (parts.length > 1) return { lead: parts.slice(0, -1).join(" "), accent: parts[parts.length - 1] };
  const words = text.split(/\s+/);
  if (words.length > 1) return { lead: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
  return { lead: "", accent: text };
}

/** Soft drop shadow from the logo's own alpha, so a bare (plate-less) logo still separates. */
async function logoShadow(logoResized, lw, lh, blur = 10) {
  const pad = blur * 3;
  return sharp({ create: { width: lw + pad * 2, height: lh + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: lw, height: lh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer(), left: pad, top: pad }])
    .png()
    .toBuffer()
    .then((plate) =>
      sharp(plate)
        .composite([{ input: logoResized, left: pad, top: pad, blend: "dest-in" }])
        .blur(blur)
        .png()
        .toBuffer()
    )
    .then((shadow) => ({ shadow, pad }));
}

async function renderTextLayer({ brand, tokens, headline, subhead, accentFrom, logoZone }) {
  const { lead, accent } = splitHeadline(headline, accentFrom);

  const headingRow = el(
    "div",
    { display: "flex", flexDirection: "row", alignItems: "baseline", justifyContent: "center", flexWrap: "wrap", maxWidth: SAFE_WIDTH },
    [
      lead
        ? el("span", { fontFamily: FONT_FAMILIES.display, fontWeight: 600, fontSize: 78, lineHeight: 1.06, color: tokens.ink, letterSpacing: -0.5, marginRight: 18 }, lead)
        : null,
      accent
        ? el("span", { fontFamily: FONT_FAMILIES.display, fontWeight: 600, fontSize: 78, lineHeight: 1.06, color: tokens.accent, letterSpacing: -0.5 }, accent)
        : null,
    ].filter(Boolean)
  );

  const tree = el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: tokens.background,
      backgroundImage: tokens.washes.join(", "),
      // clear the sharp-composited logo sitting above the text
      paddingTop: logoZone,
    },
    [
      headingRow,
      subhead
        ? el(
            "div",
            { fontFamily: FONT_FAMILIES.body, fontWeight: 500, fontSize: 31, lineHeight: 1.3, color: tokens.inkMuted, marginTop: 18, maxWidth: SAFE_WIDTH, textAlign: "center" },
            subhead
          )
        : null,
      el("div", { width: 132, height: 6, borderRadius: 3, backgroundColor: tokens.accent, marginTop: 26 }),
    ].filter(Boolean)
  );

  const svg = await satori(tree, { width: WIDTH, height: HEIGHT, fonts: posterFonts(brand) });
  return new Resvg(svg, { fitTo: { mode: "width", value: WIDTH }, background: "rgba(0,0,0,0)" }).render().asPng();
}

async function renderCover({ brand, theme, headline, subhead, accentFrom }) {
  const colors = brand?.visual?.colors || {};
  const tokens = themeTokens(theme, colors);

  // The light ground reads best with the full-color primary logo; dark grounds
  // prefer a reverse/mono mark when the kit has one, else the primary (its own
  // transparency is preserved either way — never a white plate).
  const logo = brand?.visual?.logo || {};
  const logoUrl = theme === "light"
    ? logo.primary_url || logo.mono_url || logo.reverse_url
    : logo.reverse_url || logo.primary_url || logo.mono_url;
  if (!logoUrl) throw new Error("brand_profile.visual.logo has no usable url — run /brand-visual first.");

  const LOGO_H = 168;
  const LOGO_TOP = 62;
  const logoBuffer = await fetchBuffer(logoUrl);
  const logoResized = await sharp(logoBuffer)
    .resize({ height: LOGO_H, width: 360, fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const meta = await sharp(logoResized).metadata();
  const lw = meta.width;
  const lh = meta.height;

  const base = await renderTextLayer({
    brand,
    tokens,
    headline,
    subhead,
    accentFrom,
    logoZone: LOGO_TOP + lh + 46,
  });

  const layers = [];
  if (tokens.logoShadow) {
    const { shadow, pad } = await logoShadow(logoResized, lw, lh);
    layers.push({ input: shadow, left: Math.round((WIDTH - lw) / 2) - pad, top: LOGO_TOP - pad });
  }
  layers.push({ input: logoResized, left: Math.round((WIDTH - lw) / 2), top: LOGO_TOP });

  return sharp(base).composite(layers).png().toBuffer();
}

function arg(args, flag, fallback = null) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug || slug.startsWith("--")) {
    console.error('Usage: node scripts/render_social_cover.js <slug> [--themes dark,deep,light] [--headline "..."] [--subhead "..."] [--accent-from "Real."] [--out-dir <dir>]');
    process.exit(1);
  }

  const brandPath = P.clientFile(slug, "brand_profile.json");
  if (!existsSync(brandPath)) {
    console.error(`No brand_profile.json for ${slug}. Run /brand-visual first.`);
    process.exit(2);
  }
  const brand = JSON.parse(readFileSync(brandPath, "utf8"));
  if (!brand?.visual?.logo_approved_at) {
    console.error(`${slug}: logo is not approved (brand_profile.visual.logo_approved_at unset). Run /brand-visual first.`);
    process.exit(3);
  }

  // brand_profile's messaging_house is the roof/walls/foundation shape and is
  // often empty; the richer per-channel copy lives in the client's verbal.json.
  const verbalPath = P.clientFile(slug, "verbal.json");
  const verbal = existsSync(verbalPath) ? JSON.parse(readFileSync(verbalPath, "utf8")) : {};

  const headline = arg(args, "--headline") || brand?.verbal?.tagline || verbal?.tagline || brand?.verbal?.name || "";
  const subhead =
    arg(args, "--subhead") ||
    brand?.verbal?.messaging_house?.subheading_theme ||
    verbal?.messaging_house?.subheading_theme ||
    "";
  const accentFrom = arg(args, "--accent-from");
  const themes = (arg(args, "--themes", "dark,deep,light") || "").split(",").map((t) => t.trim()).filter(Boolean);
  const outDir = arg(args, "--out-dir") || resolve(P.clientRoot(slug), "generated");

  const written = [];
  for (const theme of themes) {
    const png = await renderCover({ brand, theme, headline, subhead, accentFrom });
    const out = resolve(outDir, `fb-cover-${theme}.png`);
    P.ensureParent(out);
    writeFileSync(out, png);
    written.push({ theme, path: out, bytes: png.length });
  }

  console.log(JSON.stringify({ slug, size: `${WIDTH}x${HEIGHT}`, headline, subhead, written }, null, 2));
}

main().catch((e) => {
  console.error("[render_social_cover] FATAL:", e.message);
  process.exit(1);
});
