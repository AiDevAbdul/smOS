// hero-uniform.test.js — the report hero is ONE canonical component.
//
// Enforces the mandate in design-system/MASTER.md: every report hero is rendered
// through heroHeader()/hero_header() and emits the exact .ds-hero structure.
// No renderer may hand-roll a `<header class="ds-hero">` literal or fork a bespoke
// hero — that is how the heroes drifted out of uniformity in the first place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { heroHeader, heroAside } from "../scripts/lib/design_system.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

test("heroHeader emits the canonical .ds-hero structure", () => {
  const html = heroHeader({ eyebrow: "Agency", title: "Acme", subtitle: "June 30, 2026" });
  assert.match(html, /<header class="ds-hero">/);
  assert.match(html, /<div class="ds-hero__inner">/); // no aside → no has-aside
  assert.match(html, /<div class="ds-hero__badge">Agency<\/div>/);
  assert.match(html, /<h1>Acme<\/h1>/);
  assert.match(html, /<div class="ds-meta">June 30, 2026<\/div>/);
});

test("heroHeader wires the optional executive aside column", () => {
  const aside = heroAside({ body: "<canvas></canvas>", statLabel: "Outspend", statValue: "12×", statCaption: "vs you" });
  const html = heroHeader({ title: "Acme", aside });
  assert.match(html, /ds-hero__inner has-aside/);
  assert.match(html, /<div class="ds-hero__aside"><canvas><\/canvas>/);
  assert.match(html, /<div class="ds-hero__stat-value">12×<\/div>/);
});

test("subtitle is escaped; subtitleHtml is trusted", () => {
  assert.match(heroHeader({ title: "x", subtitle: "<b>x</b>" }), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(heroHeader({ title: "x", subtitleHtml: "<code>x</code>" }), /<code>x<\/code>/);
});

test("design system defines the canonical hero (single source of truth)", () => {
  const css = read("design-system/smos-design-system.css");
  for (const sel of [".ds-hero", ".ds-hero__inner", ".ds-hero__badge", ".ds-hero__aside", ".ds-hero__stat-value"]) {
    assert.ok(css.includes(sel), `design system CSS must define ${sel}`);
  }
});

// Live renderers must call the loader, never hand-roll a hero literal.
//
// NOTE: pre_audit_report.py is intentionally NOT in this list. The pre-audit is a
// client-facing SALES artifact and deliberately uses its own distinct "Aperture"
// console hero (CSS signal-ring gauge, navy-console bracket) rather than the shared
// internal-report .ds-hero. It must still never hand-roll a `.ds-hero` literal —
// that is asserted separately below.
const LIVE_RENDERERS = [
  "scripts/audit_report_html.js",
  "scripts/lib/md_to_html.js",
  "scripts/meta-ad-library/report.py",
];

test("no live renderer hand-rolls a <header class=\"ds-hero\"> literal", () => {
  for (const f of LIVE_RENDERERS) {
    const src = read(f);
    assert.ok(
      !/<header class="ds-hero"/.test(src),
      `${f} hand-rolls a ds-hero literal — render via heroHeader()/hero_header() instead`,
    );
    assert.ok(
      /heroHeader\(|hero_header\(/.test(src),
      `${f} must render its hero via heroHeader()/hero_header()`,
    );
  }
});

// The pre-audit uses its own "Aperture" hero, but must still not fork the shared
// .ds-hero component (that is the specific drift this suite guards against).
test("pre-audit does not hand-roll a .ds-hero literal", () => {
  const src = read("scripts/meta-ad-library/pre_audit_report.py");
  assert.ok(
    !/<header class="ds-hero/.test(src),
    "pre_audit_report.py must not hand-roll a .ds-hero hero — it uses its own .hero console",
  );
});
