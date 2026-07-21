/**
 * PosterSpec resolver — turns already-produced copy artifacts into the
 * normalized marketing-copy object the poster text layer renders. NO new manual
 * input: every field is derived from an approved /creative ad_copy angle or a
 * /content-plan calendar item, plus the brand's own verbal name.
 *
 * Shape returned by posterCopy*():
 *   { eyebrow, headline, subhead, benefits: string[], cta } | null
 * Returns null when there isn't enough to make a real ad (no headline) — the
 * caller then falls back to the logo+contact-bar-only composite.
 */

// Meta CTA enum → human button label. Falls back to Title Case for anything new.
const CTA_LABELS = {
  BOOK_NOW: "Book Now",
  BOOK_TRAVEL: "Book Now",
  GET_QUOTE: "Get a Quote",
  LEARN_MORE: "Learn More",
  SEE_MORE: "See More",
  SHOP_NOW: "Shop Now",
  BUY_NOW: "Buy Now",
  SIGN_UP: "Sign Up",
  SUBSCRIBE: "Subscribe",
  CONTACT_US: "Contact Us",
  MESSAGE_PAGE: "Message Us",
  SEND_MESSAGE: "Message Us",
  CALL_NOW: "Call Now",
  GET_OFFER: "Get Offer",
  GET_DIRECTIONS: "Get Directions",
  APPLY_NOW: "Apply Now",
  DOWNLOAD: "Download",
  GET_SHOWTIMES: "Get Showtimes",
  ORDER_NOW: "Order Now",
  WHATSAPP_MESSAGE: "Message Us",
  NO_BUTTON: "Learn More",
};

export function humanizeCta(cta) {
  if (!cta) return "Learn More";
  const key = String(cta).toUpperCase();
  if (CTA_LABELS[key]) return CTA_LABELS[key];
  return key
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// A copy variant is either a bare string or { text, score:{composite} }.
const variantText = (v) => (typeof v === "string" ? v : v?.text || "");
const variantScore = (v) => (typeof v === "object" && v?.score ? Number(v.score.composite) || 0 : 0);

// Rank variants best-first by composite score (stable for equal scores).
function byScore(arr) {
  return (arr || [])
    .map((v, i) => ({ v, i, s: variantScore(v) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => variantText(x.v))
    .filter(Boolean);
}

function firstSentence(text, maxLen = 60) {
  if (!text) return "";
  const s = String(text).split(/(?<=[.!?])\s+/)[0].trim();
  return s.length > maxLen ? s.slice(0, maxLen - 1).trim() + "…" : s;
}

/** Paid: build poster copy from an ad_copy.json angle. */
export function posterCopyFromAngle(angle, { brandName } = {}) {
  if (!angle) return null;
  const headlines = byScore(angle.headlines);
  const descriptions = byScore(angle.descriptions);
  const hooks = byScore(angle.hooks);
  const ctas = Array.isArray(angle.ctas) ? angle.ctas.map(variantText).filter(Boolean) : [];

  const headline = headlines[0] || hooks[0];
  if (!headline) return null; // not enough to be an ad

  // subhead: the alternate headline reads as a supporting line; else a description.
  const subhead = headlines[1] || descriptions[0] || "";
  // benefits: short qualifier lines are the cleanest bullet source; top up from
  // remaining descriptions/headlines, dedup against headline/subhead.
  const pool = [...descriptions, ...headlines.slice(2)];
  const used = new Set([headline, subhead].map((s) => s.toLowerCase()));
  const benefits = pool.filter((t) => t && !used.has(t.toLowerCase())).slice(0, 3);

  return {
    eyebrow: brandName || "",
    headline,
    subhead: subhead && subhead !== headline ? subhead : "",
    benefits,
    cta: humanizeCta(ctas[0]),
  };
}

// Organic pillars → a sensible default CTA when the item carries none.
const PILLAR_CTA = {
  offer: "Get a Quote",
  promo: "Get a Quote",
  proof: "See the Results",
  educate: "Learn More",
  authority: "Learn More",
  community: "Learn More",
};

/** Organic: build poster copy from a content_calendar.json item. */
export function posterCopyFromItem(item, { brandName } = {}) {
  if (!item) return null;
  const headline = firstSentence(item.message);
  if (!headline) return null;
  const keywords = Array.isArray(item.keywords) ? item.keywords.filter(Boolean) : [];
  return {
    eyebrow: brandName || "",
    headline,
    subhead: "",
    benefits: keywords.slice(0, 3),
    cta: PILLAR_CTA[item.pillar_id] || "Learn More",
  };
}
