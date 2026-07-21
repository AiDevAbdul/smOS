/**
 * Marketing text layer for ad posters — rendered with Satori (HTML/CSS → SVG)
 * and rasterized with resvg-js, then composited over the photo by
 * poster_compose.js. This is the layer the old contact-bar-only compositor
 * lacked: eyebrow, headline, sub-headline, benefit bullets, and a CTA button,
 * laid out with declarative flexbox and the bundled brand fonts (poster_fonts.js)
 * so output is deterministic and on-brand.
 *
 * The logo and a streamlined contact strip are drawn INSIDE this layer too, so
 * the whole textual composition shares one type system. The photo background,
 * brand-color wash, and legibility scrim stay in poster_compose.js (sharp).
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { posterFonts, FONT_FAMILIES } from "./poster_fonts.js";

const el = (type, style, children) => ({
  type,
  props: { style, ...(children !== undefined ? { children } : {}) },
});

function hexToRgba(hex, a) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return `rgba(41,171,226,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Relative luminance → choose readable label color on the CTA fill.
function readableOn(hex) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#0A0A0A" : "#ffffff";
}

// Footer is intentionally minimal — just the two actionable contact details.
// Phone is anchored to the LEFT corner and website to the RIGHT corner (rather
// than one centered run-on line) so each detail reads instantly and the strip
// frames the poster edge-to-edge.
function contactStripParts(contact) {
  const c = contact || {};
  return { phone: c.phone || "", website: c.website_display || "" };
}

/**
 * Render the marketing layer to a transparent PNG buffer.
 * @param {object}   o
 * @param {number}   o.width, o.height
 * @param {object}   o.brand    brand_profile.json (reads visual.colors)
 * @param {object}   o.copy     { eyebrow, headline, subhead, benefits[], cta }
 * @param {object}   [o.contact]     client contact for the bottom strip
 *
 * NOTE: the logo is NOT drawn here — poster_compose.js composites the original
 * logo with sharp (high-quality Lanczos downscale + soft shadow) for maximum
 * clarity, which beats embedding it through Satori/resvg's image path.
 */
export async function renderAdLayer({ width, height, brand, copy, contact } = {}) {
  const colors = brand?.visual?.colors || {};
  const primary = colors.primary || "#29ABE2";
  const accent = colors.accent || primary;
  const ctaText = readableOn(accent);

  // Type scale keyed off the short edge so square + vertical both stay in
  // proportion. Base tuned at 1080.
  const S = Math.min(width, height) / 1080;
  const PAD = Math.round(Math.min(width, height) * 0.083);
  const stripH = Math.round(80 * S);

  const { phone: stripPhone, website: stripWebsite } = contactStripParts(contact);
  const hasStrip = Boolean(stripPhone || stripWebsite);

  // ---- benefit rows ----
  const benefits = (copy.benefits || []).slice(0, 3);
  const benefitRows = benefits.map((b) =>
    el("div", { display: "flex", alignItems: "center", marginBottom: Math.round(14 * S) }, [
      el("div", {
        width: Math.round(16 * S),
        height: Math.round(16 * S),
        borderRadius: Math.round(8 * S),
        backgroundColor: accent,
        marginRight: Math.round(18 * S),
        display: "flex",
        flexShrink: 0,
        boxShadow: `0 0 0 ${Math.round(5 * S)}px ${hexToRgba(accent, 0.25)}`,
      }),
      el("div", { fontFamily: FONT_FAMILIES.body, fontWeight: 500, fontSize: Math.round(33 * S), color: "rgba(255,255,255,0.96)" }, b),
    ])
  );

  // ---- marketing block (bottom-anchored) ----
  const block = [];
  if (copy.eyebrow) {
    block.push(
      el(
        "div",
        {
          display: "flex",
          alignSelf: "flex-start",
          backgroundColor: accent,
          color: ctaText,
          fontFamily: FONT_FAMILIES.display,
          fontWeight: 600,
          fontSize: Math.round(24 * S),
          letterSpacing: Math.round(3 * S),
          textTransform: "uppercase",
          padding: `${Math.round(7 * S)}px ${Math.round(16 * S)}px`,
          borderRadius: Math.round(7 * S),
          marginBottom: Math.round(22 * S),
        },
        copy.eyebrow.toUpperCase()
      )
    );
  }
  block.push(
    el(
      "div",
      {
        display: "flex",
        fontFamily: FONT_FAMILIES.display,
        fontWeight: 600,
        fontSize: Math.round(94 * S),
        lineHeight: 1.02,
        color: "#ffffff",
        letterSpacing: Math.round(-0.5 * S),
        textTransform: "uppercase",
        textShadow: "0 3px 18px rgba(0,0,0,0.55)",
        marginBottom: Math.round(16 * S),
        maxWidth: width - PAD * 2,
      },
      copy.headline
    )
  );
  if (copy.subhead) {
    block.push(
      el(
        "div",
        {
          display: "flex",
          fontFamily: FONT_FAMILIES.body,
          fontWeight: 500,
          fontSize: Math.round(37 * S),
          color: "rgba(255,255,255,0.92)",
          textShadow: "0 2px 10px rgba(0,0,0,0.5)",
          marginBottom: Math.round(28 * S),
          maxWidth: width - PAD * 2,
        },
        copy.subhead
      )
    );
  }
  if (benefitRows.length) {
    block.push(el("div", { display: "flex", flexDirection: "column", marginBottom: Math.round(34 * S) }, benefitRows));
  }
  // ---- CTA button (standard size) ----
  block.push(
    el(
      "div",
      {
        display: "flex",
        alignSelf: "flex-start",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: accent,
        color: ctaText,
        fontFamily: FONT_FAMILIES.body,
        fontWeight: 600,
        fontSize: Math.round(27 * S),
        letterSpacing: Math.round(0.3 * S),
        padding: `${Math.round(15 * S)}px ${Math.round(34 * S)}px`,
        borderRadius: Math.round(10 * S),
        // Tight, low-spread shadow for lift without a dated neon "glow" bloom.
        boxShadow: `0 6px 16px ${hexToRgba(accent, 0.26)}`,
      },
      copy.cta
    )
  );

  // ---- children of the root ----
  const children = [];
  // top spacer — the logo is composited separately by poster_compose.js (sharp),
  // so here we just reserve the top zone and bottom-anchor the marketing block.
  children.push(el("div", { display: "flex", height: 1 }));
  children.push(el("div", { display: "flex", flexDirection: "column" }, block));

  // bottom contact strip (absolute, full-bleed): phone pinned to the LEFT
  // corner, website to the RIGHT corner, with an inset margin so neither hugs
  // the very edge. When only one is present it sits at its own corner.
  if (hasStrip) {
    const stripPadX = Math.round(52 * S);
    const stripText = { display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 600, fontSize: Math.round(28 * S), letterSpacing: Math.round(0.3 * S), color: "#ffffff" };
    const stripChildren = [];
    if (stripPhone) stripChildren.push(el("div", stripText, stripPhone));
    if (stripWebsite) stripChildren.push(el("div", stripText, stripWebsite));
    const justify = stripPhone && stripWebsite ? "space-between" : stripPhone ? "flex-start" : "flex-end";
    children.push(
      el(
        "div",
        {
          position: "absolute",
          bottom: 0,
          left: 0,
          width,
          height: stripH,
          display: "flex",
          alignItems: "center",
          justifyContent: justify,
          paddingLeft: stripPadX,
          paddingRight: stripPadX,
          backgroundColor: "rgba(10,10,10,0.72)",
          borderTop: `3px solid ${accent}`,
        },
        stripChildren
      )
    );
  }

  const tree = el(
    "div",
    {
      width,
      height,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: PAD,
      paddingBottom: PAD + stripH,
      position: "relative",
    },
    children
  );

  const svg = await satori(tree, { width, height, fonts: posterFonts(brand) });
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" }).render().asPng();
}
