#!/usr/bin/env node
/**
 * /listening companion script (Phase 3.3) — social listening + organic competitor
 * benchmarking. Architect-level scaffold: assembles a canonical, timestamped
 * listening_snapshot from the profile's competitor handles + tracked keywords and
 * any provided capture (listening_capture.json), validates it, and persists.
 *
 * Usage: node skills/listening/listening.js <slug>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { listeningSnapshot as schema } from "../../schemas/index.js";
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: listening.js <slug>"); process.exit(2); }

const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

// A live capture (from MCP get_mentions / public page fields) is dropped here by the
// agent; the scaffold seeds competitor stubs from the profile so the contract runs.
const capturePath = resolve(dir, "listening_capture.json");
const capture = existsSync(capturePath) ? JSON.parse(readFileSync(capturePath, "utf8")) : {};

const handles = profile?.competitors?.map?.((c) => c.handle || c.name) || profile?.competitor_handles || [];
const keywords = profile?.tracked_keywords || profile?.seo_keywords || [];

const snapshot = schema.normalize({
  client_slug: slug,
  captured_at: new Date().toISOString(),
  keywords,
  mentions: capture.mentions || [],
  competitors: capture.competitors || handles.map((h) => ({ handle: h, platform: "instagram" })),
});

const v = schema.validate(snapshot);
if (!v.ok) { console.error("listening_snapshot INVALID:\n  - " + v.errors.join("\n  - ")); process.exit(4); }

writeFileSync(resolve(dir, "listening_snapshot.json"), JSON.stringify(snapshot, null, 2));

if (supabaseConfigured()) {
  try {
    const client_id = await clientIdBySlug(slug);
    await insert("listening_snapshots", [{ client_id, slug, captured_at: snapshot.captured_at, snapshot }]);
  } catch (e) { console.error("supabase persist skipped:", e.message); }
}
console.log(`listening: ${snapshot.competitors.length} competitors · ${snapshot.mentions.length} mentions · ${snapshot.keywords.length} keywords → listening_snapshot.json`);
