/**
 * Real brand-asset rendering (E1).
 *
 * Before this, /brand-visual and /brand-social RECORDED asset urls but produced
 * no bytes — brand_profile.json claimed a logo, a profile picture and a Facebook
 * cover that did not exist anywhere on disk. Every downstream consumer (the
 * brand book, /assets, the poster compositor, /setup-accounts' upload step)
 * therefore either broke or silently shipped nothing.
 *
 * This module renders the actual files, deterministically, with the same
 * pipeline the ad poster text layer already trusts: Satori (flexbox → SVG with
 * the bundled brand fonts embedded as glyph paths) → resvg-js (SVG → PNG). No
 * host fonts, no network, no AI — the same brand profile always produces the
 * same bytes.
 *
 * What it produces (and what it honestly is): a clean geometric MONOGRAM
 * identity system — mark, wordmark, horizontal lockup, mono and reverse
 * variants — plus the applied social surface (profile picture, FB cover,
 * IG highlight covers, post/story templates) built from the approved palette
 * and typography. That is a real, usable starter identity, not a designed
 * bespoke logo; /brand-visual's SKILL.md says so, and a client who commissions
 * custom logo art replaces logo.primary_url with their designer's file.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { posterFonts, FONT_FAMILIES } from "./poster_fonts.js";
import { readableOn, contrastRatio } from "./contrast.js";
import { clientDeliverableDir, repoRoot } from "./paths.js";

const el = (type, style, children) => ({
  type,
  props: { style, ...(children !== undefined ? { children } : {}) },
});

/** Canonical output sizes (2026 platform specs — see content-plan/references/platform-specs.md). */
export const ASSET_SPECS = {
  logo_primary: { w: 1600, h: 400 },
  logo_mark: { w: 512, h: 512 },
  logo_wordmark: { w: 1600, h: 360 },
  logo_mono: { w: 1600, h: 400 },
  logo_reverse: { w: 1600, h: 400 },
  profile_picture: { w: 1080, h: 1080 },
  fb_cover: { w: 1640, h: 856 },       // safe zone ≈ centre 1090×360
  ig_highlight: { w: 1080, h: 1080 },
  post_template: { w: 1080, h: 1350 }, // IG feed 4:5
  story_template: { w: 1080, h: 1920 },
};

export const DEFAULT_HIGHLIGHTS = ["About", "Services", "Reviews", "Contact"];

export class BrandRenderError extends Error {
  constructor(message) { super(message); this.name = "BrandRenderError"; }
}

/** Up to two initials from the brand name ("Blue Rose Auto" → "BR", "Acme" → "A"). */
export function initialsFor(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "•";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function palette(brand) {
  const c = brand?.visual?.colors || {};
  const neutrals = Array.isArray(c.neutrals) ? c.neutrals.filter(Boolean) : [];
  const primary = c.primary || "#1d5dbf";
  // Lightest neutral = the canvas; darkest = the ink. Falls back to plain
  // white/near-black when the brand declared none, rather than inventing a hue.
  const byLight = [...neutrals].sort(
    (a, b) => (contrastRatio(b, "#000000") ?? 0) - (contrastRatio(a, "#000000") ?? 0)
  );
  return {
    primary,
    secondary: c.secondary || primary,
    accent: c.accent || primary,
    canvas: byLight[0] || "#ffffff",
    ink: byLight[byLight.length - 1] || "#111111",
    onPrimary: readableOn(primary),
  };
}

async function toSvg(element, { w, h }, brand) {
  return satori(element, { width: w, height: h, fonts: posterFonts(brand) });
}

function toPng(svg, width) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return r.render().asPng();
}

// ───────────────────────────── element builders ─────────────────────────────

/** The mark: initials centered in a rounded-square tile. */
function markEl({ size, initials, fill, fg, transparent = false }) {
  return el(
    "div",
    {
      width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center",
      backgroundColor: transparent ? "transparent" : fill,
      borderRadius: Math.round(size * 0.22),
      ...(transparent ? { border: `${Math.round(size * 0.07)}px solid ${fg}` } : {}),
    },
    el("div", {
      display: "flex", fontFamily: FONT_FAMILIES.display, fontWeight: 600,
      fontSize: Math.round(size * 0.46), color: fg, letterSpacing: -Math.round(size * 0.01), lineHeight: 1,
    }, initials)
  );
}

function wordmarkEl({ text, tagline, fontSize, color, subColor }) {
  const children = [
    el("div", {
      display: "flex", fontFamily: FONT_FAMILIES.display, fontWeight: 600,
      fontSize, color, letterSpacing: -Math.round(fontSize * 0.02), lineHeight: 1.05,
    }, text),
  ];
  if (tagline) {
    children.push(el("div", {
      display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 500,
      fontSize: Math.round(fontSize * 0.26), color: subColor,
      letterSpacing: Math.round(fontSize * 0.03), marginTop: Math.round(fontSize * 0.12),
      textTransform: "uppercase",
    }, tagline));
  }
  return el("div", { display: "flex", flexDirection: "column", justifyContent: "center" }, children);
}

function lockupEl({ w, h, name, tagline, p, variant }) {
  // variant: "color" | "mono" | "reverse"
  const markFill = variant === "color" ? p.primary : variant === "mono" ? p.ink : "#ffffff";
  const markFg = variant === "color" ? p.onPrimary : variant === "mono" ? "#ffffff" : p.primary;
  const textColor = variant === "reverse" ? "#ffffff" : variant === "mono" ? p.ink : p.ink;
  const subColor = variant === "reverse" ? "rgba(255,255,255,0.72)" : p.secondary;
  const size = Math.round(h * 0.62);
  return el(
    "div",
    {
      width: w, height: h, display: "flex", alignItems: "center",
      backgroundColor: "transparent", paddingLeft: Math.round(h * 0.12),
    },
    [
      markEl({ size, initials: initialsFor(name), fill: markFill, fg: markFg }),
      el("div", { display: "flex", width: Math.round(h * 0.16) }),
      wordmarkEl({ text: name, tagline, fontSize: Math.round(h * 0.34), color: textColor, subColor }),
    ]
  );
}

function profilePictureEl({ size, name, p }) {
  // Rendered square; every platform crops it to a circle, so the monogram sits
  // inside the inscribed circle with margin to spare.
  return el(
    "div",
    { width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.primary },
    el("div", {
      display: "flex", fontFamily: FONT_FAMILIES.display, fontWeight: 600,
      fontSize: Math.round(size * 0.4), color: p.onPrimary, lineHeight: 1,
    }, initialsFor(name))
  );
}

function coverEl({ w, h, name, tagline, p }) {
  // FB cover crops hard on mobile — everything lives in the centred safe zone.
  return el(
    "div",
    { width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.ink, position: "relative" },
    [
      el("div", {
        position: "absolute", left: 0, top: 0, width: Math.round(w * 0.014), height: h,
        backgroundColor: p.primary, display: "flex",
      }),
      el("div", { display: "flex", flexDirection: "column", alignItems: "center", width: 1090, height: 360, justifyContent: "center" }, [
        markEl({ size: Math.round(h * 0.2), initials: initialsFor(name), fill: p.primary, fg: p.onPrimary }),
        el("div", {
          display: "flex", fontFamily: FONT_FAMILIES.display, fontWeight: 600,
          fontSize: Math.round(h * 0.115), color: "#ffffff", marginTop: Math.round(h * 0.04), lineHeight: 1.05,
        }, name),
        ...(tagline ? [el("div", {
          display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 500,
          fontSize: Math.round(h * 0.042), color: "rgba(255,255,255,0.78)",
          marginTop: Math.round(h * 0.022), letterSpacing: 2, textTransform: "uppercase",
        }, tagline)] : []),
      ]),
    ]
  );
}

function highlightEl({ size, label, p }) {
  return el(
    "div",
    { width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: p.canvas },
    [
      el("div", {
        display: "flex", fontFamily: FONT_FAMILIES.display, fontWeight: 600,
        fontSize: Math.round(size * 0.16), color: p.primary, lineHeight: 1,
      }, String(label || "").slice(0, 2).toUpperCase()),
      el("div", {
        display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 500,
        fontSize: Math.round(size * 0.062), color: p.ink, marginTop: Math.round(size * 0.05),
        letterSpacing: Math.round(size * 0.006), textTransform: "uppercase",
      }, label),
    ]
  );
}

/** An empty branded frame a designer/producer fills with the post's own artwork. */
function templateEl({ w, h, name, p, kind }) {
  const barH = Math.round(h * 0.085);
  return el(
    "div",
    { width: w, height: h, display: "flex", flexDirection: "column", backgroundColor: p.canvas },
    [
      el("div", { display: "flex", width: w, height: Math.round(h * 0.012), backgroundColor: p.primary }),
      el("div", {
        display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center",
        margin: Math.round(w * 0.055), border: `${Math.max(2, Math.round(w * 0.003))}px dashed ${p.secondary}`,
      }, el("div", {
        display: "flex", fontFamily: FONT_FAMILIES.body, fontWeight: 500,
        fontSize: Math.round(w * 0.032), color: p.secondary, letterSpacing: 2, textTransform: "uppercase",
      }, `${kind} artwork area`)),
      el("div", {
        display: "flex", width: w, height: barH, alignItems: "center", paddingLeft: Math.round(w * 0.055),
        backgroundColor: p.primary,
      }, el("div", {
        display: "flex", fontFamily: FONT_FAMILIES.display, fontWeight: 600,
        fontSize: Math.round(barH * 0.42), color: p.onPrimary, lineHeight: 1,
      }, name)),
    ]
  );
}

// ───────────────────────────── writers ─────────────────────────────

/** Where a client's rendered brand assets live: deliverables/brand-assets/. */
export function brandAssetDir(slug) {
  return clientDeliverableDir(slug, "brand-assets");
}

/** Repo-relative POSIX path — what gets written into brand_profile.json. Falls
 *  back to the absolute path when SMOS_DATA_ROOT points outside the repo (tests,
 *  scratch runs), so a url is never a "../../.." walk out of the tree. */
function relUrl(abs) {
  const root = repoRoot();
  const rel = relative(root, abs);
  if (rel.startsWith("..")) return abs.split(/[\\/]/).join("/");
  return rel.split(/[\\/]/).join("/");
}

async function writeAsset(dir, base, element, spec, brand, { svg = true } = {}) {
  const svgStr = await toSvg(element, spec, brand);
  const out = {};
  if (svg) {
    const p = resolve(dir, `${base}.svg`);
    writeFileSync(p, svgStr);
    out.svg = relUrl(p);
  }
  const pngPath = resolve(dir, `${base}.png`);
  writeFileSync(pngPath, toPng(svgStr, spec.w));
  out.png = relUrl(pngPath);
  return out;
}

function requireName(brand) {
  const name = brand?.verbal?.name;
  if (!name) throw new BrandRenderError("brand_profile.verbal.name is required to render brand assets");
  return name;
}

/**
 * Render the logo system. Returns the patch for `brand_profile.visual.logo`.
 * @returns {Promise<{logo: object, files: string[]}>}
 */
export async function renderLogoSystem(slug, brand) {
  const name = requireName(brand);
  const tagline = brand?.verbal?.tagline || null;
  const p = palette(brand);
  const dir = brandAssetDir(slug);
  mkdirSync(dir, { recursive: true });

  const S = ASSET_SPECS;
  const primary = await writeAsset(dir, "logo-primary", lockupEl({ ...S.logo_primary, name, tagline, p, variant: "color" }), S.logo_primary, brand);
  const mono = await writeAsset(dir, "logo-mono", lockupEl({ ...S.logo_mono, name, tagline, p, variant: "mono" }), S.logo_mono, brand);
  const reverse = await writeAsset(dir, "logo-reverse", lockupEl({ ...S.logo_reverse, name, tagline, p, variant: "reverse" }), S.logo_reverse, brand);
  const mark = await writeAsset(dir, "logo-mark", markEl({ size: S.logo_mark.w, initials: initialsFor(name), fill: p.primary, fg: p.onPrimary }), S.logo_mark, brand);
  const wordmark = await writeAsset(
    dir, "logo-wordmark",
    el("div", { width: S.logo_wordmark.w, height: S.logo_wordmark.h, display: "flex", alignItems: "center", paddingLeft: 40 },
      wordmarkEl({ text: name, tagline, fontSize: Math.round(S.logo_wordmark.h * 0.42), color: p.ink, subColor: p.secondary })),
    S.logo_wordmark, brand
  );

  return {
    logo: {
      primary_url: primary.png,
      svg_url: primary.svg,
      mark_url: mark.png,
      wordmark_url: wordmark.png,
      mono_url: mono.png,
      reverse_url: reverse.png,
      clear_space: "Clear space on all sides = the height of the monogram mark ÷ 2.",
      min_size: "Lockup: 120px wide (digital) / 25mm (print). Mark alone below that.",
    },
    files: [primary, mono, reverse, mark, wordmark].flatMap((a) => [a.svg, a.png].filter(Boolean)),
  };
}

/**
 * Render the applied social surface. Returns the patch for `brand_profile.social`.
 * @param {string[]} [highlights] highlight cover labels
 */
export async function renderSocialAssets(slug, brand, { highlights = DEFAULT_HIGHLIGHTS } = {}) {
  const name = requireName(brand);
  const tagline = brand?.verbal?.tagline || null;
  const p = palette(brand);
  const dir = brandAssetDir(slug);
  mkdirSync(dir, { recursive: true });

  const S = ASSET_SPECS;
  const pfp = await writeAsset(dir, "profile-picture", profilePictureEl({ size: S.profile_picture.w, name, p }), S.profile_picture, brand, { svg: false });
  const cover = await writeAsset(dir, "fb-cover", coverEl({ ...S.fb_cover, name, tagline, p }), S.fb_cover, brand, { svg: false });

  const covers = [];
  for (const label of highlights) {
    const slugged = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const a = await writeAsset(dir, `highlight-${slugged}`, highlightEl({ size: S.ig_highlight.w, label, p }), S.ig_highlight, brand, { svg: false });
    covers.push({ label, url: a.png });
  }

  const post = await writeAsset(dir, "template-post", templateEl({ ...S.post_template, name, p, kind: "Post" }), S.post_template, brand, { svg: false });
  const story = await writeAsset(dir, "template-story", templateEl({ ...S.story_template, name, p, kind: "Story" }), S.story_template, brand, { svg: false });

  return {
    social: {
      profile_picture_url: pfp.png,
      fb_cover_url: cover.png,
      ig_highlight_covers: covers,
      templates: [
        { name: "Feed post 4:5", size: `${S.post_template.w}×${S.post_template.h}`, url: post.png },
        { name: "Story 9:16", size: `${S.story_template.w}×${S.story_template.h}`, url: story.png },
      ],
    },
    files: [pfp.png, cover.png, ...covers.map((c) => c.url), post.png, story.png],
  };
}

/** Render everything. `kinds` selects: "logo" | "social". */
export async function renderBrandAssets(slug, brand, { kinds = ["logo", "social"], highlights } = {}) {
  const out = { slug, dir: relUrl(brandAssetDir(slug)), files: [] };
  if (kinds.includes("logo")) {
    const r = await renderLogoSystem(slug, brand);
    out.logo = r.logo;
    out.files.push(...r.files);
  }
  if (kinds.includes("social")) {
    const r = await renderSocialAssets(slug, brand, highlights ? { highlights } : {});
    out.social = r.social;
    out.files.push(...r.files);
  }
  return out;
}
