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
import { resolveToken } from "../../scripts/lib/tokens.js";
import { createGraph } from "../../scripts/lib/meta-graph.js";
import { benchmarkFromMedia } from "../../scripts/lib/organic_bench.js";
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: listening.js <slug>"); process.exit(2); }
const OFFLINE = process.env.SMOS_OFFLINE === "1";

const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

// A live capture (from MCP get_mentions / public page fields) is dropped here by the
// agent; the scaffold seeds competitor stubs from the profile so the contract runs.
const capturePath = resolve(dir, "listening_capture.json");
const capture = existsSync(capturePath) ? JSON.parse(readFileSync(capturePath, "utf8")) : {};

const handles = profile?.competitors?.map?.((c) => c.handle || c.name).filter(Boolean) || profile?.competitor_handles || [];
const keywords = profile?.tracked_keywords || profile?.seo_keywords || [];
const igId = profile?.accounts?.instagram_business_id;

/**
 * Live competitor benchmark via IG Business Discovery. From OUR ig business
 * account we can read any public business/creator account's followers + recent
 * media engagement — no scraping, fully within Graph. Returns one normalized
 * competitor row per handle that resolves; handles that error fall through to a
 * stub so a single private/typo account never sinks the snapshot.
 */
async function pullLiveCompetitors(graph, ourIgId, names) {
  const out = [];
  for (const raw of names) {
    const handle = String(raw).replace(/^@/, "").trim();
    if (!handle) continue;
    try {
      const res = await graph.get(`/${ourIgId}`, {
        fields: `business_discovery.username(${handle}){followers_count,media_count,media.limit(20){like_count,comments_count,timestamp,media_type}}`,
      });
      const bd = res.business_discovery || {};
      const media = bd.media?.data || [];
      out.push({ handle, platform: "instagram", followers: bd.followers_count || 0, ...benchmarkFromMedia(media, bd.followers_count) });
    } catch (e) {
      console.error(`business_discovery(${handle}) failed:`, e.message);
      out.push({ handle, platform: "instagram" });
    }
  }
  return out;
}

let competitors = capture.competitors || handles.map((h) => ({ handle: h, platform: "instagram" }));
let mentions = capture.mentions || [];

// Live path: only when not offline, we have a token + our IG id, and no capture
// file already supplied measured competitors.
const tok = resolveToken("page", slug, { profile, require: false });
if (!OFFLINE && tok.token && igId && !capture.competitors && handles.length) {
  try {
    const graph = createGraph(tok.token);
    competitors = await pullLiveCompetitors(graph, igId, handles);
    // own mentions double as listening mentions
    try {
      const tags = await graph.get(`/${igId}/tags`, { fields: "caption,permalink,timestamp,username", limit: 25 });
      mentions = (tags.data || []).map((t) => ({ source: "instagram", text: t.caption || "", url: t.permalink, at: t.timestamp }));
    } catch (e) { console.error("mentions pull failed:", e.message); }
  } catch (e) { console.error("listening live pull failed, using stubs:", e.message); }
} else if (!OFFLINE && !tok.token) {
  console.error(`note: no page token for ${slug} — emitting competitor stubs (no live benchmark).`);
}

const snapshot = schema.normalize({
  client_slug: slug,
  captured_at: new Date().toISOString(),
  keywords,
  mentions,
  competitors,
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
