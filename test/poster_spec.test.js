import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeCta, posterCopyFromAngle, posterCopyFromItem } from "../scripts/lib/poster_spec.js";

test("humanizeCta: maps known Meta enums, title-cases unknowns", () => {
  assert.equal(humanizeCta("BOOK_NOW"), "Book Now");
  assert.equal(humanizeCta("GET_QUOTE"), "Get a Quote");
  assert.equal(humanizeCta("MESSAGE_PAGE"), "Message Us");
  assert.equal(humanizeCta("SOME_NEW_CTA"), "Some New Cta"); // graceful fallback
  assert.equal(humanizeCta(null), "Learn More"); // safe default
});

test("posterCopyFromAngle: picks best-scored headline, dedups benefits, humanizes CTA", () => {
  const angle = {
    headlines: [
      { text: "Weaker Headline", score: { composite: 5 } },
      { text: "Best Headline", score: { composite: 9 } },
      { text: "Third Headline", score: { composite: 3 } },
    ],
    descriptions: [
      { text: "Free quote", score: { composite: 8 } },
      { text: "24-hour turnaround", score: { composite: 6 } },
    ],
    ctas: ["GET_QUOTE", "LEARN_MORE"],
  };
  const copy = posterCopyFromAngle(angle, { brandName: "Blue Rose Auto" });
  assert.equal(copy.eyebrow, "Blue Rose Auto");
  assert.equal(copy.headline, "Best Headline");
  assert.equal(copy.subhead, "Weaker Headline"); // next-best headline becomes subhead
  assert.equal(copy.cta, "Get a Quote");
  assert.ok(copy.benefits.length >= 2 && copy.benefits.length <= 3);
  assert.ok(!copy.benefits.includes("Best Headline")); // headline not duplicated as a benefit
});

test("posterCopyFromAngle: returns null when there is no headline/hook", () => {
  assert.equal(posterCopyFromAngle({ headlines: [], hooks: [], ctas: [] }), null);
  assert.equal(posterCopyFromAngle(null), null);
});

test("posterCopyFromAngle: supports bare-string variants (no score objects)", () => {
  const copy = posterCopyFromAngle({ headlines: ["Only Headline"], ctas: ["BOOK_NOW"] }, { brandName: "X" });
  assert.equal(copy.headline, "Only Headline");
  assert.equal(copy.cta, "Book Now");
});

test("posterCopyFromItem: headline from first sentence, no keyword bullets, pillar CTA", () => {
  const item = {
    message: "Protect your paint for a decade with ceramic coating. Read on for details.",
    keywords: ["ceramic coating", "paint protection", "auto detailing", "extra"],
    pillar_id: "educate",
  };
  const copy = posterCopyFromItem(item, { brandName: "Blue Rose Auto" });
  assert.ok(copy.headline.startsWith("Protect your paint")); // first sentence only
  assert.ok(!copy.headline.includes("Read on")); // second sentence dropped
  assert.deepEqual(copy.benefits, []); // organic posters: no keyword bullets (headline + CTA only)
  assert.equal(copy.cta, "Learn More"); // educate pillar
});

test("posterCopyFromItem: returns null with no message", () => {
  assert.equal(posterCopyFromItem({ message: "" }), null);
  assert.equal(posterCopyFromItem(null), null);
});

test("posterCopyFromItem: headline splits on an em-dash aside (punchy, not run-on)", () => {
  const copy = posterCopyFromItem(
    { message: "Mechanical, collision, or cosmetic — one shop, 30+ years, ASE-certified.", pillar_id: "offer" },
    { brandName: "X" }
  );
  assert.equal(copy.headline, "Mechanical, collision, or cosmetic"); // clause before the dash
  assert.equal(copy.cta, "Get a Quote"); // offer pillar
});

test("posterCopyFromItem: long headline truncates on a word boundary, never mid-word", () => {
  const copy = posterCopyFromItem(
    { message: "Springfield drivers trust our certified technicians for everything automotive today", pillar_id: "educate" },
    { brandName: "X" }
  );
  const msg = "Springfield drivers trust our certified technicians for everything automotive today";
  assert.ok(copy.headline.endsWith("…"));
  assert.ok(!copy.headline.includes(" …")); // no dangling space before the ellipsis
  const stem = copy.headline.slice(0, -1); // drop the ellipsis
  assert.ok(msg.startsWith(stem)); // stem is a real prefix of the message
  assert.equal(msg[stem.length], " "); // cut fell on a word boundary (next char is a space)
  assert.ok(copy.headline.length <= 62);
});
