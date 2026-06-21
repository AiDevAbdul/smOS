#!/usr/bin/env node
/**
 * /portal companion script (Phase 2.5) — white-label client dashboard.
 *
 * Builds a self-contained portal.html blending paid + organic from whatever local
 * artifacts exist (offline-safe; degrades to "no data yet" cards). Reuses the
 * shared md_to_html design tokens for one visual language.
 *
 * Usage: node skills/portal/portal.js <slug>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { mdToHtml } from "../../scripts/lib/md_to_html.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: portal.js <slug>"); process.exit(2); }
const dir = resolve(ROOT, "clients", slug);
const profilePath = resolve(dir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const clientName = profile?.business?.name || profile?.name || slug;

function readJson(name) {
  const p = resolve(dir, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

const perf = readJson("performance_analysis.json");
const inbox = readJson("inbox.json");
const content = readJson("content_plan.json");
const listening = readJson("listening_snapshot.json");

const sections = [`# ${clientName} — Dashboard`, `_Generated ${new Date().toISOString().slice(0, 10)}_`, ""];

sections.push("## Paid Performance");
if (perf?.summary) {
  const s = perf.summary;
  sections.push(
    `| Spend | Conversions | CPA | ROAS | CTR |`,
    `|--:|--:|--:|--:|--:|`,
    `| $${s.spend ?? "—"} | ${s.conversions ?? "—"} | ${s.cpa ?? "—"} | ${s.roas ?? "—"} | ${s.ctr ?? "—"}% |`
  );
} else sections.push("_No paid performance data yet — run /analyze._");

sections.push("", "## Organic Engagement");
if (inbox?.items?.length) {
  const breaches = inbox.items.filter((i) => i.first_reply_due_at && Date.parse(i.first_reply_due_at) < Date.now() && i.state !== "replied").length;
  sections.push(`- **${inbox.items.length}** interactions in the inbox`, `- **${breaches}** awaiting reply past SLA`);
} else sections.push("_No inbox data yet — run /inbox._");

sections.push("", "## Content Calendar");
if (content?.items?.length) {
  const upcoming = content.items.filter((i) => i.status === "pending").slice(0, 5);
  sections.push(`- **${content.pillars?.length || 0}** pillars · **${content.items.length}** planned posts`);
  upcoming.forEach((i) => sections.push(`  - ${String(i.publish_at).slice(0, 10)} · ${i.platform}/${i.format} · ${i.pillar_id}`));
} else sections.push("_No content plan yet — run /content-plan._");

sections.push("", "## Market Listening");
if (listening?.competitors?.length || listening?.mentions?.length) {
  sections.push(`- Tracking **${listening.competitors?.length || 0}** competitors · **${listening.mentions?.length || 0}** mentions captured`);
} else sections.push("_No listening snapshot yet — run /listening._");

const html = mdToHtml(sections.join("\n"), { title: `${clientName} — Portal`, subtitle: "Client Dashboard" });
const out = resolve(dir, "portal.html");
writeFileSync(out, html);
console.log(`portal: ${clientName} → portal.html (paid:${!!perf} organic:${!!inbox} content:${!!content} listening:${!!listening})`);
