import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSentiment, applySentiment, pendingSentiment } from "../scripts/lib/sentiment.js";

test("normalizeSentiment accepts only the three enum values, case-insensitively", () => {
  assert.equal(normalizeSentiment("Positive"), "positive");
  assert.equal(normalizeSentiment("NEUTRAL"), "neutral");
  assert.equal(normalizeSentiment("negative"), "negative");
});

test("normalizeSentiment never invents — anything else (or null) becomes null", () => {
  assert.equal(normalizeSentiment(null), null);
  assert.equal(normalizeSentiment(undefined), null);
  assert.equal(normalizeSentiment("mixed"), null);
  assert.equal(normalizeSentiment(""), null);
  assert.equal(normalizeSentiment(42), null);
});

test("applySentiment fills only currently-null sentiment, from a map keyed by idField", () => {
  const records = [
    { url: "u1", text: "love it", sentiment: null },
    { url: "u2", text: "meh", sentiment: null },
  ];
  const out = applySentiment(records, { u1: "positive", u2: "bogus" }, { idField: "url" });
  assert.equal(out[0].sentiment, "positive");
  assert.equal(out[1].sentiment, null); // invalid judgment never invents a value
});

test("applySentiment never overwrites an existing verdict", () => {
  const records = [{ url: "u1", text: "x", sentiment: "negative" }];
  const out = applySentiment(records, { u1: "positive" }, { idField: "url" });
  assert.equal(out[0].sentiment, "negative");
});

test("applySentiment does not mutate the input array", () => {
  const records = [{ url: "u1", text: "x", sentiment: null }];
  applySentiment(records, { u1: "positive" }, { idField: "url" });
  assert.equal(records[0].sentiment, null);
});

test("applySentiment accepts an array-of-objects judgments form too", () => {
  const records = [{ inbox_id: "i1", text: "great", sentiment: null }];
  const out = applySentiment(records, [{ id: "i1", sentiment: "positive" }], { idField: "inbox_id" });
  assert.equal(out[0].sentiment, "positive");
});

test("pendingSentiment lists only records with text and no sentiment yet", () => {
  const records = [
    { id: "a", text: "hi", sentiment: null },
    { id: "b", text: "yo", sentiment: "positive" },
    { id: "c", text: "", sentiment: null },
  ];
  const pending = pendingSentiment(records);
  assert.deepEqual(pending, [{ id: "a", text: "hi" }]);
});
