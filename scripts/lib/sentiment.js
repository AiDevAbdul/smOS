// scripts/lib/sentiment.js — shared sentiment normalization/merge for
// /listening's mention.sentiment and /inbox's item.sentiment (G8).
//
// Neither skill runs its own model call — matching the rest of the engine
// (video_scoring.js, opportunity.js, etc.), classification judgment stays with
// the agent running the skill, not a script. What was missing is a single,
// validated place to MERGE that judgment in: the running agent reads each new
// mention/comment's text and writes its verdicts to a sidecar capture file
// (same convention as listening_capture.json), and this module merges + fail-
// closed-validates them onto the record. Anything not exactly positive/neutral/
// negative collapses to null — "never invent a sentiment" stays true even when
// the input is malformed.

const ALLOWED = new Set(["positive", "neutral", "negative"]);

/** Coerce any input to a valid sentiment value or null. Never guesses. */
export function normalizeSentiment(value) {
  if (value == null) return null;
  const v = String(value).toLowerCase().trim();
  return ALLOWED.has(v) ? v : null;
}

/**
 * Merge classifier judgments (a map or array of {id, sentiment}) onto a list of
 * records keyed by `idField` (default "id"). Only fills currently-null
 * sentiment — never overwrites an existing human/prior verdict — and only with
 * a validated value. Returns a NEW array; does not mutate the input.
 */
export function applySentiment(records, judgments, { idField = "id", sentimentField = "sentiment" } = {}) {
  // Judgments are always keyed by a plain `id` field regardless of what the
  // records array itself calls its identifier (idField only applies to records).
  const map = judgments instanceof Map
    ? judgments
    : new Map(
        Array.isArray(judgments)
          ? judgments.map((j) => [j.id, j.sentiment ?? j[sentimentField]])
          : Object.entries(judgments || {})
      );

  return (records || []).map((r) => {
    if (r[sentimentField] != null) return r; // never overwrite an existing verdict
    const id = r[idField];
    if (id == null || !map.has(id)) return r;
    const normalized = normalizeSentiment(map.get(id));
    return normalized == null ? r : { ...r, [sentimentField]: normalized };
  });
}

/** Records that still need a judgment — the list an agent should read + classify. */
export function pendingSentiment(records, { textField = "text", sentimentField = "sentiment", idField = "id" } = {}) {
  return (records || [])
    .filter((r) => r[sentimentField] == null && r[textField])
    .map((r) => ({ id: r[idField], text: r[textField] }));
}
