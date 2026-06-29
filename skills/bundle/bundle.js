#!/usr/bin/env node
/**
 * /bundle companion — single shareable client deliverables hub (Phase 5+).
 *
 * Pure assembler: it NEVER re-renders or re-derives a report. It collects the
 * client-facing HTML other skills already produced (pre-audit, audit, research,
 * strategy, audience, creative, content plan, performance reports), copies each
 * into public/reports/{slug}/, and writes a numbered "client journey" roadmap
 * index.html — the single link you share. Offline-safe; touches no live API.
 *
 * Each journey phase becomes a bold circular numbered step (ds-roadmap). A phase
 * with a rendered report gets an "Open" button; a missing phase shows muted
 * "In progress" so the client sees the full start→end arc (suppress with
 * --only-ready). Deploy is a separate, explicit step — this only writes files.
 *
 * Usage: node skills/bundle/bundle.js <slug> [--only-ready]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { reportHead, heroHeader, reportFooter } from "../../scripts/lib/design_system.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
const onlyReady = process.argv.includes("--only-ready");
if (!slug || slug.startsWith("--")) { console.error("usage: bundle.js <slug> [--only-ready]"); process.exit(2); }

const clientDir = resolve(ROOT, "clients", slug);
const profilePath = resolve(clientDir, "client_profile.json");
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found. Run /intake first.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const clientName = profile?.business?.name || profile?.name || slug;

const catalog = readJson(resolve(ROOT, "config", "services.json")) || { agency: {} };
const agencyName = catalog.agency?.name || "smOS";

const reportsDir = resolve(clientDir, "reports");
const publicDir = resolve(ROOT, "public", "reports", slug);
const today = new Date().toISOString().slice(0, 10);

function readJson(p) { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } }
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Exact file → [{srcPath, label}] (0 or 1). */
function exact(p, label) { return existsSync(p) ? [{ srcPath: p, label }] : []; }
/** Files in `dir` matching `re`, newest filename first → array of {srcPath, label}. */
function matchIn(dir, re, labeller) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .sort((a, b) => b.localeCompare(a))
    .map((f) => ({ srcPath: resolve(dir, f), label: labeller ? labeller(f) : f }));
}
/** First non-empty resolver result. */
function firstOf(...lists) { for (const l of lists) if (l.length) return l.slice(0, 1); return []; }

const REPORT_TYPE = { weekly: "Weekly Report", monthly_review: "Monthly Review", before_after: "Before / After" };
function reportLabel(f) {
  const m = f.match(/^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2})_(.+)\.html$/);
  if (!m) return f.replace(/\.html$/, "");
  const pretty = REPORT_TYPE[m[2]] || m[2].replace(/_/g, " ");
  return `${pretty} · ${m[1]}`;
}

// ── Curated client journey ──────────────────────────────────────────────────
const PHASES = [
  { key: "pre-audit", title: "Pre-Audit",
    desc: "Where you started — market & account snapshot before we engaged.",
    resolve: () => firstOf(
      exact(resolve(ROOT, "prospects", slug, "pre_audit.html"), "Pre-Audit"),
      matchIn(publicDir, /-pre-audit\.html$/, () => "Pre-Audit")) },
  { key: "audit", title: "Account Audit",
    desc: "Full Facebook, Instagram & pixel health audit with a scored breakdown.",
    resolve: () => matchIn(reportsDir, /_audit\.html$/, () => "Open Audit") },
  { key: "research", title: "Market Research",
    desc: "Competitor creative intelligence and category benchmarking.",
    resolve: () => matchIn(reportsDir, /^competitor_report_.*\.html$/, () => "Open Research") },
  { key: "strategy-brief", title: "Strategy Brief",
    desc: "The paid-media game plan: objectives, offers, and creative angles.",
    resolve: () => exact(resolve(clientDir, "strategy_brief.html"), "Open Strategy") },
  { key: "audience-map", title: "Audience Map",
    desc: "Targeting plan — audience clusters, interests, and lookalikes.",
    resolve: () => exact(resolve(clientDir, "audience_map.html"), "Open Audience Map") },
  { key: "ad-creative", title: "Ad Creative",
    desc: "Scored, voice-checked ad copy package ready to launch.",
    resolve: () => exact(resolve(clientDir, "ad_copy.html"), "Open Ad Copy") },
  { key: "content-plan", title: "Content Plan",
    desc: "Your organic content pillars and the Reels-first calendar.",
    resolve: () => exact(resolve(clientDir, "content_plan.html"), "Open Content Plan") },
  { key: "reports", title: "Performance Reports", group: true,
    desc: "Ongoing results — weekly, monthly, and before/after reviews.",
    resolve: () => matchIn(reportsDir, /_(weekly|monthly_review|before_after)\.html$/, reportLabel) },
];

// ── Resolve + copy ──────────────────────────────────────────────────────────
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
// Clear stale generated copies from prior runs (different numbering / removed reports).
// Only NN-prefixed files are ours; source files (e.g. dated *-pre-audit.html) are never
// NN-prefixed, so this never deletes a phase source.
else for (const f of readdirSync(publicDir)) if (/^\d{2}-/.test(f)) rmSync(resolve(publicDir, f));

const included = [];
const missing = [];
const stepsHtml = [];
let n = 0;

for (const phase of PHASES) {
  const hits = phase.resolve();
  if (!hits.length) {
    missing.push(phase.key);
    if (onlyReady) continue;
    n += 1;
    stepsHtml.push(stepBlock(n, phase.title, phase.desc, [], true));
    continue;
  }
  n += 1;
  const num = String(n).padStart(2, "0");
  const actions = hits.map((hit, i) => {
    // single phases → {NN}-{key}.html ; group phases keep their dated basename
    const destName = phase.group
      ? `${num}-${basename(hit.srcPath)}`
      : `${num}-${phase.key}.html`;
    copyFileSync(hit.srcPath, resolve(publicDir, destName));
    included.push({ phase: phase.key, src: hit.srcPath, dest: destName });
    return { href: destName, label: hit.label || phase.title };
  });
  stepsHtml.push(stepBlock(n, phase.title, phase.desc, actions, false));
}

function stepBlock(num, title, desc, actions, pending) {
  const cls = pending ? "ds-step is-pending" : "ds-step";
  const btns = actions.length
    ? actions.map((a) => `<a class="ds-btn" href="${esc(a.href)}">${esc(a.label)} &rarr;</a>`).join("\n        ")
    : `<span class="ds-btn" aria-disabled="true">In progress</span>`;
  return `    <div class="${cls}">
      <div class="ds-step-num">${num}</div>
      <div class="ds-step-body">
        <div class="ds-step-title">${esc(title)}</div>
        <p class="ds-step-desc">${esc(desc)}</p>
        <div class="ds-step-actions">
        ${btns}
        </div>
      </div>
    </div>`;
}

// ── Assemble the hub page ─────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">${reportHead({ title: `${clientName} — Engagement Hub` })}
<body><div class="ds-wrap">
${heroHeader({ title: clientName, subtitle: `Your engagement, start to finish · updated ${today}`, eyebrow: `${agencyName} · Client Hub` })}
  <div class="ds-roadmap">
${stepsHtml.join("\n")}
  </div>
${reportFooter(today)}
</div></body></html>`;

const hubPath = resolve(publicDir, "index.html");
writeFileSync(hubPath, html);

// ── Update the public manifest (de-dupe by slug + bundle) ─────────────────────
const manifestPath = resolve(ROOT, "public", "reports", "index.json");
const manifest = readJson(manifestPath) || [];
const next = manifest.filter((e) => !(e.slug === slug && e.type === "bundle"));
next.push({ slug, type: "bundle", client: clientName, date: today, url: `/reports/${slug}/`, generated_at: new Date().toISOString() });
writeFileSync(manifestPath, JSON.stringify(next, null, 2) + "\n");

// ── Report ────────────────────────────────────────────────────────────────────
// All client hubs live under one neutral Vercel project (smos-reports); each
// client is its own path. Override the base via SMOS_REPORTS_BASE_URL.
const baseUrl = (process.env.SMOS_REPORTS_BASE_URL || "https://smos-reports.vercel.app").replace(/\/$/, "");
const publicPath = `/reports/${slug}/`;
console.log(JSON.stringify({
  hub: hubPath,
  public_path: publicPath,
  share_url: `${baseUrl}${publicPath}`,
  included_phases: included.map((i) => i.phase),
  missing_phases: missing,
  files_copied: included.length,
  deploy_hint: "vercel deploy --prod   (deploy is a separate, explicit step; then share share_url)",
}, null, 2));
