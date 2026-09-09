import { test } from "node:test";
import assert from "node:assert/strict";
import {
  soundex, consonantSkeleton, levenshtein, similarity, isConfusable, spellingVariants, normalizeName,
} from "../scripts/lib/phonetics.js";

test("soundex: known anchors", () => {
  assert.equal(soundex("Robert"), "R163");
  assert.equal(soundex("Rupert"), "R163");
  assert.equal(soundex("Ashcraft"), "A261"); // h does not separate the same-coded pair
  assert.equal(soundex("Tymczak"), "T522");
  assert.equal(soundex("Pfister"), "P236");
  assert.equal(soundex("Lee"), "L000");
  assert.equal(soundex(""), "");
  assert.equal(soundex("  !! "), "");
});

test("consonant skeleton folds confusable spellings together", () => {
  assert.equal(consonantSkeleton("Klaritee"), consonantSkeleton("Clarity"));
  assert.equal(consonantSkeleton("Phlex"), consonantSkeleton("Fleks"));
  assert.equal(consonantSkeleton("Zoom"), consonantSkeleton("Soom"));
  // an all-vowel name still yields something rather than ""
  assert.equal(consonantSkeleton("Aioee"), "A");
});

test("levenshtein + similarity", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("same", "same"), 0);
  assert.equal(similarity("acme", "acme"), 1);
  assert.ok(similarity("acme", "acne") > 0.7);
  assert.ok(similarity("acme", "northwind") < 0.3);
});

test("isConfusable: the case an exact-string search misses", () => {
  const c = isConfusable("Klaritee", "Clarity");
  assert.equal(c.confusable, true);
  assert.ok(c.reasons.some((r) => /skeleton/.test(r)));

  // classic sound-alike
  assert.equal(isConfusable("Fotomat", "Photomat").confusable, true);
  // typo-level neighbour caught by edit distance
  assert.equal(isConfusable("Northwind", "Northwynd").confusable, true);
  // genuinely different names are not flagged
  assert.equal(isConfusable("Acme", "Northwind").confusable, false);
  // empty input never flags
  assert.equal(isConfusable("", "Acme").confusable, false);
});

test("spellingVariants: exact first, deduped, capped, deterministic", () => {
  const v = spellingVariants("Clarity");
  assert.equal(v[0], "clarity");
  assert.ok(v.includes("klarity"));
  assert.equal(new Set(v).size, v.length);
  assert.ok(v.length <= 8);
  assert.deepEqual(v, spellingVariants("clarity!"));
  assert.deepEqual(spellingVariants(""), []);
  assert.ok(spellingVariants("Zoom", { limit: 3 }).length <= 3);
});

test("normalizeName strips everything but a-z", () => {
  assert.equal(normalizeName("Blue-Rose Auto 24/7"), "blueroseauto");
});
