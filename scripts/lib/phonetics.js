/**
 * Name-confusability math for the /brand-name trademark + domain screen (E3).
 *
 * Why: the old knockout searched the candidate's exact spelling only. Trademark law
 * does not work that way — likelihood of confusion turns on sight, sound and
 * meaning, so "Klaritee" collides with a live "Clarity" mark and an exact-string
 * search reports a clean sheet. That is the one failure mode a knockout filter must
 * not have: a false "clear" that reads as permission to spend money on the name.
 *
 * So we screen three ways and OR the hits:
 *   1. soundex        — classic sound-alike bucket (survives vowel churn)
 *   2. consonant skeleton — vowels dropped, confusable digraphs folded (PH→F, CK→K,
 *      soft C→S, X→KS, Z→S). Catches respellings soundex misses.
 *   3. edit distance  — normalized Levenshtein for typo-level neighbours.
 *
 * `spellingVariants()` expands a candidate into the respellings a human examiner
 * would also search, so the USPTO query set (or the manual TESS list we hand the
 * operator) covers the neighbourhood, not one point in it.
 *
 * All of this still only rules names OUT. Nothing here is clearance — an attorney
 * signs off, and `attorney_clearance_flagged` stays true unconditionally.
 */

const SOUNDEX_CODES = {
  b: "1", f: "1", p: "1", v: "1",
  c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
  d: "3", t: "3",
  l: "4",
  m: "5", n: "5",
  r: "6",
};

/** Lowercase, strip everything but a–z. */
export function normalizeName(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Standard Soundex (4 chars, e.g. "clarity" → "C463"). "" for empty input. */
export function soundex(input) {
  const s = normalizeName(input);
  if (!s) return "";
  const first = s[0];
  let out = first.toUpperCase();
  let prev = SOUNDEX_CODES[first] || "";
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const ch = s[i];
    const code = SOUNDEX_CODES[ch] || "";
    if (code) {
      // A same-coded pair separated by h/w still counts as one sound; a vowel
      // between them separates it into two.
      if (code !== prev) out += code;
      prev = code;
    } else if (ch === "h" || ch === "w") {
      // does not reset the previous code
    } else {
      prev = ""; // vowel — the next same-coded consonant is a new sound
    }
  }
  return out.padEnd(4, "0");
}

/**
 * Consonant skeleton: fold confusable spellings to one form, then drop vowels.
 * "Klaritee" and "Clarity" both → "KLRT".
 */
export function consonantSkeleton(input) {
  let s = normalizeName(input);
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sk")
    .replace(/ch/g, "k")
    .replace(/sh/g, "s")
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^ps/, "s")
    .replace(/c([eiy])/g, "s$1")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/(.)\1+/g, "$1"); // collapse doubles
  const skeleton = s.replace(/[aeiouhwy]/g, "");
  return (skeleton || s.slice(0, 1)).toUpperCase();
}

/** Levenshtein edit distance. */
export function levenshtein(a, b) {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[t.length];
}

/** 1.0 = identical, 0.0 = nothing in common (normalized edit distance). */
export function similarity(a, b) {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (!s && !t) return 1;
  const max = Math.max(s.length, t.length);
  if (!max) return 1;
  return 1 - levenshtein(s, t) / max;
}

export const SIMILARITY_THRESHOLD = 0.8;

/**
 * Would a trademark examiner plausibly call these confusable?
 * @returns {{confusable:boolean, reasons:string[], similarity:number}}
 */
export function isConfusable(a, b, opts = {}) {
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  const sim = similarity(na, nb);
  const reasons = [];
  if (!na || !nb) return { confusable: false, reasons: [], similarity: sim };
  if (na === nb) reasons.push("identical");
  if (soundex(na) === soundex(nb)) reasons.push(`same soundex (${soundex(na)})`);
  if (consonantSkeleton(na) === consonantSkeleton(nb)) reasons.push(`same consonant skeleton (${consonantSkeleton(na)})`);
  if (sim >= threshold) reasons.push(`edit similarity ${sim.toFixed(2)} ≥ ${threshold}`);
  return { confusable: reasons.length > 0, reasons, similarity: sim };
}

const SUBSTITUTIONS = [
  [/ph/g, "f"], [/f/g, "ph"],
  [/^c/, "k"], [/^k/, "c"],
  [/c/g, "k"], [/k/g, "c"],
  [/s/g, "z"], [/z/g, "s"],
  [/i/g, "y"], [/y/g, "i"],
  [/ee/g, "ea"], [/ea/g, "ee"],
  [/qu/g, "kw"],
  [/x/g, "ks"],
];

/**
 * Respellings worth searching alongside the exact name. Deterministic, deduped,
 * ordered (exact first) and capped — a knockout is a screen, not a crawl.
 */
export function spellingVariants(name, opts = {}) {
  const limit = opts.limit ?? 8;
  const base = normalizeName(name);
  if (!base) return [];
  const out = [base];
  const push = (v) => {
    const n = normalizeName(v);
    if (n && n !== base && !out.includes(n)) out.push(n);
  };
  for (const [re, to] of SUBSTITUTIONS) {
    if (re.test(base)) push(base.replace(re, to));
    re.lastIndex = 0;
  }
  // double-letter churn and a trailing-e drop/add
  push(base.replace(/(.)\1+/g, "$1"));
  if (base.endsWith("e")) push(base.slice(0, -1)); else push(`${base}e`);
  return out.slice(0, limit);
}
