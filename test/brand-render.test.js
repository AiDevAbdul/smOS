import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
if (!process.env.SMOS_DATA_ROOT) process.env.SMOS_DATA_ROOT = resolve(ROOT, "test", ".tmp");

const P = await import("../scripts/lib/paths.js");
const R = await import("../scripts/lib/brand_render.js");

const BRAND = {
  client_slug: "rendertest",
  verbal: { name: "Blue Rose Auto", tagline: "Care you can see", name_approved_at: "2026-06-21T01:00:00Z" },
  visual: {
    colors: { primary: "#29ABE2", secondary: "#939598", accent: "#29ABE2", neutrals: ["#000000", "#FFFFFF"] },
    typography: { heading: "Oswald", body: "Inter" },
  },
};

/** PNG IHDR: width/height are big-endian uint32 at bytes 16..24. */
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.slice(1, 4).toString("ascii"), "PNG", `${path} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const abs = (rel) => (rel.startsWith("/") ? rel : resolve(ROOT, rel));

test("initials: one word, two words, empty", () => {
  assert.equal(R.initialsFor("Acme"), "A");
  assert.equal(R.initialsFor("Blue Rose Auto"), "BR");
  assert.equal(R.initialsFor("   "), "•");
});

test("renderLogoSystem: writes real files at the declared sizes", async () => {
  const slug = "rendertest-logo";
  rmSync(R.brandAssetDir(slug), { recursive: true, force: true });
  const out = await R.renderLogoSystem(slug, { ...BRAND, client_slug: slug });

  for (const f of out.files) assert.ok(existsSync(abs(f)), `missing ${f}`);
  // The lockup is a real raster at the spec size, not a placeholder.
  const { w, h } = pngSize(abs(out.logo.primary_url));
  assert.equal(w, R.ASSET_SPECS.logo_primary.w);
  assert.equal(h, R.ASSET_SPECS.logo_primary.h);
  assert.equal(pngSize(abs(out.logo.mark_url)).w, R.ASSET_SPECS.logo_mark.w);

  // The SVG is self-contained (fonts embedded as paths — no host font needed).
  const svg = readFileSync(abs(out.logo.svg_url), "utf8");
  assert.match(svg, /^<svg/);
  assert.ok(svg.includes("<path"), "wordmark should be embedded as glyph paths");
  assert.ok(!svg.includes("font-family"), "no host font dependency");

  // Every logo variant is filled in — the schema fields downstream skills read.
  for (const k of ["primary_url", "mark_url", "wordmark_url", "mono_url", "reverse_url", "svg_url"]) {
    assert.ok(out.logo[k], `logo.${k} not set`);
  }
});

test("renderLogoSystem: deterministic — same brand renders identical bytes", async () => {
  const slug = "rendertest-determinism";
  const a = await R.renderLogoSystem(slug, { ...BRAND, client_slug: slug });
  const first = readFileSync(abs(a.logo.primary_url));
  const b = await R.renderLogoSystem(slug, { ...BRAND, client_slug: slug });
  assert.deepEqual(readFileSync(abs(b.logo.primary_url)), first);
});

test("renderSocialAssets: profile/cover/highlights/templates all exist at spec size", async () => {
  const slug = "rendertest-social";
  rmSync(R.brandAssetDir(slug), { recursive: true, force: true });
  const out = await R.renderSocialAssets(slug, { ...BRAND, client_slug: slug }, { highlights: ["About", "Services"] });

  assert.deepEqual(pngSize(abs(out.social.profile_picture_url)), { w: 1080, h: 1080 });
  assert.deepEqual(pngSize(abs(out.social.fb_cover_url)), { w: 1640, h: 856 });
  assert.equal(out.social.ig_highlight_covers.length, 2);
  assert.equal(out.social.ig_highlight_covers[0].label, "About");
  assert.deepEqual(pngSize(abs(out.social.ig_highlight_covers[0].url)), { w: 1080, h: 1080 });
  assert.deepEqual(pngSize(abs(out.social.templates[0].url)), { w: 1080, h: 1350 });
  assert.deepEqual(pngSize(abs(out.social.templates[1].url)), { w: 1080, h: 1920 });
});

test("render: refuses without a brand name rather than emitting a blank asset", async () => {
  await assert.rejects(
    () => R.renderLogoSystem("rendertest-noname", { visual: BRAND.visual }),
    /verbal\.name is required/
  );
});

// ───────────────── CLI integration: /brand-visual + /brand-social ─────────────────

function seedBrand(slug, patch = {}) {
  const dir = P.clientRoot(slug);
  mkdirSync(dir, { recursive: true });
  const profile = {
    client_slug: slug,
    strategy: { values: ["bold"], positioning_statement: "For X who Y, Acme is the Z.", positioning_approved_at: "2026-06-21T00:00:00Z" },
    verbal: { name: "Blue Rose Auto", tagline: "Care you can see", name_approved_at: "2026-06-21T01:00:00Z" },
    ...patch,
  };
  writeFileSync(resolve(dir, "brand_profile.json"), JSON.stringify(profile, null, 2));
  return dir;
}

function readBrand(slug) {
  return JSON.parse(readFileSync(resolve(P.clientRoot(slug), "brand_profile.json"), "utf8"));
}

test("/brand-visual --render produces the logo and records only paths that exist", () => {
  const slug = "rendertest-cli-visual";
  const dir = seedBrand(slug);
  const inPath = resolve(dir, "visual.json");
  writeFileSync(inPath, JSON.stringify({
    colors: BRAND.visual.colors,
    typography: BRAND.visual.typography,
  }));

  const r = spawnSync("node", [resolve(ROOT, "skills/brand-visual/brand-visual.js"), slug, "--in", inPath, "--render"],
    { cwd: ROOT, encoding: "utf8", env: process.env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.rendered_files.length >= 8);
  assert.equal(out.contrast.ok, true);

  const brand = readBrand(slug);
  assert.ok(existsSync(abs(brand.visual.logo.primary_url)));
  assert.ok(existsSync(abs(brand.visual.logo.svg_url)));
});

test("/brand-visual blocks a low-contrast palette before writing anything", () => {
  const slug = "rendertest-cli-contrast";
  const dir = seedBrand(slug);
  const inPath = resolve(dir, "visual.json");
  writeFileSync(inPath, JSON.stringify({
    logo: { primary_url: "x.svg" },
    colors: { primary: "#F5D76E", neutrals: ["#FFFFFF", "#F5F5F7"] },
    typography: { heading: "Inter", body: "Inter" },
  }));

  const r = spawnSync("node", [resolve(ROOT, "skills/brand-visual/brand-visual.js"), slug, "--in", inPath],
    { cwd: ROOT, encoding: "utf8", env: process.env });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /contrast-guard BLOCKED/);
  // Fail-closed: the rejected palette was not persisted.
  assert.equal(readBrand(slug).visual?.colors?.primary ?? null, null);
});

test("/brand-social --render fills the social surface with real files", () => {
  const slug = "rendertest-cli-social";
  const dir = seedBrand(slug, {
    visual: { ...BRAND.visual, logo: { primary_url: "x.png" }, logo_approved_at: "2026-06-22T00:00:00Z" },
  });
  const inPath = resolve(dir, "social.json");
  writeFileSync(inPath, JSON.stringify({ bios: { instagram: "Auto care you can see.", facebook: "Auto care." } }));

  const r = spawnSync("node", [resolve(ROOT, "skills/brand-social/brand-social.js"), slug, "--in", inPath, "--render", "--highlights", "About,Services"],
    { cwd: ROOT, encoding: "utf8", env: process.env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.complete, true);
  assert.ok(out.rendered_files.length >= 5);

  const brand = readBrand(slug);
  assert.ok(existsSync(abs(brand.social.profile_picture_url)));
  assert.ok(existsSync(abs(brand.social.fb_cover_url)));
  assert.equal(brand.social.ig_highlight_covers.length, 2);
});
