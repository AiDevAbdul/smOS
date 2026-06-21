// schemas/_shared.js — shared primitives for every canonical artifact schema.
//
// Philosophy (Phase 1.1 of the expert-review remediation):
//   - normalize(raw): LENIENT. Accepts today's drifted field names (aliases) and
//     coerces to ONE canonical shape. Never throws. Producers call this before
//     writing; consumers call this after reading. Both then see identical keys.
//   - validate(obj): FAIL-CLOSED. Returns { ok, errors[] } listing every missing
//     or malformed REQUIRED field. Consumers halt on !ok rather than silently
//     reading null (matches CLAUDE.md "halt and ask for the missing field").
//
// The whole point: producer and consumer import the SAME module, so a rename can
// never again break a handoff silently — the validator names the offending field.

export class SchemaError extends Error {
  constructor(artifact, errors) {
    super(`${artifact} failed schema validation:\n  - ${errors.join("\n  - ")}`);
    this.name = "SchemaError";
    this.artifact = artifact;
    this.errors = errors;
  }
}

/** First non-undefined/non-null value among the given keys on obj. */
export function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Stable, deterministic angle_id from a human angle name. This is THE join key
 * across strategy_brief -> ad_copy -> launch_plan. Must be pure (no randomness,
 * no timestamps) so the same angle always produces the same id on every run.
 *   "PAIN"            -> "PAIN"
 *   "Pain / Problem"  -> "PAIN_PROBLEM"
 */
export function angleId(name) {
  if (!isNonEmptyString(name)) return "";
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Build a { ok, errors } result; ok iff errors is empty. */
export function result(errors) {
  return { ok: errors.length === 0, errors };
}

/**
 * Assert a normalized object validates, or throw SchemaError. Producers use this
 * right before writeFileSync; consumers use it right after readFileSync+normalize.
 */
export function assertValid(artifact, obj, validateFn) {
  const r = validateFn(obj);
  if (!r.ok) throw new SchemaError(artifact, r.errors);
  return obj;
}
