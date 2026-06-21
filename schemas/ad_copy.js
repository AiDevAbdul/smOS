// schemas/ad_copy.js — canonical shape for /creative output, consumed by /launch.
//
// Join key: angle_id (must equal the strategy_brief creative_angle's angle_id).
// This is the artifact whose drift produced `copy_used: null` for all 15 ads.
//
// Canonical per-angle shape:
//   {
//     angle_id:       "PAIN",            // join key — matches strategy_brief
//     name:           "PAIN",            // human label
//     hook_archetype: "Problem-led question",
//     format:         "reels_15_30s",
//     hooks:          ["...", "..."],                       // string[]
//     primary_text:   [{ text, score: { composite } }, ...],// scored variants
//     headlines:      [{ text, score: { composite } }, ...],
//     descriptions:   [{ text, score: { composite } }, ...],
//     ctas:           ["LEARN_MORE", ...]                   // string[]
//   }

import { pick, asArray, isNonEmptyString, angleId, result } from "./_shared.js";

/** Coerce a variant that may be a bare string or { text, score|scores } into
 *  the canonical { text, score: { composite } } shape. Accepts the /creative lint
 *  scorer's `scores.overall` as the composite. */
function normVariant(v) {
  if (isNonEmptyString(v)) return { text: v.trim(), score: { composite: null } };
  if (v && typeof v === "object") {
    const text = pick(v, "text", "value") ?? "";
    // accept score.composite, score.overall, scores.composite, scores.overall, or a bare number
    let composite = null;
    const score = pick(v, "score", "scores");
    if (score && typeof score === "object") composite = pick(score, "composite", "overall") ?? null;
    else if (typeof score === "number") composite = score;
    return { ...v, text, score: { composite } };
  }
  return { text: "", score: { composite: null } };
}

/** Detect the /creative lint per-angle shape, where copy variants are nested
 *  inside each hook combo (angle.hooks[] = [{ hook, primary_text, headlines, ctas }])
 *  rather than flat at the angle level. */
function isLintShape(a) {
  const hooks = asArray(pick(a, "hooks"));
  return hooks.length > 0 && hooks.every((h) => h && typeof h === "object" && ("primary_text" in h || "best_combo" in h));
}

/** Flatten the lint shape up to the canonical flat per-angle shape: every hook's
 *  text becomes a hooks[] entry; every nested primary_text/headline/cta is pooled
 *  at the angle level so the selector can pick the single best across all hooks. */
function flattenLintAngle(a) {
  const combos = asArray(pick(a, "hooks"));
  const hooks = [];
  const primary_text = [];
  const headlines = [];
  const descriptions = [];
  const ctas = [];
  for (const c of combos) {
    const hookText = isNonEmptyString(c.hook) ? c.hook : pick(c.hook, "text");
    if (isNonEmptyString(hookText)) hooks.push(hookText.trim());
    for (const p of asArray(c.primary_text)) primary_text.push(p);
    for (const h of asArray(c.headlines)) headlines.push(h);
    for (const d of asArray(c.descriptions)) descriptions.push(d);
    for (const ct of asArray(c.ctas)) ctas.push(ct);
  }
  return { ...a, hooks, primary_text, headlines, descriptions, ctas };
}

/** Coerce a CTA that may be a string or { type }/{ value } into a string. */
function normCta(c) {
  if (isNonEmptyString(c)) return c.trim();
  if (c && typeof c === "object") return pick(c, "type", "value", "cta") ?? "";
  return "";
}

function normAngle(rawAngle) {
  // Flatten /creative lint nesting first, so the rest of normalization is uniform.
  const a = isLintShape(rawAngle) ? flattenLintAngle(rawAngle) : rawAngle;
  const name = pick(a, "name", "label", "angle_name") ?? "";
  // hooks may be string[] or [{ text }]
  const hooks = asArray(pick(a, "hooks")).map((h) =>
    isNonEmptyString(h) ? h.trim() : pick(h, "text", "hook") ?? ""
  ).filter(Boolean);
  return {
    ...a,
    angle_id: pick(a, "angle_id") || angleId(name),
    name,
    hook_archetype: pick(a, "hook_archetype", "hook_family", "archetype") ?? "",
    format: pick(a, "format") ?? "",
    hooks,
    primary_text: asArray(pick(a, "primary_text", "primaries")).map(normVariant),
    headlines: asArray(pick(a, "headlines")).map(normVariant),
    descriptions: asArray(pick(a, "descriptions")).map(normVariant),
    ctas: asArray(pick(a, "ctas", "cta")).map(normCta).filter(Boolean),
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    generated_at: pick(r, "generated_at") ?? null,
    angles: asArray(pick(r, "angles")).map(normAngle),
    summary: pick(r, "summary") ?? null,
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["ad_copy is not an object"]);
  if (!Array.isArray(obj.angles) || obj.angles.length === 0) {
    errors.push("ad_copy.angles must be a non-empty array");
  }
  (obj.angles || []).forEach((a, i) => {
    if (!isNonEmptyString(a.angle_id)) errors.push(`angles[${i}].angle_id is missing (join key)`);
    if (!isNonEmptyString(a.name)) errors.push(`angles[${i}].name is missing`);
    const hasCopy =
      (a.primary_text || []).some((p) => isNonEmptyString(p.text)) ||
      (a.hooks || []).length > 0;
    if (!hasCopy) errors.push(`angles[${i}] (${a.angle_id || "?"}) has no usable primary_text or hooks`);
  });
  return result(errors);
}

/**
 * The launch-side selector, living next to the schema so producer + consumer can
 * never disagree on field names again. Returns the canonical copy_used payload
 * for a given strategy_brief angle, or null with a reason.
 *
 * Match is on angle_id (exact), then name (exact), then loose name-contains.
 */
export function selectTopCopy(briefAngle, adCopy) {
  const copy = normalize(adCopy);
  const wantId = briefAngle.angle_id || angleId(briefAngle.name || briefAngle.angle || "");
  const wantName = (briefAngle.name || "").toUpperCase();

  let found =
    copy.angles.find((a) => a.angle_id && a.angle_id === wantId) ||
    copy.angles.find((a) => (a.name || "").toUpperCase() === wantName) ||
    copy.angles.find((a) => {
      const tag = (a.angle_id || a.name || "").toUpperCase();
      return wantName && (tag.includes(wantName) || wantName.includes(tag));
    });

  if (!found) return { copy_used: null, reason: `no ad_copy angle matched angle_id='${wantId}'` };

  const byScore = (arr) =>
    [...(arr || [])].sort((x, y) => (y.score?.composite ?? 0) - (x.score?.composite ?? 0));
  const primary = byScore(found.primary_text)[0];
  const headline = byScore(found.headlines)[0];
  const description = byScore(found.descriptions)[0];

  const text = primary?.text || found.hooks?.[0] || "";
  if (!text) return { copy_used: null, reason: `ad_copy angle '${found.angle_id}' had no primary_text or hooks` };

  return {
    copy_used: {
      angle_id: found.angle_id,
      primary_text: text,
      headline: headline?.text ?? null,
      description: description?.text ?? null,
      cta: found.ctas?.[0] || "LEARN_MORE",
      score_composite: primary?.score?.composite ?? null,
    },
    reason: null,
  };
}
