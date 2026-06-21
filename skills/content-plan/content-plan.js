#!/usr/bin/env node
/**
 * /content-plan companion script (Phase 2.2).
 *
 * Builds content pillars + a Reels-first calendar from the client profile and
 * writes BOTH the canonical content_plan.json and the content_calendar.json that
 * /publish consumes. Producer and consumer share schemas/content_plan.js.
 *
 * Usage: node skills/content-plan/content-plan.js <slug> [--weeks 4]
 *
 * This is an architect-level scaffold: it generates a structurally-valid,
 * publishable skeleton. The captions are placeholders for the creative agent to
 * enrich — but the SHAPE is guaranteed correct so the /content-plan → /publish
 * handoff can never silently break (same contract as the paid pipeline).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { contentPlan as schema } from "../../schemas/index.js";
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: content-plan.js <slug> [--weeks N]"); process.exit(2); }
const weeks = Number((process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1]) || 4);

const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found — run /intake first.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));

// --- pillars: derive from profile, fall back to a sensible default set ---
const niche = profile?.business?.niche || profile?.niche || "service";
const seedKeywords = (profile?.seo_keywords || profile?.voice?.keywords || [niche, "local", "tips"]).slice(0, 8);
const PILLAR_DEFS = [
  { id: "educate", name: "Educate", intent: "educate", cadence_per_week: 2 },
  { id: "proof", name: "Social Proof", intent: "convert", cadence_per_week: 1 },
  { id: "behind", name: "Behind the Scenes", intent: "community", cadence_per_week: 1 },
  { id: "offer", name: "Offer / CTA", intent: "convert", cadence_per_week: 1 },
];
const pillars = PILLAR_DEFS.map((p, i) => ({ ...p, keywords: [seedKeywords[i % seedKeywords.length], niche].filter(Boolean) }));

// --- calendar: Reels-first, distribute pillars across the period ---
// Deterministic dates (no Math.random) so re-runs are stable: start next Monday.
function nextMonday(from = new Date()) {
  const d = new Date(from);
  d.setUTCHours(13, 0, 0, 0); // 1pm UTC default slot
  const day = d.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}
const start = nextMonday();
const FORMATS_BY_PILLAR = { educate: "reels", proof: "carousel", behind: "reels", offer: "image" };
const POST_DAYS = [0, 2, 4]; // Mon/Wed/Fri within each week

const items = [];
let idx = 0;
for (let w = 0; w < weeks; w++) {
  for (const dayOffset of POST_DAYS) {
    const pillar = pillars[idx % pillars.length];
    const when = new Date(start);
    when.setUTCDate(start.getUTCDate() + w * 7 + dayOffset);
    const format = FORMATS_BY_PILLAR[pillar.id] || "reels";
    const kw = pillar.keywords[0] || niche;
    items.push({
      id: `${slug}-${when.toISOString().slice(0, 10)}-${pillar.id}`,
      pillar_id: pillar.id,
      platform: "instagram",
      format,
      publish_at: when.toISOString(),
      message: `[${pillar.name}] ${kw}: _(creative agent to write keyword-first caption)_`,
      keywords: pillar.keywords,
      hashtags: pillar.keywords.map((k) => "#" + String(k).replace(/[^a-z0-9]/gi, "")).filter((h) => h.length > 1),
      alt_text: `${pillar.name} ${format} about ${kw} for ${niche}`,
      ...(format === "carousel"
        ? { items: [{ media_type: "IMAGE" }, { media_type: "IMAGE" }, { media_type: "IMAGE" }] }
        : {}),
      status: "pending",
    });
    idx++;
  }
}

const plan = schema.normalize({
  client_slug: slug,
  period: { start: start.toISOString().slice(0, 10), weeks },
  pillars,
  items,
});

// Soft-validate (publishable shape) — surface issues but still write the skeleton
// so the creative agent has something to enrich. Hard gate happens in /publish.
const v = schema.validate(plan, { requirePublishable: false });
if (!v.ok) console.error("content_plan validation warnings:\n  - " + v.errors.join("\n  - "));

writeFileSync(resolve(dir, "content_plan.json"), JSON.stringify(plan, null, 2));
// The /publish-facing calendar is just the items array under { items }.
writeFileSync(resolve(dir, "content_calendar.json"), JSON.stringify({ items: plan.items }, null, 2));

(async () => {
  if (supabaseConfigured()) {
    try {
      const client_id = await clientIdBySlug(slug);
      await insert("content_plans", [{ client_id, slug, period: plan.period, plan }]);
    } catch (e) { console.error("supabase persist skipped:", e.message); }
  }
  console.log(`content-plan: ${pillars.length} pillars · ${plan.items.length} items over ${weeks} weeks → content_plan.json + content_calendar.json`);
})();
