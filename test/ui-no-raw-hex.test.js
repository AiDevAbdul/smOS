// ui-no-raw-hex.test.js — the Console application layer never forks a second
// palette. Mirrors the discipline hero-uniform.test.js enforces for reports:
// design-system/smos-app.css (and, once it exists, ui/**/*.css) may reference
// only --ds-* tokens for color and type, never literal hex or font-family.
//
// #fff / #ffffff is the one accepted literal — Ledger's own core stylesheet
// uses plain white for on-accent text (e.g. .ds-btn { color: #fff }), so the
// app layer follows the same established exception rather than inventing a
// --ds-white token no renderer uses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED_HEX = new Set(["#fff", "#ffffff"]);
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;]+);/g;

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findCssFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      findCssFiles(full, out);
    } else if (extname(entry) === ".css") {
      out.push(full);
    }
  }
  return out;
}

function targets() {
  const files = [resolve(ROOT, "design-system/smos-app.css")];
  // ui/ doesn't exist until Phase B/C — include it once it's scaffolded.
  return files.concat(findCssFiles(resolve(ROOT, "ui")));
}

test("Console CSS uses only --ds-* tokens for color (no raw hex besides #fff)", () => {
  for (const file of targets()) {
    const css = stripComments(readFileSync(file, "utf8"));
    const matches = css.match(HEX_RE) || [];
    const offenders = matches.filter((m) => !ALLOWED_HEX.has(m.toLowerCase()));
    assert.deepEqual(
      offenders,
      [],
      `${file} has literal hex color(s) not in the allowed set: ${offenders.join(", ")}. Use a --ds-* token instead.`
    );
  }
});

test("Console CSS declares font-family only via --ds-font* tokens", () => {
  for (const file of targets()) {
    const css = stripComments(readFileSync(file, "utf8"));
    let m;
    while ((m = FONT_FAMILY_RE.exec(css))) {
      const value = m[1].trim();
      assert.match(
        value,
        /^var\(--ds-font(-display|-mono)?\)$/,
        `${file} declares a font-family not backed by a --ds-font* token: "${value}"`
      );
    }
  }
});

test("design-system/smos-app.css exists and is non-trivial", () => {
  const p = resolve(ROOT, "design-system/smos-app.css");
  assert.ok(existsSync(p), "design-system/smos-app.css is missing");
  assert.ok(readFileSync(p, "utf8").length > 1000, "smos-app.css looks empty/truncated");
});
