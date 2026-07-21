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

test("posterCopyFromItem: derives headline from message, benefits from keywords, pillar CTA", () => {
  const item = {
    message: "Protect your paint for a decade with ceramic coating. Read on for details.",
    keywords: ["ceramic coating", "paint protection", "auto detailing", "extra"],
    pillar_id: "educate",
  };
  const copy = posterCopyFromItem(item, { brandName: "Blue Rose Auto" });
  assert.ok(copy.headline.startsWith("Protect your paint")); // first sentence only
  assert.ok(!copy.headline.includes("Read on")); // second sentence dropped
  assert.equal(copy.benefits.length, 3); // capped at 3 keywords
  assert.equal(copy.cta, "Learn More"); // educate pillar
});

test("posterCopyFromItem: returns null with no message", () => {
  assert.equal(posterCopyFromItem({ message: "" }), null);
  assert.equal(posterCopyFromItem(null), null);
});
