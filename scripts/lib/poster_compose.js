/**
 * Deterministic poster compositing — bakes a client's logo + contact/handle bar
 * onto an AI-generated background (Krea, see scripts/lib/krea.js), so every
 * poster is actually branded rather than just tagged with brand_kit metadata.
 *
 * Rationale (why this is a separate step from the generation prompt): diffusion
 * models render logos/small text unreliably, so the Krea prompt should only ever
 * ask for a background/hero image ("no text overlay, no logos, no watermarks" —
 * see skills/image-gen/image-gen.js buildPrompt()). The logo and contact/handle
 * bar are drawn on top here, pixel-exact, from the client's own approved brand
 * kit (brand_profile.json) — NOT smOS's internal "Cupertino" report design
 * system, which is for smOS's own HTML/PDF deliverables only.
 *
 * v2 design pass (2026-07-21): the v1 bar rendered emoji glyphs (📞🌐) for the
 * phone/website icons. Color-emoji rendering is NOT reliably supported by
 * librsvg/sharp's SVG rasterizer — on this host the globe emoji silently
 * degraded to a blank white dot (visually confirmed on the live blue-rose-auto
 * generations). Fixed by replacing emoji with hand-drawn monoline vector icons
 * (Feather-style stroke paths, inlined below) — plain <path>/<circle> primitives
 * always rasterize correctly regardless of host font/emoji support.
 *
 * v3 design pass (2026-07-21, same day): benchmarked real auto-shop poster ads
 * (Pinterest) — the common professional pattern is a diagonal brand-color
 * accent (not a flat rectangle), a dominant bold phone number, an address line,
 * and a subtle color wash tying the photo to the brand palette. Reworked here:
 * - `buildContactBarSvg` now lays out up to 3 hierarchy tiers (phone boldest,
 *   then website+address, then @handles smallest/muted) instead of two
 *   equal-ish lines, and promotes whichever field is actually present to the
 *   top tier if phone is missing.
 * - The bar canvas is taller than the visible content bar and includes an
 *   angled accent wedge behind the logo that pokes up into the photo (the
 *   "ribbon/flag" look from the reference posters), instead of a flat top edge.
 * - `composePoster` applies a subtle brand-color wash over the whole background
 *   (soft-light blend, low opacity) so the photo and bar read as one designed
 *   piece rather than "photo + bar bolted on".
 *
 * Font note (legacy bar path): the contact-bar text below is still rendered as
 * SVG text with a generic `sans-serif` family — sharp/librsvg rasterizes with
 * whatever fonts are installed on the host. That's a known portability
 * limitation for that text.
 *
 * v4 design pass (2026-07-21): added a full AD-POSTER layout. When the caller
 * supplies marketing `copy` (headline/subhead/benefits/CTA — resolved from an
 * ad_copy angle or calendar item by scripts/lib/poster_spec.js), composePoster
 * routes to composeAdPoster(): photo + brand wash + a bottom-to-top legibility
 * scrim + a Satori-rendered text layer (scripts/lib/poster_text_layer.js) that
 * draws the eyebrow, headline, sub-headline, benefit bullets, CTA button, a
 * bare (chip-less) logo, and a streamlined city/state contact strip. That layer
 * embeds bundled brand fonts (scripts/lib/poster_fonts.js) via Satori, so its
 * typography is DETERMINISTIC across hosts — fixing the librsvg font limitation
 * for the ad path. With no `copy`, the legacy logo+contact-bar layout below is
 * used unchanged (full backward compatibility).
 */

import sharp from "sharp";
import { fetchBuffer } from "./media_storage.js";
import { renderAdLayer } from "./poster_text_layer.js";

export class PosterComposeError extends Error {
  constructor(message) {
    super(message);
    this.name = "PosterComposeError";
  }
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

// Crude average-character-width heuristic for a generic sans-serif at normal
// weight (no real font metrics available without a text-shaping library) —
// good enough to keep text inside its box, not pixel-perfect kerning.
const AVG_CHAR_WIDTH_FACTOR = 0.56;
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * AVG_CHAR_WIDTH_FACTOR;
}

function fitFontSizeGeneric(measureFn, maxWidth, { max, min }) {
  let fs = max;
  while (fs > min && measureFn(fs) > maxWidth) fs -= 1;
  return fs;
}

// --- Monoline vector icons (Feather-icons style, MIT-equivalent simple
// primitives) — stroke-based, 24x24 viewBox, no external font/emoji needed. ---
const ICONS = {
  phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  globe: `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  pin: `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
};

function iconMarkup(name, x, y, size, color) {
  const inner = ICONS[name];
  if (!inner) return "";
  const scale = size / 24;
  return `<g transform="translate(${x},${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

/** amt in [-1,1]; negative darkens toward black, positive lightens toward white. */
function shade(hex, amt) {
  const c = parseHex(hex);
  if (!c) return hex || "#111111";
  const mix = amt < 0 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  const t = Math.abs(amt);
  return toHex({
    r: c.r + (mix.r - c.r) * t,
    g: c.g + (mix.g - c.g) * t,
    b: c.b + (mix.b - c.b) * t,
  });
}

/**
 * Layout one line as an ordered list of tokens (each an optional icon + a text
 * label), right-anchored as a whole line within `maxWidth`. Returns the total
 * measured width at `fontSize` and the SVG markup for the line drawn with its
 * right edge at `rightX`, vertically centered on `centerY`.
 */
function layoutIconLine(tokens, { fontSize, rightX, centerY, color, opacity = 1, iconGap = 0.35, tokenGap = 0.9 }) {
  const iconSize = Math.round(fontSize * 0.92);
  const parts = tokens.filter((t) => t.text);
  const widths = parts.map((t) => (t.icon ? iconSize + fontSize * iconGap : 0) + estimateTextWidth(t.text, fontSize));
  const totalWidth = widths.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * fontSize * tokenGap;

  let cursor = rightX - totalWidth;
  const textY = Math.round(centerY + fontSize * 0.32);
  const nodes = parts.map((t, i) => {
    let x = cursor;
    let iconNode = "";
    if (t.icon) {
      const iconY = Math.round(centerY - iconSize / 2);
      iconNode = iconMarkup(t.icon, Math.round(x), iconY, iconSize, color);
      x += iconSize + fontSize * iconGap;
    }
    const textNode = `<text x="${Math.round(x)}" y="${textY}" font-family="sans-serif" font-size="${fontSize}" font-weight="${t.weight || 400}" letter-spacing="${t.letterSpacing || 0}" fill="${color}" fill-opacity="${opacity}">${escapeXml(t.text)}</text>`;
    cursor += widths[i] + fontSize * tokenGap;
    return iconNode + textNode;
  });

  return { totalWidth, markup: nodes.join("\n  ") };
}

// Hierarchy tiers, in priority order. Whichever content group is actually
// present fills tier 0 (boldest) first — e.g. if there's no phone,
// website/address is promoted to the bold tier instead of always being #2.
const TIERS = [
  { maxRatio: 0.34, minRatio: 0.17, weight: 700, opacity: 1 },
  { maxRatio: 0.21, minRatio: 0.12, weight: 600, opacity: 0.92 },
  { maxRatio: 0.15, minRatio: 0.09, weight: 500, opacity: 0.76 },
];

// Vertical center (as a fraction of barHeight) per row, keyed by row count —
// keeps rows evenly spaced whether there are 1, 2, or 3 of them.
const ROW_CENTERS = {
  1: [0.58],
  2: [0.38, 0.74],
  3: [0.27, 0.54, 0.8],
};

/**
 * Build the bottom contact/handle bar as an SVG string. Only renders fields
 * that are actually set — never prints an empty placeholder.
 *
 * Content groups (in hierarchy order, promoted up if an earlier one is
 * missing): phone alone (boldest — the dominant CTA in every reference
 * poster) -> website + address together -> @handles (smallest, muted).
 *
 * The canvas is taller than the visible bar: the extra space at the top holds
 * a diagonal accent wedge behind the logo chip (an angled "ribbon" instead of
 * a flat rectangle, matching real auto-shop poster templates), while the
 * actual bar content sits at a fixed offset from the bottom so composePoster's
 * positioning math is unaffected.
 */
export function buildContactBarSvg({ width, barHeight, colors, contact, reservedLeftWidth = 0, logoChip = null } = {}) {
  const primary = colors?.primary || "#111111";
  const bgTop = shade(primary, 0.06);
  const bgBottom = shade(primary, -0.22);
  // `colors.secondary` is typically a muted neutral (e.g. brand grey), not a
  // pop color — using it for the wedge/hairline produced a muddy grey smear
  // against the primary-color gradient (visually confirmed on blue-rose-auto,
  // where secondary is #939598). Prefer an explicit `colors.accent` if the
  // brand kit defines one, else derive a brighter/lighter tint of the primary
  // itself so the wedge reads as "this brand's color, popped" rather than an
  // unrelated grey patch.
  const accent = colors?.accent || shade(primary, 0.42);
  const fg = "#ffffff";
  const c = contact || {};
  const handles = c.social_handles || {};
  const rightMargin = 24;
  const maxTextWidth = Math.max(width - reservedLeftWidth - rightMargin, 40);

  const groups = [];
  if (c.phone) groups.push([{ icon: "phone", text: c.phone }]);
  const line2 = [];
  if (c.website_display) line2.push({ icon: "globe", text: c.website_display });
  if (c.address) line2.push({ icon: "pin", text: c.address });
  if (line2.length) groups.push(line2);
  const handleParts = [];
  if (handles.instagram) handleParts.push(`@${handles.instagram.replace(/^@/, "")}`);
  if (handles.facebook) handleParts.push(handles.facebook.replace(/^@/, ""));
  if (handles.tiktok) handleParts.push(`@${handles.tiktok.replace(/^@/, "")} (TikTok)`);
  if (handleParts.length) groups.push([{ icon: null, text: handleParts.join("   ·   ") }]);

  const wedgeExtra = Math.round(barHeight * 0.32);
  const centers = ROW_CENTERS[groups.length] || [];

  const rowsMarkup = groups.map((tokens, i) => {
    const tier = TIERS[i] || TIERS[TIERS.length - 1];
    const bounds = { max: Math.round(barHeight * tier.maxRatio), min: Math.round(barHeight * tier.minRatio) };
    const tokensWithStyle = tokens.map((t) => ({ ...t, weight: tier.weight }));
    const measure = (fs) => layoutIconLine(tokensWithStyle, { fontSize: fs, rightX: 0, centerY: 0, color: fg }).totalWidth;
    const fontSize = fitFontSizeGeneric(measure, maxTextWidth, bounds);
    const centerY = wedgeExtra + Math.round(barHeight * (centers[i] ?? 0.5));
    return layoutIconLine(tokensWithStyle, { fontSize, rightX: width - rightMargin, centerY, color: fg, opacity: tier.opacity }).markup;
  });

  const chip = logoChip
    ? `<rect x="${logoChip.x}" y="${wedgeExtra + logoChip.y}" width="${logoChip.w}" height="${logoChip.h}" rx="${logoChip.rx}" fill="#ffffff" fill-opacity="0.96"/>`
    : "";

  // Diagonal accent wedge behind the logo — a ribbon-like flag that pokes up
  // into the photo above the flat bar, echoing the angled color blocks common
  // to real auto-shop poster ads (see module doc, v3 pass).
  const wedgeWidth = logoChip ? logoChip.x + logoChip.w + Math.round(barHeight * 0.4) : Math.round(width * 0.28);
  const wedge = `<polygon points="0,0 ${wedgeWidth},${wedgeExtra} ${wedgeWidth},${wedgeExtra + barHeight} 0,${wedgeExtra + barHeight}" fill="${accent}" fill-opacity="0.9"/>`;

  const canvasHeight = wedgeExtra + barHeight;

  return `<svg width="${width}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBottom}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${wedgeExtra}" width="${width}" height="${barHeight}" fill="url(#barGrad)" fill-opacity="0.95"/>
  ${wedge}
  <rect x="0" y="${wedgeExtra}" width="${width}" height="3" fill="${accent}"/>
  ${chip}
  ${rowsMarkup.join("\n  ")}
</svg>`;
}

/** Subtle brand-color wash over the whole background so the photo and the
 *  bar read as one designed piece, not two unrelated layers (soft-light
 *  blend, low opacity — tints without flattening the photo). */
async function colorWashBuffer(width, height, color, opacity) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="${color}" fill-opacity="${opacity}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Bottom-to-top dark gradient scrim so headline/benefit text stays legible
 *  over a busy photographic background (transparent at top → opaque at the
 *  bottom where the marketing block sits). */
async function scrimBuffer(width, height) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="40%" stop-color="#000" stop-opacity="0.12"/>
      <stop offset="70%" stop-color="#000" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.9"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#s)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Build a soft drop shadow from a logo's own alpha: a blurred black silhouette,
 * so a bare (chip-less) logo still separates cleanly from a busy photo. Returns
 * { shadow, width, height } — shadow is a PNG buffer sized to the padded canvas.
 */
async function logoShadowBuffer(logoResized, lw, lh, blur = 7) {
  const pad = Math.ceil(blur * 2);
  const canvasW = lw + pad * 2;
  const canvasH = lh + pad * 2;
  // Black canvas masked by the logo's alpha (dest-in keeps black only where the
  // logo is opaque), then blurred → a soft shadow shaped like the logo.
  const shadow = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: lw, height: lh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: pad, top: pad }])
    .composite([{ input: logoResized, left: pad, top: pad, blend: "dest-in" }])
    .blur(blur)
    .png()
    .toBuffer();
  return { shadow, pad, canvasW, canvasH };
}

/**
 * Ad-poster path: photo + brand wash + legibility scrim + the marketing text
 * layer (eyebrow/headline/subhead/benefits/CTA + contact strip, rendered by
 * poster_text_layer.js via Satori) + the logo composited SEPARATELY with sharp.
 *
 * The logo is drawn here rather than inside Satori because sharp's Lanczos
 * downscale from the original high-res asset (plus an alpha-derived soft shadow)
 * renders it markedly crisper than embedding it through resvg's image path.
 * Used when the caller supplies `copy` with a headline; otherwise composePoster
 * uses the legacy logo+contact-bar-only layout.
 */
async function composeAdPoster({ backgroundBuffer, brand, contact, copy, width, height, duotone }) {
  const logo = brand?.visual?.logo || {};
  const logoUrl = logo.primary_url || logo.reverse_url || logo.mono_url;

  const base = sharp(backgroundBuffer).resize(width, height, { fit: "cover" });
  const composites = [];
  if (duotone) {
    const washColor = brand?.visual?.colors?.primary || "#111111";
    composites.push({ input: await colorWashBuffer(width, height, washColor, 0.14), blend: "soft-light" });
  }
  composites.push({ input: await scrimBuffer(width, height), top: 0, left: 0 });

  const adLayer = await renderAdLayer({ width, height, brand, copy, contact });
  composites.push({ input: adLayer, top: 0, left: 0 });

  // Logo: crisp Lanczos downscale of the original + soft shadow, top-left inside
  // the same safe-zone padding the text layer uses (0.083 of the short edge).
  if (logoUrl) {
    let logoBuffer;
    try {
      logoBuffer = await fetchBuffer(logoUrl);
    } catch (e) {
      throw new PosterComposeError(`Failed to fetch logo from ${logoUrl}: ${e.message}`);
    }
    const pad = Math.round(Math.min(width, height) * 0.083);
    const logoH = Math.round(Math.min(width, height) * 0.15);
    const logoResized = await sharp(logoBuffer)
      .resize({ height: logoH, fit: "contain", kernel: "lanczos3" })
      .png()
      .toBuffer();
    const { width: lw, height: lh } = await sharp(logoResized).metadata();
    const { shadow, pad: sPad } = await logoShadowBuffer(logoResized, lw, lh);
    composites.push({ input: shadow, top: pad - sPad + Math.round(logoH * 0.03), left: pad - sPad });
    composites.push({ input: logoResized, top: pad, left: pad });
  }

  return base.composite(composites).png().toBuffer();
}

/**
 * Composite a logo + contact/handle bar onto a background image buffer.
 * Returns a PNG Buffer at the requested width/height. Throws PosterComposeError
 * if the logo can't be fetched — a poster without the logo is not a valid
 * poster for this feature (see checkPosterInputs in scripts/lib/guards.js for
 * the upstream preflight that should catch missing-logo cases earlier).
 */
export async function composePoster({ backgroundBuffer, brand, contact, copy = null, width = 1080, height = 1080, duotone = true } = {}) {
  // Ad-poster path: when the caller supplies real marketing copy (a headline),
  // render the full text layer (headline/subhead/benefits/CTA). Otherwise fall
  // back to the legacy logo + contact-bar-only branding.
  if (copy && copy.headline) {
    return composeAdPoster({ backgroundBuffer, brand, contact, copy, width, height, duotone });
  }

  const logo = brand?.visual?.logo || {};
  const barHeight = Math.round(height * 0.15);
  const logoUrl = logo.reverse_url || logo.primary_url || logo.mono_url;
  if (!logoUrl) throw new PosterComposeError("No usable logo URL on brand.visual.logo (primary_url/reverse_url/mono_url)");

  let logoBuffer;
  try {
    logoBuffer = await fetchBuffer(logoUrl);
  } catch (e) {
    throw new PosterComposeError(`Failed to fetch logo from ${logoUrl}: ${e.message}`);
  }

  const chipPadding = Math.round(barHeight * 0.22);
  const logoHeight = Math.round(barHeight * 0.5);
  const margin = Math.round(barHeight * 0.25);
  const logoResized = await sharp(logoBuffer).resize({ height: logoHeight, fit: "contain" }).toBuffer();
  const { width: logoWidth } = await sharp(logoResized).metadata();

  const chipW = (logoWidth || logoHeight) + chipPadding * 2;
  const chipH = logoHeight + chipPadding * 2;
  const chipX = margin;
  const chipY = Math.round((barHeight - chipH) / 2);
  const logoChip = { x: chipX, y: chipY, w: chipW, h: chipH, rx: Math.round(chipH * 0.24) };

  const reservedLeftWidth = chipX + chipW + Math.round(barHeight * 0.2);
  const barSvg = buildContactBarSvg({ width, barHeight, colors: brand?.visual?.colors, contact, reservedLeftWidth, logoChip });
  const barPng = await sharp(Buffer.from(barSvg)).png().toBuffer();
  const { height: barCanvasHeight } = await sharp(barPng).metadata();

  let base = sharp(backgroundBuffer).resize(width, height, { fit: "cover" });
  const composites = [];

  if (duotone) {
    const washColor = brand?.visual?.colors?.primary || "#111111";
    composites.push({ input: await colorWashBuffer(width, height, washColor, 0.14), blend: "soft-light" });
  }

  // logoTop/logoLeft are relative to the full image bottom, not the (taller)
  // bar canvas — the wedge's extra height only adds transparent space above
  // the actual bar content, so this math is unaffected by wedgeExtra.
  const logoTop = height - barHeight + chipY + chipPadding;
  const logoLeft = chipX + chipPadding;

  composites.push(
    { input: barPng, top: height - barCanvasHeight, left: 0 },
    { input: logoResized, top: logoTop, left: logoLeft },
  );

  return base.composite(composites).png().toBuffer();
}
