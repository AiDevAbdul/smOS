// schemas/competitor_intel.js — canonical shape for /research output, consumed by
// /strategy-brief (which reads competitor_intel.angles to pick creative angles).
//
// Drift this fixes: research wrote { competitors, gaps } but never an `angles`
// array; strategy-brief reads `.angles` and got [] every time → angle selection
// fell back to nothing. normalize() derives `angles` from competitors[].angles
// when a top-level angles array is absent.

import { pick, asArray, isNonEmptyString, result } from "./_shared.js";

function normAngle(a) {
  if (isNonEmptyString(a)) return { angle: a.trim(), frequency: null, fit_for_client: null, use_for: [], notes: "" };
  const o = a || {};
  return {
    ...o,
    angle: pick(o, "angle", "name", "theme") ?? "",
    frequency: pick(o, "frequency") ?? null,
    fit_for_client: pick(o, "fit_for_client", "fit") ?? null,
    use_for: asArray(pick(o, "use_for")),
    notes: pick(o, "notes") ?? "",
  };
}

export function normalize(raw) {
  const r = raw || {};
  const competitors = asArray(pick(r, "competitors", "pages"));
  // Prefer an explicit top-level angles array; otherwise aggregate from competitors.
  let angles = asArray(pick(r, "angles"));
  if (angles.length === 0) {
    const seen = new Set();
    for (const c of competitors) {
      for (const a of asArray(pick(c, "angles"))) {
        const norm = normAngle(a);
        const key = (norm.angle || "").toUpperCase();
        if (key && !seen.has(key)) { seen.add(key); angles.push(norm); }
      }
    }
  } else {
    angles = angles.map(normAngle);
  }
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    competitors,
    gaps: asArray(pick(r, "gaps")),
    angles,
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["competitor_intel is not an object"]);
  if (!Array.isArray(obj.angles)) errors.push("competitor_intel.angles must be an array");
  // angles MAY legitimately be empty when competitor URLs don't resolve; that is a
  // degraded-but-valid state. strategy-brief handles empty by using its defaults.
  return result(errors);
}
