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

function contactStripText(contact) {
  const c = contact || {};
  const handles = c.social_handles || {};
  const left = [c.phone, c.website_display].filter(Boolean).join("  ·  ");
  // City, State only — drop the street + ZIP so the strip stays on one line.
  let cityState = "";
  if (c.address) {
    const parts = c.address.split(",").map((s) => s.trim());
    const city = parts[parts.length - 2] || "";
    const state = (parts[parts.length - 1] || "").replace(/\d/g, "").trim();
    cityState = [city, state].filter(Boolean).join(", ");
  }
  const handle = handles.instagram
    ? `@${String(handles.instagram).replace(/^@/, "")}`
    : handles.facebook
    ? String(handles.facebook).replace(/^@/, "")
    : "";
  const right = [cityState, handle].filter(Boolean).join("  ·  ");
  return { left, right };
}

/**
 * Render the marketing layer to a transparent PNG buffer.
 * @param {object}   o
 * @param {number}   o.width, o.height
 * @param {object}   o.brand    brand_profile.json (reads visual.colors)
 * @param {object}   o.copy     { eyebrow, headline, subhead, benefits[], cta }
 * @param {Buffer}   [o.logoBuffer]  raw logo PNG (composited inline; no chip)
 * @param {object}   [o.contact]     client contact for the bottom strip
 */
export async function renderAdLayer({ width, height, brand, copy, logoBuffer, contact } = {}) {
  const colors = brand?.visual?.colors || {};
  const primary = colors.primary || "#29ABE2";
  const accent = colors.accent || primary;
  const ctaText = readableOn(accent);

  // Type scale keyed off the short edge so square + vertical both stay in
  // proportion. Base tuned at 1080.
  const S = Math.min(width, height) / 1080;
  const PAD = Math.round(Math.min(width, height) * 0.083);
  const stripH = Math.round(80 * S);

  const logoData = logoBuffer ? `data:image/png;base64,${logoBuffer.toString("base64")}` : null;
  const logoH = Math.round(150 * S);

  const strip = contactStripText(contact);

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
        boxShadow: `0 8px 22px ${hexToRgba(accent, 0.4)}`,
      },
      copy.cta
    )
  );

  // ---- children of the root ----
  const children = [];
  // top: bare logo (no chip), with a soft shadow for separation on the photo
  if (logoData) {
    children.push(
      el("div", { display: "flex" }, [
        {
          type: "img",
          props: {
            src: logoData,
            height: logoH,
            style: { objectFit: "contain", filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.55))" },
          },
        },
      ])
    );
  } else {
    children.push(el("div", { display: "flex", height: 1 }));
  }
  children.push(el("div", { display: "flex", flexDirection: "column" }, block));

  // bottom contact strip (absolute, full-bleed)
  if (strip.left || strip.right) {
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
          justifyContent: "space-between",
          padding: `0 ${PAD}px`,
          backgroundColor: "rgba(10,10,10,0.72)",
          borderTop: `3px solid ${accent}`,
        },
        [
          el("div", { display: "flex", flexShrink: 0, fontFamily: FONT_FAMILIES.body, fontWeight: 600, fontSize: Math.round(26 * S), color: "#ffffff" }, strip.left || ""),
          el("div", { display: "flex", flexShrink: 0, fontFamily: FONT_FAMILIES.body, fontWeight: 500, fontSize: Math.round(23 * S), color: "rgba(255,255,255,0.8)" }, strip.right || ""),
        ]
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

  const svg = await satori(tree, { width, height, fonts: posterFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" }).render().asPng();
}
