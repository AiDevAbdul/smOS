import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(ROOT, "skills/brand-visual/brand-visual.js");

// A minimal-but-valid visual layer matching schemas/brand_profile.js → visual,
// enough for the saveBrand("visual") stage to validate once the gate is cleared.
const VISUAL_INPUT = {
  moodboard_url: "https://example.com/mood.png",
  logo: { primary_url: "acme.svg" },
  colors: { primary: "#111111" },
  typography: { heading: "Inter", body: "Inter" },
};

// Build a brand_profile.json for a throwaway slug. `nameApproved` toggles GATE 2.
function setupBrand(slug, { nameApproved }) {
  const dir = resolve(ROOT, "clients", slug);
  mkdirSync(dir, { recursive: true });
  const profile = {
    client_slug: slug,
    strategy: {
      values: ["bold"],
      positioning_statement: "For X who Y, Acme is the Z.",
      positioning_approved_at: "2026-06-21T00:00:00Z",
    },
    verbal: {
      name: "Acme",
      name_approved_at: nameApproved ? "2026-06-21T01:00:00Z" : null,
    },
  };
  writeFileSync(resolve(dir, "brand_profile.json"), JSON.stringify(profile, null, 2));
  const inPath = resolve(dir, "visual.json");
  writeFileSync(inPath, JSON.stringify(VISUAL_INPUT, null, 2));
  return { dir, inPath };
}

function run(slug, inPath) {
  return spawnSync("node", [SCRIPT, slug, "--in", inPath], { cwd: ROOT, encoding: "utf8" });
}

function cleanup(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

test("GATE 2: persisting a visual layer with --in HALTS (exit 3) when name is not approved", () => {
  const slug = "__bv_test_unapproved";
  const { dir, inPath } = setupBrand(slug, { nameApproved: false });
  try {
    const r = run(slug, inPath);
    assert.equal(r.status, 3, `expected exit 3, got ${r.status}. stderr: ${r.stderr}`);
    assert.match(r.stderr, /Name not approved/i);
    // The fail-closed gate must NOT have written a visual layer.
    assert.ok(!r.stdout.includes('"layer": "visual"'), "visual layer must not be persisted");
  } finally {
    cleanup(dir);
  }
});

test("GATE 2: persisting a visual layer with --in PROCEEDS when name is approved", () => {
  const slug = "__bv_test_approved";
  const { dir, inPath } = setupBrand(slug, { nameApproved: true });
  try {
    const r = run(slug, inPath);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}. stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.layer, "visual");
    assert.equal(out.logo, "acme.svg");
    assert.equal(out.primary_color, "#111111");
  } finally {
    cleanup(dir);
  }
});
