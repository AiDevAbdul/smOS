// schemas/strategy_brief.js — canonical shape for /strategy-brief output.
// Consumed by /creative (reads creative_angles) and /launch (reads campaign plan).
//
// CRITICAL: every creative_angle MUST carry a stable angle_id. That id is the
// join key /creative stamps onto each ad_copy angle and /launch matches on. Today
// the brief only carries `name` ("PAIN"), so we derive angle_id from name when
// absent — making the brief the authoritative source of join keys going forward.

import { pick, asArray, isNonEmptyString, angleId, result } from "./_shared.js";

function normAngle(a) {
  const name = pick(a, "name", "label") ?? "";
  return {
    ...a,
    angle_id: pick(a, "angle_id") || angleId(name),
    name,
    angle: pick(a, "angle", "direction", "description") ?? "",
    hook_archetype: pick(a, "hook_archetype", "archetype") ?? "",
    format: pick(a, "format") ?? "",
    prompt: pick(a, "prompt") ?? "",
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    slug: pick(r, "slug", "client_slug") ?? null,
    generated_at: pick(r, "generated_at") ?? null,
    creative_angles: asArray(pick(r, "creative_angles", "angles")).map(normAngle),
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["strategy_brief is not an object"]);
  if (!Array.isArray(obj.creative_angles) || obj.creative_angles.length === 0) {
    errors.push("strategy_brief.creative_angles must be a non-empty array");
  }
  const seen = new Set();
  (obj.creative_angles || []).forEach((a, i) => {
    if (!isNonEmptyString(a.angle_id)) errors.push(`creative_angles[${i}].angle_id is missing (join key)`);
    else if (seen.has(a.angle_id)) errors.push(`creative_angles[${i}].angle_id '${a.angle_id}' is duplicated`);
    else seen.add(a.angle_id);
    if (!isNonEmptyString(a.name)) errors.push(`creative_angles[${i}].name is missing`);
  });
  return result(errors);
}
