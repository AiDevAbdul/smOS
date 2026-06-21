// scripts/lib/social_seo.js — Social-SEO layer (Phase 2.6).
//
// Keyword-first captions + alt-text helpers, used by /content-plan and /creative so
// SEO is baked into organic + paid copy rather than bolted on. Pure functions, no I/O.

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "your", "our", "you", "we"]);

/** Extract candidate keywords from a blob of text, most-frequent first. */
export function extractKeywords(text, max = 8) {
  const counts = new Map();
  for (const w of String(text || "").toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []) {
    if (STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

/** Lead a caption with its primary keyword (first ~125 chars are what IG shows). */
export function keywordFirstCaption(caption, keyword) {
  const c = String(caption || "").trim();
  if (!keyword) return c;
  const k = String(keyword).trim();
  if (c.toLowerCase().startsWith(k.toLowerCase())) return c;
  return `${k[0].toUpperCase() + k.slice(1)} — ${c}`;
}

/** Generate descriptive alt text (accessibility + SEO). */
export function altText({ subject, format = "image", brand, keyword } = {}) {
  return [format, "of", subject, keyword ? `(${keyword})` : "", brand ? `by ${brand}` : ""]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** Audit a caption: does it lead with a keyword and include hashtags? Returns issues[]. */
export function auditCaption(caption, keywords = []) {
  const issues = [];
  const c = String(caption || "").trim();
  if (!c) { issues.push("empty caption"); return issues; }
  const lead = c.slice(0, 60).toLowerCase();
  if (keywords.length && !keywords.some((k) => lead.includes(String(k).toLowerCase()))) {
    issues.push("primary keyword not in first 60 chars");
  }
  if (!/#[a-z0-9]/i.test(c)) issues.push("no hashtags");
  return issues;
}
