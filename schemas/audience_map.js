// schemas/audience_map.js — canonical shape for /audience-map output.
// Consumed by /launch (builds adset targeting) and /strategy-brief (audience priority).
//
// Drift this fixes:
//   producer emits: interest_clusters / geo.targets / cluster.interests
//   consumer reads: clusters        / geo.primary  / cluster.interest_stack
//                                                   + cluster.behavioral_add_ons
//
// Canonical:
//   clusters: [{ id, label, interest_stack: string[], behavioral_add_ons: string[],
//                size_estimate_lower, size_estimate_upper }]
//   geo: { primary, targets: string[], radius, center }
//   retargeting_layers: [...]  (RT/LAL specs consumed by audience resolution, H5)

import { pick, asArray, isNonEmptyString, result } from "./_shared.js";

/** interests may be string[] or [{ name }]/[{ id, name }] -> string[] of names. */
function toNameList(v) {
  return asArray(v)
    .map((x) => (isNonEmptyString(x) ? x.trim() : pick(x, "name", "label", "id")))
    .filter(isNonEmptyString);
}

function normCluster(c) {
  const stack = pick(c, "interest_stack", "interests");
  return {
    ...c,
    id: pick(c, "id") ?? null,
    label: pick(c, "label", "name") ?? "",
    interest_stack: toNameList(stack),
    behavioral_add_ons: toNameList(pick(c, "behavioral_add_ons", "behaviors")),
    size_estimate_lower: pick(c, "size_estimate_lower") ?? null,
    size_estimate_upper: pick(c, "size_estimate_upper") ?? null,
  };
}

function normGeo(g) {
  if (!g || typeof g !== "object") return { primary: null, targets: [], radius: null, center: null };
  const targets = asArray(pick(g, "targets", "primary")).filter(Boolean);
  return {
    ...g,
    // `primary` is the single headline geo; fall back to first target / center.
    primary: pick(g, "primary") ?? targets[0] ?? pick(g, "center") ?? null,
    targets,
    radius: pick(g, "radius") ?? null,
    center: pick(g, "center") ?? null,
  };
}

export function normalize(raw) {
  const r = raw || {};
  return {
    ...r,
    client_slug: pick(r, "client_slug", "slug") ?? null,
    clusters: asArray(pick(r, "clusters", "interest_clusters")).map(normCluster),
    geo: normGeo(pick(r, "geo")),
    retargeting_layers: asArray(pick(r, "retargeting_layers", "retargeting")),
  };
}

export function validate(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return result(["audience_map is not an object"]);
  if (!Array.isArray(obj.clusters) || obj.clusters.length === 0) {
    errors.push("audience_map.clusters must be a non-empty array");
  }
  (obj.clusters || []).forEach((c, i) => {
    if (!isNonEmptyString(c.id)) errors.push(`clusters[${i}].id is missing (join key for launch targeting)`);
    if (!Array.isArray(c.interest_stack) || c.interest_stack.length === 0) {
      errors.push(`clusters[${i}] (${c.id || "?"}) has empty interest_stack`);
    }
  });
  if (!obj.geo || !isNonEmptyString(obj.geo.primary)) {
    errors.push("audience_map.geo.primary is missing");
  }
  return result(errors);
}
