#!/usr/bin/env node
/**
 * /content-plan companion script (Phase 2.2).
 *
 * Builds content pillars + a Reels-first calendar from the client profile and
 * writes BOTH the canonical content_plan.json and the content_calendar.json that
 * /publish consumes. Producer and consumer share schemas/content_plan.js.
 *
 * Usage: node skills/content-plan/content-plan.js <slug> [--weeks=N] [--draft]
 *
 * This is an architect-level scaffold: it generates a structurally-valid,
 * publishable skeleton. The captions are placeholders for the creative agent to
 * enrich — but the SHAPE is guaranteed correct so the /content-plan → /publish
 * handoff can never silently break (same contract as the paid pipeline).
 *
 * Safety gate: by default the plan is validated with { requirePublishable: true }
 * and the run HALTS (non-zero exit, naming the failing field) rather than emit an
 * unpublishable calendar — matching how every other smOS skill fails closed.
 * `--draft` is the ONE explicit escape hatch: it warns instead of halting so the
 * creative agent can be handed a placeholder skeleton (which legitimately lacks
 * per-item media URLs) to enrich before the publishable gate must pass.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { contentPlan as schema } from "../../schemas/index.js";
import { insert, clientIdBySlug, supabaseConfigured } from "../../scripts/lib/supabase.js";
import { writeHtmlAndPdf } from "../../scripts/lib/md_to_html.js";
import { keywordFirstCaption, altText } from "../../scripts/lib/social_seo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// Deterministic dates (no Math.random) so re-runs are stable: start next Monday.
export function nextMonday(from = new Date()) {
  const d = new Date(from);
  d.setUTCHours(13, 0, 0, 0); // 1pm UTC default slot
  const day = d.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

/**
 * Pure builder: profile + slug → normalized content plan. No I/O, so it is
 * directly unit-testable and the validation gate can be exercised in isolation.
 */
export function buildPlan({ profile, slug, weeks = 4, from = new Date() }) {
  // --- pillars: derive from profile, fall back to a sensible default set ---
  const niche =
    profile?.business?.niche ||
    profile?.niche ||
    profile?.business?.business_model?.replace(/_/g, " ") ||
    "service";
  // Prefer explicit SEO keywords, then voice keywords, then the brand's signature
  // phrases (e.g. "ASE-certified", "Tesla-capable") so pillars are grounded in the
  // actual brand rather than the generic "service / local / tips" fallback.
  const seedKeywords = (
    profile?.seo_keywords ||
    profile?.voice?.keywords ||
    profile?.voice?.signature_phrases ||
    [niche, "local", "tips"]
  ).slice(0, 8);
  const PILLAR_DEFS = [
    { id: "educate", name: "Educate", intent: "educate", cadence_per_week: 2 },
    { id: "proof", name: "Social Proof", intent: "convert", cadence_per_week: 1 },
    { id: "behind", name: "Behind the Scenes", intent: "community", cadence_per_week: 1 },
    { id: "offer", name: "Offer / CTA", intent: "convert", cadence_per_week: 1 },
  ];
  const pillars = PILLAR_DEFS.map((p, i) => ({ ...p, keywords: [seedKeywords[i % seedKeywords.length], niche].filter(Boolean) }));

  // --- calendar: Reels-first, distribute pillars across the period ---
  const start = nextMonday(from);
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
        // Social-SEO: lead the caption with the target keyword (search-as-discovery
        // signal) and hand a keyword-first scaffold to /creative to finish in voice.
        message: keywordFirstCaption(
          `${pillar.name}: ${kw}. _(creative agent to finish in brand voice — keep the keyword in the first line)_`,
          kw
        ),
        keywords: pillar.keywords,
        // Cap to 3–5 targeted tags (per platform-specs.md) instead of dumping every keyword.
        hashtags: pillar.keywords
          .slice(0, 5)
          .map((k) => "#" + String(k).replace(/[^a-z0-9]/gi, ""))
          .filter((h) => h.length > 1),
        alt_text: altText({ subject: `${pillar.name}: ${kw}`, format, brand: profile?.name || slug, keyword: kw }),
        ...(format === "carousel"
          ? { items: [{ media_type: "IMAGE" }, { media_type: "IMAGE" }, { media_type: "IMAGE" }] }
          : {}),
        status: "pending",
      });
      idx++;
    }
  }

  return schema.normalize({
    client_slug: slug,
    period: { start: start.toISOString().slice(0, 10), weeks },
    pillars,
    items,
  });
}

/**
 * Render the plan as a client-facing markdown deliverable. The HTML+PDF are
 * produced from this by the shared design-system renderer (md_to_html.js), so
 * the content plan inherits the same "Cupertino" look as every other report —
 * never hand-roll CSS here.
 */
export function renderMarkdown(plan, profile = {}) {
  const name = profile?.name || plan.client_slug;
  const fmtDay = (iso) =>
    new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const byId = Object.fromEntries((plan.pillars || []).map((p) => [p.id, p]));

  let md = `## Overview\n\n`;
  md += `**${name}** — organic content plan for **${plan.period.weeks} weeks** starting **${plan.period.start}**. `;
  md += `${plan.pillars.length} content pillars, ${plan.items.length} scheduled posts (Reels-first, Mon/Wed/Fri). `;
  md += `Captions are strategic hooks; the client's in-house team produces final media.\n\n`;

  md += `## Content Pillars\n\n`;
  md += `| Pillar | Intent | Cadence / wk | Keywords |\n|---|---|---|---|\n`;
  for (const p of plan.pillars) {
    md += `| ${p.name} | ${p.intent} | ${p.cadence_per_week} | ${(p.keywords || []).join(", ")} |\n`;
  }
  md += `\n## Posting Calendar\n\n`;
  md += `| Date | Pillar | Format | Caption hook | Hashtags |\n|---|---|---|---|---|\n`;
  for (const it of plan.items) {
    const pillar = byId[it.pillar_id]?.name || it.pillar_id;
    const cap = String(it.message || "").replace(/\|/g, "\\|");
    const tags = (it.hashtags || []).join(" ");
    md += `| ${fmtDay(it.publish_at)} | ${pillar} | ${it.format} | ${cap} | ${tags} |\n`;
  }
  md += `\n_Generated by smOS \`/content-plan\`. Media URLs are produced by the client team before publishing via \`/publish\`._\n`;
  return md;
}

async function main() {
  loadEnv({ silent: true });

  const slug = process.argv[2];
  if (!slug) { console.error("usage: content-plan.js <slug> [--weeks=N] [--draft]"); process.exit(2); }
  const weeks = Number((process.argv.find((a) => a.startsWith("--weeks="))?.split("=")[1]) || 4);
  const draft = process.argv.includes("--draft");

  const dir = resolve(ROOT, "clients", slug);
  const profilePath = resolve(dir, "client_profile.json");
  if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found — run /intake first.`); process.exit(3); }
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));

  const plan = buildPlan({ profile, slug, weeks });

  // Hard gate: a content plan must be publishable before it can be written,
  // because content_calendar.json is the direct, un-re-derived handoff to
  // /publish. Fail closed (non-zero exit, naming the failing field) unless the
  // operator explicitly asked for a draft skeleton to hand to the writer.
  const v = schema.validate(plan, { requirePublishable: !draft });
  if (!v.ok) {
    if (draft) {
      console.error("content_plan draft (not yet publishable):\n  - " + v.errors.join("\n  - "));
    } else {
      console.error("HALT: content_plan failed publishable validation:\n  - " + v.errors.join("\n  - "));
      console.error("Fix the items above, or re-run with --draft to emit a non-publishable skeleton for the creative agent.");
      process.exit(4);
    }
  }

  writeFileSync(resolve(dir, "content_plan.json"), JSON.stringify(plan, null, 2));
  // The /publish-facing calendar is just the items array under { items }.
  writeFileSync(resolve(dir, "content_calendar.json"), JSON.stringify({ items: plan.items }, null, 2));

  // Client-facing deliverable: markdown + design-system HTML + PDF (Cupertino).
  const mdPath = resolve(dir, "content_plan.md");
  const md = renderMarkdown(plan, profile);
  writeFileSync(mdPath, md);
  const { htmlPath, pdfOk } = writeHtmlAndPdf(mdPath, md, {
    title: `${profile?.name || slug} — Content Plan`,
    subtitle: `${plan.period.weeks}-week organic calendar · ${plan.period.start}`,
    eyebrow: "smOS · Organic",
  });

  if (supabaseConfigured()) {
    try {
      const client_id = await clientIdBySlug(slug);
      await insert("content_plans", [{ client_id, slug, period: plan.period, plan }]);
    } catch (e) { console.error("supabase persist skipped:", e.message); }
  }
  console.log(`content-plan: ${plan.pillars.length} pillars · ${plan.items.length} items over ${weeks} weeks → content_plan.json + content_calendar.json + content_plan.md + content_plan.html${pdfOk ? " + .pdf" : " (PDF skipped)"}${draft ? " (draft)" : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[content-plan] FATAL:", e.message); process.exit(1); });
}
