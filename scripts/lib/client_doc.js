/**
 * client_doc.js — shared chrome for client-facing document skills (proposal,
 * contract, billing, intake welcome). Wraps body HTML in a self-contained
 * design-system document and renders a sibling PDF via scripts/render_pdf.py.
 *
 * Why this exists: /proposal, /contract, /billing and /intake all ship a polished
 * HTML+PDF deliverable on the SAME Cupertino design system. Rendering them through
 * the generic Markdown path (mdToHtml) produced duplicate <h1>s, literal
 * `_italics_`, empty heroes and unstyled bodies. Each skill now builds structured
 * HTML with the ds-* components and passes it here for the shell + PDF step — one
 * place to own the wrapper and the Chromium spawn, no per-skill duplication.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { reportHead, reportFooter } from "./design_system.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** HTML-escape a dynamic value for safe interpolation into markup. */
export const escHtml = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Wrap pre-rendered body HTML in a full, self-contained design-system document
 * (design system inlined, dark-mode + print aware, theme bootstrap in <head>).
 *   title    — <title> + used by callers for their hero
 *   extraCss — optional skill-specific CSS (built on --ds-* tokens, no raw hex)
 *   body     — the rendered <body> content (hero + sections)
 *   date     — ISO date for the footer
 */
export function docShell({ title = "smOS Document", extraCss = "", body = "", date }) {
  return `<!DOCTYPE html>
<html lang="en">
${reportHead({ title, extraHead: extraCss ? `<style>${extraCss}</style>` : "" })}
<body><div class="ds-wrap">
${body}
${reportFooter(date)}
</div></body></html>`;
}

/**
 * Write the HTML and render a sibling PDF via scripts/render_pdf.py (headless
 * Chromium). PDF failure is non-fatal — the HTML still ships. Mirrors the
 * contract md_to_html's writeHtmlAndPdf honored elsewhere.
 * Returns { htmlPath, pdfPath, pdfOk }.
 */
export function writeDocHtmlAndPdf(htmlPath, html) {
  writeFileSync(htmlPath, html);
  const pdfPath = htmlPath.replace(/\.html$/, "") + ".pdf";
  let pdfOk = false;
  try {
    const r = spawnSync("python3", [resolve(ROOT, "scripts", "render_pdf.py"), htmlPath, "--output", pdfPath], { encoding: "utf8" });
    pdfOk = r.status === 0;
    if (!pdfOk) console.error(`[client_doc] PDF render failed for ${basename(htmlPath)}: ${(r.stderr || "").split("\n")[0]}`);
  } catch (e) {
    console.error(`[client_doc] PDF render skipped: ${e.message}`);
  }
  return { htmlPath, pdfPath, pdfOk };
}

/** A standard content section: eyebrow + h2 + optional sub + body HTML. */
export function docSection({ id = "", eyebrow = "", title = "", sub = "", body = "" }) {
  return `<section class="ds-section"${id ? ` id="${id}"` : ""}>
${eyebrow ? `<div class="ds-eyebrow">${escHtml(eyebrow)}</div>` : ""}
${title ? `<h2>${escHtml(title)}</h2>` : ""}
${sub ? `<p class="ds-caption" style="margin:-2px 0 16px;max-width:640px">${escHtml(sub)}</p>` : ""}
${body}
</section>`;
}
