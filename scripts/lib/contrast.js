/**
 * WCAG 2.x contrast math for brand palettes (E2).
 *
 * Why this is a GUARD and not a lint: /brand-visual can approve a palette whose
 * primary is unreadable on its own neutrals (pale yellow on white, mid-grey on
 * light grey). Everything downstream — the brand book, social templates, poster
 * text layer, ad creative — then inherits an illegible brand and nothing in the
 * pipeline notices, because no step ever measured it. The math is deterministic,
 * so this is one of the few things a guard can decide without guessing.
 *
 * Formula (WCAG 2.2 §1.4.3):
 *   channel c ∈ [0,1]:  c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4
 *   L = 0.2126·R + 0.7152·G + 0.0722·B
 *   ratio = (Llighter + 0.05) / (Ldarker + 0.05)   → 1.0 … 21.0
 *
 * Thresholds: 4.5:1 normal text (AA), 3.0:1 large text / UI components (AA),
 * 7.0:1 normal text (AAA).
 */

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;
export const AAA_NORMAL = 7.0;

/** Parse #rgb / #rrggbb (with or without '#') → {r,g,b} 0–255, or null. */
export function parseHex(hex) {
  if (typeof hex !== "string") return null;
  const s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) {
    const [r, g, b] = s.split("").map((c) => parseInt(c + c, 16));
    return { r, g, b };
  }
  if (/^[0-9a-f]{6}$/i.test(s)) {
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return null;
}

/** WCAG relative luminance (0 = black, 1 = white). Returns null for a bad hex. */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** Contrast ratio between two hexes (1–21), rounded to 2dp. null if either is unparseable. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** "AAA" | "AA" | "AA-large" | "fail" for a ratio. */
export function wcagLevel(ratio) {
  if (!Number.isFinite(ratio)) return "fail";
  if (ratio >= AAA_NORMAL) return "AAA";
  if (ratio >= AA_NORMAL) return "AA";
  if (ratio >= AA_LARGE) return "AA-large";
  return "fail";
}

/** Pick the more readable of black/white for a background — used by renderers. */
export function readableOn(hex) {
  const onWhite = contrastRatio(hex, "#ffffff") ?? 1;
  const onBlack = contrastRatio(hex, "#000000") ?? 1;
  return onBlack >= onWhite ? "#000000" : "#ffffff";
}

// The neutral canvases assumed when a brand declares no neutrals of its own. A
// brand color that can't reach AA on plain white has nowhere legible to live.
export const DEFAULT_NEUTRALS = ["#ffffff"];

/**
 * Score a brand palette. Pure — pass `brand_profile.visual.colors`.
 *
 * `primary` is BLOCKING: it must reach `min` against at least one neutral in its
 * own palette (its best pairing is the one a designer would actually use).
 * `secondary`/`accent` are reported as warnings, not blocks — they legitimately
 * exist as fills/washes that never carry text.
 *
 * @returns {{ok, min, backgrounds, pairs, failures, warnings, message}}
 */
export function checkPalette(colors = {}, { min = AA_NORMAL } = {}) {
  const neutrals = (Array.isArray(colors.neutrals) ? colors.neutrals : [])
    .filter((c) => parseHex(c));
  const backgrounds = neutrals.length ? neutrals : DEFAULT_NEUTRALS;

  const roles = [
    ["primary", colors.primary, true],
    ["secondary", colors.secondary, false],
    ["accent", colors.accent, false],
  ];

  const pairs = [];
  const failures = [];
  const warnings = [];

  for (const [role, hex, blocking] of roles) {
    if (!hex) continue;
    if (!parseHex(hex)) {
      const msg = `colors.${role} "${hex}" is not a valid hex color`;
      (blocking ? failures : warnings).push(msg);
      continue;
    }
    let best = null;
    for (const bg of backgrounds) {
      const ratio = contrastRatio(hex, bg);
      const pair = { role, fg: hex, bg, ratio, level: wcagLevel(ratio), pass: ratio >= min };
      pairs.push(pair);
      if (!best || ratio > best.ratio) best = pair;
    }
    if (best && !best.pass) {
      const msg =
        `colors.${role} ${hex} reaches only ${best.ratio}:1 on its best neutral ${best.bg} ` +
        `(needs ${min}:1 for body text)`;
      (blocking ? failures : warnings).push(msg);
    }
  }

  const ok = failures.length === 0;
  return {
    ok,
    min,
    backgrounds,
    pairs,
    failures,
    warnings,
    message: ok
      ? `Palette passes WCAG ${min}:1 on ${backgrounds.join(", ")}.`
      : failures.join("; "),
  };
}
