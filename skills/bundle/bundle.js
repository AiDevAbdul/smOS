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

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { reportHead, reportFooter } from "../../scripts/lib/design_system.js";
import { mdToHtml } from "../../scripts/lib/md_to_html.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const slug = process.argv[2];
const onlyReady = process.argv.includes("--only-ready");
if (!slug || slug.startsWith("--")) { console.error("usage: bundle.js <slug> [--only-ready]"); process.exit(2); }

const clientDir = resolve(P.clientRoot(slug));
const profilePath = P.clientFile(slug, "client_profile.json"); // canonical profile.json, legacy fallback
if (!existsSync(profilePath)) { console.error(`HALT: ${profilePath} not found. Run /intake first.`); process.exit(3); }
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const clientName = profile?.business?.name || profile?.name || slug;

const catalog = readJson(resolve(ROOT, "config", "services.json")) || { agency: {} };
const agencyName = catalog.agency?.name || "smOS";

const reportsDir = P.clientReportsRoot(slug);
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

/**
 * Scan dated reports in BOTH layouts:
 *   new    → reports/<date>/<stem>.html   (stem e.g. "weekly", "audit", "before-after")
 *   legacy → reports/<date>_<stem>.html   (stem e.g. "weekly", "before_after")
 * `stemRe` matches the stem in either dash or underscore form.
 */
function scanReports(stemRe, labeller) {
  const root = reportsDir;
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root)) {
    const full = resolve(root, entry);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      for (const f of readdirSync(full)) {
        const stem = f.replace(/\.html$/, "");
        if (/\.html$/.test(f) && stemRe.test(stem)) out.push({ srcPath: resolve(full, f), date: entry, label: labeller(entry, stem) });
      }
    } else if (/\.html$/.test(entry)) {
      const m = entry.match(/^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2})_(.+)\.html$/);
      if (m && stemRe.test(m[2])) out.push({ srcPath: full, date: m[1], label: labeller(m[1], m[2]) });
      else if (/^competitor_report_.*\.html$/.test(entry) && stemRe.test("competitor")) out.push({ srcPath: full, date: "", label: labeller("", "competitor") });
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Render the shared content-creation SOP (platform-specs.md) into a design-system HTML
 * inside the client's reports dir, so the hub can include it like any other deliverable.
 * Returns the rendered path, or null if the source SOP is missing. Rendered once per
 * bundle run — keeps the canonical markdown as the single source of truth.
 */
function renderContentSops() {
  const mdPath = resolve(ROOT, "skills", "content-plan", "references", "platform-specs.md");
  if (!existsSync(mdPath)) return null;
  const md = readFileSync(mdPath, "utf8");
  const html = mdToHtml(md, {
    title: "Content Creation SOPs",
    subtitle: `${clientName} · Per-platform production playbook`,
    eyebrow: agencyName,
  });
  const out = P.clientFile(slug, "content_sops.html", { forWrite: true }); // → deliverables/content-sops/
  writeFileSync(out, html);
  return out;
}

const REPORT_TYPE = { weekly: "Weekly Report", monthly_review: "Monthly Review", before_after: "Before / After" };
function reportLabel(f) {
  const m = f.match(/^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2})_(.+)\.html$/);
  if (!m) return f.replace(/\.html$/, "");
  const pretty = REPORT_TYPE[m[2]] || m[2].replace(/_/g, " ");
  return `${pretty} · ${m[1]}`;
}

// ── Curated client journey (grouped by phase) ──────────────────────────────
const PHASE_GROUPS = [
  {
    group: "Planning",
    icon: "🔍",
    phases: [
      { key: "pre-audit", title: "Pre-Audit",
        desc: "Where you started — market & account snapshot before we engaged.",
        resolve: () => firstOf(
          exact(P.prospectDeliverable(slug, "pre-audit", "html"), "Pre-Audit"),
          exact(resolve(P.prospectRoot(slug), "pre_audit.html"), "Pre-Audit"),
          matchIn(publicDir, /-pre-audit\.html$/, () => "Pre-Audit")) },
      { key: "audit", title: "Account Audit",
        desc: "Full Facebook, Instagram & pixel health audit with a scored breakdown.",
        resolve: () => scanReports(/^audit$/, () => "Open Audit") },
    ]
  },
  {
    group: "Strategy & Creative",
    icon: "📈",
    phases: [
      { key: "research", title: "Market Research",
        desc: "Competitor creative intelligence and category benchmarking.",
        resolve: () => scanReports(/^competitor$/, () => "Open Research") },
      { key: "strategy-brief", title: "Strategy Brief",
        desc: "The paid-media game plan: objectives, offers, and creative angles.",
        resolve: () => exact(P.clientFile(slug, "strategy_brief.html"), "Open Strategy") },
      { key: "audience-map", title: "Audience Map",
        desc: "Targeting plan — audience clusters, interests, and lookalikes.",
        resolve: () => exact(P.clientFile(slug, "audience_map.html"), "Open Audience Map") },
      { key: "ad-creative", title: "Ad Creative",
        desc: "Scored, voice-checked ad copy package ready to launch.",
        resolve: () => exact(P.clientFile(slug, "ad_copy.html"), "Open Ad Copy") },
    ]
  },
  {
    group: "Content & Execution",
    icon: "📝",
    phases: [
      { key: "content-plan", title: "Content Plan",
        desc: "Your organic content pillars and the Reels-first calendar.",
        resolve: () => exact(P.clientFile(slug, "content_plan.html"), "Open Content Plan") },
      { key: "content-sops", title: "Content Creation SOPs",
        desc: "The per-platform production playbook — media specs, copy limits, algorithm signals, and publish paths for every channel.",
        resolve: () => { const p = renderContentSops(); return p ? [{ srcPath: p, label: "Open SOPs" }] : []; } },
      { key: "reports", title: "Performance Reports", group: true,
        desc: "Ongoing results — weekly, monthly, and before/after reviews.",
        resolve: () => scanReports(/^(weekly|monthly[-_]review|before[-_]after)$/, (date, stem) => {
          const pretty = REPORT_TYPE[stem.replace(/-/g, "_")] || stem.replace(/[-_]/g, " ");
          return date ? `${pretty} · ${date}` : pretty;
        }) },
    ]
  }
];

// Flatten for backward compatibility
const PHASES = PHASE_GROUPS.flatMap(g => g.phases);

// ── Resolve + copy ──────────────────────────────────────────────────────────
if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true });
// Clear stale generated copies from prior runs (different numbering / removed reports).
// Only NN-prefixed files are ours; source files (e.g. dated *-pre-audit.html) are never
// NN-prefixed, so this never deletes a phase source.
else for (const f of readdirSync(publicDir)) if (/^\d{2}-/.test(f)) rmSync(resolve(publicDir, f));

const included = [];
const missing = [];
const stepsHtml = [];
const menuItems = []; // { num, title, src|null, disabled } — feeds the top+bottom menu
let n = 0;

for (const phase of PHASES) {
  const hits = phase.resolve();
  if (!hits.length) {
    missing.push(phase.key);
    if (onlyReady) continue;
    n += 1;
    stepsHtml.push(stepBlock(n, phase.title, phase.desc, [], true));
    menuItems.push({ num: n, title: phase.title, src: null, disabled: true });
    continue;
  }
  n += 1;
  const num = String(n).padStart(2, "0");
  // Group phases (reports) keep every match; single phases take only the newest.
  const used = phase.group ? hits : hits.slice(0, 1);
  const actions = used.map((hit, i) => {
    // single phases → {NN}-{key}.html ; group phases keep their dated basename
    const destName = phase.group
      ? `${num}-${basename(hit.srcPath)}`
      : `${num}-${phase.key}.html`;
    copyFileSync(hit.srcPath, resolve(publicDir, destName));
    included.push({ phase: phase.key, src: hit.srcPath, dest: destName });
    return { href: destName, label: hit.label || phase.title };
  });
  stepsHtml.push(stepBlock(n, phase.title, phase.desc, actions, false));
  // Menu jumps to the phase's first (newest) report; the roadmap lists the rest.
  menuItems.push({ num: n, title: phase.title, src: actions[0].href, disabled: false });
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

// ── Overview view (_roadmap.html) — the numbered journey shown in the viewer ──
// No big hero here — the dark shell header is the hero. A thin eyebrow keeps the
// view from competing with the shell chrome (kills the double-hero problem).
const roadmapHtml = `<!DOCTYPE html>
<html lang="en">${reportHead({ title: `${clientName} — Overview` })}
<body><div class="ds-wrap">
  <div class="ds-eyebrow">Engagement roadmap · updated ${today}</div>
  <h1 style="font-size:var(--ds-fs-display);letter-spacing:-0.026em;margin:2px 0 6px;">Your journey, end to end</h1>
  <p class="ds-caption" style="margin:0 0 8px;max-width:60ch;">Every phase of your engagement with ${esc(agencyName)} — open any deliverable from the menu, or step through the path below.</p>
  <div class="ds-roadmap">
${stepsHtml.join("\n")}
  </div>
${reportFooter(today)}
</div></body></html>`;
writeFileSync(resolve(publicDir, "_roadmap.html"), roadmapHtml);

// ── Hub shell (index.html) — dark "OS console": menu + progress + viewer window ─
const deliveredPhases = menuItems.filter((m) => !m.disabled).length;
const totalPhases = PHASES.length;
const progressHtml = `<div class="ds-progress ds-anim" style="animation-delay:.05s">
      <div class="ds-progress__label"><span>Engagement progress</span><span class="ds-progress__count">${deliveredPhases} of ${totalPhases} delivered</span></div>
      <div class="ds-progress__track">${Array.from({ length: totalPhases }, (_, i) =>
        `<span class="ds-progress__seg${i < deliveredPhases ? " is-done" : ""}"></span>`).join("")}</div>
    </div>`;

function menuHtml(pos) {
  const home = `<button class="ds-hubnav__btn is-active" data-src="_roadmap.html" title="Overview & roadmap"><span class="icon">🏠</span><span class="label">Overview</span></button>`;

  // Build grouped items
  let groupedItems = '';
  let itemIndex = 0;

  for (const group of PHASE_GROUPS) {
    const groupPhases = group.phases;
    const groupDelivered = menuItems
      .slice(itemIndex, itemIndex + groupPhases.length)
      .filter(m => !m.disabled).length;
    const groupTotal = groupPhases.length;

    groupedItems += `
      <div class="ds-hubnav__group">
        <div class="ds-hubnav__group-header">
          <span class="icon">${group.icon}</span>
          <span class="title">${esc(group.group)}</span>
          <span class="progress">${groupDelivered}/${groupTotal}</span>
        </div>`;

    for (let i = 0; i < groupPhases.length; i++) {
      const m = menuItems[itemIndex + i];
      if (m.disabled) {
        groupedItems += `
        <span class="ds-hubnav__btn is-disabled" aria-disabled="true" title="Coming soon">
          <span class="status">🔒</span>
          <span class="label">${esc(m.title)}</span>
        </span>`;
      } else {
        groupedItems += `
        <button class="ds-hubnav__btn" data-src="${esc(m.src)}">
          <span class="status">✓</span>
          <span class="label">${esc(m.title)}</span>
        </button>`;
      }
    }

    groupedItems += `\n      </div>`;
    itemIndex += groupPhases.length;
  }

  return `<nav class="ds-hubnav${pos === "bottom" ? " ds-hubnav--bottom" : ""}" aria-label="Report navigation (${pos})">
      <div class="ds-hubnav__top">
        ${home}
      </div>
      <div class="ds-hubnav__groups">
        ${groupedItems}
      </div>
    </nav>`;
}

// Inline aurora favicon (self-contained, no external asset) + social meta.
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a84ff"/><stop offset="0.52" stop-color="#5e5ce6"/><stop offset="1" stop-color="#7d3cff"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="#0b0b10"/><rect x="6.5" y="6.5" width="19" height="19" rx="5" fill="url(#g)"/></svg>`;
const extraHead = `<meta name="description" content="${esc(clientName)} — engagement hub by ${esc(agencyName)}">
<meta property="og:title" content="${esc(clientName)} — Engagement Hub">
<meta property="og:description" content="Your full engagement with ${esc(agencyName)}, in one place.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(faviconSvg)}">`;

const bundleStyles = `<style>
/* ── Bundle Phase 1 Redesign: Grouped Navigation ─────────────────────── */

/* Grouped navigation container */
.ds-hubnav__top {
  display: flex;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ds-shell-line);
  margin-bottom: 12px;
}

.ds-hubnav__groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Phase group section */
.ds-hubnav__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ds-hubnav__group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ds-shell-mut);
}

.ds-hubnav__group-header .icon {
  font-size: 14px;
}

.ds-hubnav__group-header .progress {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-shell-ink);
}

/* Updated button styles for groups */
.ds-hubnav__group .ds-hubnav__btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  font-size: 13px;
  text-align: left;
}

.ds-hubnav__group .ds-hubnav__btn .status {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.6;
}

.ds-hubnav__group .ds-hubnav__btn.is-active .status {
  opacity: 1;
}

.ds-hubnav__group .ds-hubnav__btn .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-hubnav__group .ds-hubnav__btn .n {
  display: none;
}

/* Improved disabled state */
.ds-hubnav__btn.is-disabled {
  opacity: 0.6;
  background: var(--ds-shell-2);
  border-color: var(--ds-shell-line);
  cursor: default;
}

.ds-hubnav__btn.is-disabled:hover {
  background: var(--ds-shell-2);
  transform: none;
}

.ds-hubnav__btn.is-disabled .status {
  color: var(--ds-shell-mut);
}

/* Mobile: Vertical layout */
@media (max-width: 768px) {
  .ds-hubnav {
    flex-direction: column;
    overflow-y: auto;
    max-height: 60vh;
  }

  .ds-hubnav__group {
    gap: 4px;
  }

  .ds-hubnav__btn {
    font-size: 14px;
  }

  .ds-hubnav__group-header {
    position: sticky;
    top: 0;
    background: var(--ds-shell);
    z-index: 2;
    margin-bottom: 4px;
  }
}

/* Collapse bottom nav on small screens */
@media (max-width: 640px) {
  .ds-hubnav--bottom {
    display: none;
  }
}
</style>`;

const html = `<!DOCTYPE html>
<html lang="en">${reportHead({ title: `${clientName} — Engagement Hub`, extraHead })}
${bundleStyles}
<body><div class="ds-hub">
  <a class="ds-skip" href="#viewer-main">Skip to report</a>
  <header class="ds-hub__head">
    <div class="ds-hub__id ds-anim">
      <div class="ds-hub__eyebrow">${esc(agencyName)} · Client Hub</div>
      <h1 class="ds-hub__title">${esc(clientName)}</h1>
      <div class="ds-hub__sub">Your engagement, start to finish · updated ${today}</div>
    </div>
    ${progressHtml}
  </header>
  ${menuHtml("top")}
  <main class="ds-viewer-wrap ds-anim" id="viewer-main" tabindex="-1" style="animation-delay:.1s">
    <iframe class="ds-viewer" id="viewer" title="Report viewer" src="_roadmap.html"></iframe>
    <div class="ds-viewer__loader" id="loader" aria-hidden="true"><div class="ds-spinner"></div></div>
  </main>
</div>
<script>
  (function () {
    var viewer = document.getElementById("viewer");
    var loader = document.getElementById("loader");
    var main = document.getElementById("viewer-main");
    viewer.addEventListener("load", function () { loader.classList.remove("is-on"); });
    document.addEventListener("click", function (e) {
      var b = e.target.closest(".ds-hubnav__btn[data-src]");
      if (!b) return;
      var src = b.getAttribute("data-src");
      if (viewer.getAttribute("src") !== src) { loader.classList.add("is-on"); viewer.setAttribute("src", src); }
      document.querySelectorAll(".ds-hubnav__btn").forEach(function (x) {
        x.classList.toggle("is-active", x.getAttribute("data-src") === src);
      });
      main.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  })();
</script>
</body></html>`;

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
