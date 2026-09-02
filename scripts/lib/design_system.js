// scripts/lib/design_system.js — the one smOS ("Ledger") design system for
// every Node-rendered client report. Reads design-system/smos-design-system.css
// at render time so there is a SINGLE source of truth: edit the .css once and
// every deliverable (audit, weekly, monthly, before/after, analyze) inherits it.
//
// Usage:
//   import { designSystemCss, reportHead, heroHeader, reportFooter } from "./design_system.js";
//   const html = `<!DOCTYPE html><html lang="en">${reportHead({title})}
//     <body><div class="ds-wrap">${heroHeader({title, subtitle})} ... ${reportFooter()}</div></body></html>`;

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CSS_PATH = resolve(ROOT, "design-system", "smos-design-system.css");

let _css = null;
/** The canonical design-system CSS as a string (cached after first read). */
export function designSystemCss() {
  if (_css === null) _css = readFileSync(CSS_PATH, "utf8");
  return _css;
}

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Sets document.documentElement.dataset.theme from localStorage (fallback: OS
// preference) BEFORE first paint, so there's no flash-of-wrong-theme. Must run
// synchronously in <head>. Self-contained — no external requests.
const THEME_BOOTSTRAP_SCRIPT = `<script>(function(){try{var t=localStorage.getItem("smos-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>`;

/** Inline bootstrap script that sets the theme before paint. Exported for callers
 *  that build <head> manually instead of via reportHead(). */
export function themeBootstrapScript() {
  return THEME_BOOTSTRAP_SCRIPT;
}

// Toggles data-theme between light/dark and persists to localStorage. Reads the
// resolved theme off documentElement (already set by the bootstrap script, which
// falls back to the OS preference via the CSS media query when no override is saved).
const THEME_TOGGLE_SCRIPT = `<script>(function(){function apply(){var b=document.querySelector(".ds-theme-toggle");if(!b)return;b.addEventListener("click",function(){var root=document.documentElement;var current=root.getAttribute("data-theme")||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var next=current==="dark"?"light":"dark";root.setAttribute("data-theme",next);try{localStorage.setItem("smos-theme",next);}catch(e){}b.setAttribute("aria-pressed",String(next==="dark"));});}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",apply);else apply();})();</script>`;

/** Sun/moon icon toggle button — drop into the hero's top-right corner. Wired by
 *  the script reportHead() injects; no per-renderer JS needed. */
export function themeToggleButton() {
  return `<button type="button" class="ds-theme-toggle" aria-label="Toggle dark mode" aria-pressed="false">
<svg class="ds-theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1.5a1 1 0 0 1-1 1Zm0 15a1 1 0 0 1 1 1V22a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1ZM4.5 12a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h1.5a1 1 0 0 1 1 1Zm18 0a1 1 0 0 1-1 1H20a1 1 0 1 1 0-2h1.5a1 1 0 0 1 1 1ZM6.3 6.3a1 1 0 0 1-1.4 0L3.8 5.2a1 1 0 1 1 1.4-1.4L6.3 4.9a1 1 0 0 1 0 1.4Zm12.9 12.9a1 1 0 0 1-1.4 0l-1.1-1.1a1 1 0 1 1 1.4-1.4l1.1 1.1a1 1 0 0 1 0 1.4ZM6.3 17.7l-1.1 1.1a1 1 0 1 1-1.4-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4ZM19.2 6.3a1 1 0 0 1-1.4 0 1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 1 1 1.4 1.4l-1.1 1.1ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/></svg>
<svg class="ds-theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.6a8.6 8.6 0 0 1-10.3-10A8.6 8.6 0 1 0 20.7 14.6Z"/></svg>
</button>`;
}

// The "Ledger" type trio (display / body / data). render_pdf.py waits for
// networkidle so the real faces land in PDFs; the CSS declares system fallback
// stacks (Arial Narrow / Helvetica / Menlo) so offline HTML stays legible.
const FONTS_LINK = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">`;

/** The Google Fonts <link> tags for the design system's type trio. Exported for
 *  callers that build <head> manually instead of via reportHead(). */
export function fontsLink() {
  return FONTS_LINK;
}

/** Full <head> with the design system inlined plus any extra <head> tags (e.g. Chart.js).
 *  Includes the fonts link, the theme bootstrap script (pre-paint), and the toggle wiring. */
export function reportHead({ title = "smOS Report", extraHead = "" } = {}) {
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${THEME_BOOTSTRAP_SCRIPT}
${FONTS_LINK}
${extraHead}
<style>${designSystemCss()}</style>
</head>`;
}

/**
 * The ONE canonical report hero. Every client-facing report renders this exact
 * markup — never hand-roll a <header class="ds-hero"> or a bespoke .hero.
 *
 *  title    — required headline
 *  subtitle — `·`-separated meta line
 *  eyebrow  — badge pill text (e.g. agency name / report type)
 *  headline — optional one-line summary under the title
 *  pills    — optional array of short snapshot strings
 *  aside    — optional pre-rendered HTML for the right-hand executive column
 *             (e.g. a score ring + hero stat); pass via heroAside().
 *  themeToggle — set false to suppress the light/dark toggle button (e.g. the
 *             /bundle hub shell, which is permanently dark chrome). Default true.
 */
export function heroHeader({ title, subtitle = "", subtitleHtml = "", eyebrow = "", headline = "", pills = [], aside = "", themeToggle = true } = {}) {
  const pillsHtml = pills.length
    ? `<div class="ds-hero__pills">${pills.map((p) => `<span class="ds-hero__pill">${esc(p)}</span>`).join("")}</div>`
    : "";
  // subtitleHtml is trusted HTML (caller escapes dynamic parts); subtitle is escaped.
  const metaInner = subtitleHtml || (subtitle ? esc(subtitle) : "");
  return `<header class="ds-hero">
${themeToggle ? themeToggleButton() : ""}
<div class="ds-hero__inner${aside ? " has-aside" : ""}">
<div class="ds-hero__main">
${eyebrow ? `<div class="ds-hero__badge">${esc(eyebrow)}</div>` : ""}
<h1>${esc(title)}</h1>
${metaInner ? `<div class="ds-meta">${metaInner}</div>` : ""}
${headline ? `<div class="ds-hero__headline">${esc(headline)}</div>` : ""}
${pillsHtml}
</div>
${aside ? `<div class="ds-hero__aside">${aside}</div>` : ""}
</div>
</header>
${themeToggle ? THEME_TOGGLE_SCRIPT : ""}`;
}

/** Build the optional right-hand hero column: an HTML body (e.g. a score ring)
 *  plus an optional single hero stat (label / value / caption). */
export function heroAside({ body = "", statLabel = "", statValue = "", statCaption = "" } = {}) {
  const stat = statValue
    ? `<div class="ds-hero__stat">
${statLabel ? `<div class="ds-hero__stat-label">${esc(statLabel)}</div>` : ""}
<div class="ds-hero__stat-value">${esc(statValue)}</div>
${statCaption ? `<div class="ds-hero__stat-caption">${esc(statCaption)}</div>` : ""}
</div>`
    : "";
  return `${body}${stat}`;
}

let _agencyName = null;
/** The agency's display name (config/services.json → agency.name), for client-facing copy. */
export function agencyName() {
  if (_agencyName === null) {
    try {
      _agencyName = JSON.parse(readFileSync(resolve(ROOT, "config", "services.json"), "utf8"))?.agency?.name || "the team";
    } catch {
      _agencyName = "the team";
    }
  }
  return _agencyName;
}

/** Standard footer. Pass an ISO date string (callers avoid new Date() in workflows).
 *  Reports are attributed to smOS (owner decision, 2026-09-02) — the agency name
 *  from config/services.json is still used for contractual/legal copy elsewhere. */
export function reportFooter(date = new Date().toISOString().slice(0, 10)) {
  return `<footer class="ds-footer">Prepared by smOS · ${esc(date)}</footer>`;
}
