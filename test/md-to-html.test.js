import { test } from "node:test";
import assert from "node:assert/strict";
import { mdToFragment, mdToHtml } from "../scripts/lib/md_to_html.js";

test("headings, bold, code, links render", () => {
  const f = mdToFragment("# Title\n\nSome **bold** and `code` and [link](https://x.com).");
  assert.match(f, /<h1>Title<\/h1>/);
  assert.match(f, /<strong>bold<\/strong>/);
  assert.match(f, /<code>code<\/code>/);
  assert.match(f, /<a href="https:\/\/x\.com">link<\/a>/);
});

test("unordered + ordered lists", () => {
  assert.match(mdToFragment("- a\n- b"), /<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
  assert.match(mdToFragment("1. one\n2. two"), /<ol>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ol>/);
});

test("markdown table becomes a styled table", () => {
  const f = mdToFragment("| Metric | Value |\n|---|---|\n| Spend | $100 |");
  assert.match(f, /<table>/);
  assert.match(f, /<thead><tr><th>Metric<\/th><th>Value<\/th><\/tr><\/thead>/);
  assert.match(f, /<td>Spend<\/td><td>\$100<\/td>/);
});

test("HTML in data is escaped (no injection)", () => {
  const f = mdToFragment("Value is <script>alert(1)</script>");
  assert.match(f, /&lt;script&gt;/);
  assert.doesNotMatch(f, /<script>/);
});

test("mdToHtml produces a self-contained document with inlined styles + title", () => {
  const html = mdToHtml("# Hi", { title: "Weekly Report", subtitle: "Jun 1 → Jun 7" });
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<style>/);
  assert.match(html, /<title>Weekly Report<\/title>/);
  assert.match(html, /Jun 1 → Jun 7/);
  assert.doesNotMatch(html, /<link |@import|src="http/); // no external assets
});
