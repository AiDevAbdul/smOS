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

// Split a headline into (at most) two visually balanced lines, biased against
// leaving a single short "orphan" word alone on the last line (e.g. "GET A
// FREE CERAMIC / QUOTE"). Pure character-count balancing — no font metrics
// available here — which is enough to fix the orphan case; if the chosen line
// is still too wide for the box, the container's maxWidth/CSS wrap (below)
// wraps it further as a safe fallback, so this can never overflow.
function balancedHeadlineLines(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    const orphanPenalty = words.length - i === 1 && line2.length <= 8 ? 1000 : 0;
    const score = Math.abs(line1.length - line2.length) + orphanPenalty;
    if (!best || score < best.score) best = { score, line1, line2 };
  }
  return [best.line1, best.line2];
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
export async function renderAdLayer({ width, height, brand, copy, contact, theme = "dark" } = {}) {
  const colors = brand?.visual?.colors || {};
  const primary = colors.primary || "#29ABE2";
  const accent = colors.accent || primary;
  const ctaText = readableOn(accent);
  const isLight = theme === "light";
  // Dark theme: white text over a darkened photo (scrimBuffer). Light theme:
  // ink text over a lightened photo (see poster_compose.js scrimBuffer(theme)) —
  // matches the brand kit's own "Light #F5F5F7 canvas, ink #1D1D1F" template spec
  // (brand_profile.social.templates) instead of forcing every poster dark.
  const ink = colors.secondary || "#1D1D1F";
  const headlineColor = isLight ? ink : "#ffffff";
  const subheadColor = isLight ? hexToRgba(ink, 0.82) : "rgba(255,255,255,0.92)";
  const benefitColor = isLight ? hexToRgba(ink, 0.92) : "rgba(255,255,255,0.96)";
  const headlineShadow = isLight ? "none" : "0 3px 18px rgba(0,0,0,0.55)";
  const subheadShadow = isLight ? "none" : "0 2px 10px rgba(0,0,0,0.5)";
  const stripBg = isLight ? "rgba(255,255,255,0.82)" : "rgba(10,10,10,0.72)";
  const stripColor = isLight ? ink : "#ffffff";

  // Type scale keyed off the short edge so square + vertical both stay in
  // proportion. Base tuned at 1080.
  const S = Math.min(width, height) / 1080;
  const PAD = Math.round(Math.min(width, height) * 0.083);
  const stripH = Math.round(80 * S);

  const { phone: stripPhone, website: stripWebsite } = contactStripParts(contact);
  const hasStrip = Boolean(stripPhone || stripWebsite);

  // ---- benefit rows ----
  // A check mark inside the dot (rather than a flat filled circle) gives the
  // list rhythm/texture at a glance instead of reading as three identical
  // undifferentiated dots.
  const benefits = (copy.benefits || []).slice(0, 3);
  const dotSize = Math.round(20 * S);
  const benefitRows = benefits.map((b) =>
    el("div", { display: "flex", alignItems: "center", marginBottom: Math.round(14 * S) }, [
      el(
        "div",
        {
          width: dotSize,
          height: dotSize,
          borderRadius: Math.round(dotSize / 2),
          backgroundColor: accent,
          marginRight: Math.round(18 * S),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: `0 0 0 ${Math.round(5 * S)}px ${hexToRgba(accent, 0.25)}`,
        },
        el("div", { display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 700, fontSize: Math.round(dotSize * 0.62), color: ctaText, lineHeight: 1 }, "✓")
      ),
      el("div", { fontFamily: FONT_FAMILIES.body, fontWeight: 600, fontSize: Math.round(33 * S), color: benefitColor }, b),
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
  const headlineLines = balancedHeadlineLines(copy.headline);
  const headlineLineStyle = {
    display: "flex",
    fontFamily: FONT_FAMILIES.display,
    fontWeight: 600,
    fontSize: Math.round(86 * S),
    lineHeight: 1.12,
    letterSpacing: Math.round(0.4 * S),
    textTransform: "uppercase",
    textShadow: headlineShadow,
    maxWidth: width - PAD * 2,
  };
  // Two-tone headline: first line stays the neutral theme color (white on
  // dark, ink on light), the last line picks up the brand accent — a cheap,
  // reliable way to inject the brand's second color into the dominant type
  // element instead of an all-one-color block, without needing to know which
  // words are "the important ones" semantically.
  block.push(
    el(
      "div",
      { display: "flex", flexDirection: "column", marginBottom: Math.round(16 * S) },
      headlineLines.map((line, i) => {
        const isLast = i === headlineLines.length - 1;
        const color = isLast && headlineLines.length > 1 ? accent : headlineColor;
        return el("div", { ...headlineLineStyle, color, marginBottom: isLast ? 0 : Math.round(4 * S) }, line);
      })
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
          color: subheadColor,
          textShadow: subheadShadow,
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
  // Deliberately NOT the same accent fill as the eyebrow badge above it — two
  // same-color chips on a color-dominant photo (e.g. a blue car under a blue
  // badge) camouflage the highest-priority conversion element. The CTA gets
  // the inverse treatment instead (near-white on dark theme, ink on light
  // theme) so it reads as the one unmissable action regardless of photo color.
  const ctaBg = isLight ? ink : "#ffffff";
  const ctaFg = readableOn(ctaBg);
  block.push(
    el(
      "div",
      {
        display: "flex",
        alignSelf: "flex-start",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: ctaBg,
        color: ctaFg,
        fontFamily: FONT_FAMILIES.body,
        fontWeight: 600,
        fontSize: Math.round(27 * S),
        letterSpacing: Math.round(0.3 * S),
        padding: `${Math.round(15 * S)}px ${Math.round(34 * S)}px`,
        borderRadius: Math.round(10 * S),
        boxShadow: `0 6px 18px rgba(0,0,0,0.32)`,
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
    const stripText = { display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 600, fontSize: Math.round(28 * S), letterSpacing: Math.round(0.3 * S), color: stripColor };
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
          backgroundColor: stripBg,
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
