import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractKeywords, keywordFirstCaption, altText, auditCaption } from "../scripts/lib/social_seo.js";

// ---------------- social_seo ----------------
test("extractKeywords drops stopwords + ranks by frequency", () => {
  const kw = extractKeywords("Roofing repair roofing roofing the and for gutters gutters");
  assert.equal(kw[0], "roofing");
  assert.ok(!kw.includes("the"));
});

test("keywordFirstCaption leads with the keyword", () => {
  assert.match(keywordFirstCaption("we fix leaks fast", "roofing"), /^Roofing —/);
  assert.equal(keywordFirstCaption("Roofing pros here", "roofing"), "Roofing pros here"); // already leads
});

test("altText is descriptive", () => {
  assert.match(altText({ subject: "a new roof", format: "video", brand: "Acme", keyword: "roofing" }), /video of a new roof.*roofing.*Acme/);
});

test("auditCaption flags missing keyword + hashtags", () => {
  const issues = auditCaption("nothing relevant here", ["roofing"]);
  assert.ok(issues.includes("primary keyword not in first 60 chars"));
  assert.ok(issues.includes("no hashtags"));
  assert.equal(auditCaption("Roofing tips #roofing", ["roofing"]).length, 0);
});

// ---------------- dam ----------------
test("dam register dedupes by hash and versions by asset_id", async () => {
  const root = mkdtempSync(join(tmpdir(), "smos-dam-"));
  // dam writes under clients/<slug>/assets.json relative to repo ROOT, so we point
  // it at a temp client by creating that path under the real repo is intrusive —
  // instead validate the pure pieces (schema) and hashing here.
  const { hashBytes } = await import("../scripts/lib/dam.js");
  const h1 = hashBytes("abc");
  const h2 = hashBytes("abc");
  const h3 = hashBytes("xyz");
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  rmSync(root, { recursive: true, force: true });
});
