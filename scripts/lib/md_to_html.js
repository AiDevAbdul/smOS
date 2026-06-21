// scripts/lib/md_to_html.js — shared Markdown → styled HTML for client reports (H2).
//
// Every client-facing report (/report, /analyze, /before-after, /monthly-review)
// writes Markdown; this turns it into a self-contained, print-ready HTML page using
// the SAME Apple-flavored design tokens as the pre-audit template, then render_pdf.py
// converts it to the shareable PDF. One visual language across every deliverable.
//
// Deliberately dependency-free: a small, predictable Markdown subset (headings,
// bold/italic/code, links, lists, tables, hr, paragraphs) — enough for our
// template-filled reports, with HTML escaped so data can't break the layout.

import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline: `code`, **bold**, *italic*, [text](url). Order matters; code first.
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => `<a href="${esc(url)}">${txt}</a>`);
  return t;
}

function tableRow(line, isHeader) {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const tag = isHeader ? "th" : "td";
  return `<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`;
}

/** Convert a Markdown string to an HTML <body> fragment. */
export function mdToFragment(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  let listOpen = null; // 'ul' | 'ol'
  const closeList = () => { if (listOpen) { out.push(`</${listOpen}>`); listOpen = null; } };

  while (i < lines.length) {
    const line = lines[i];

    // Table block: a header row followed by a |---| separator
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1] || "")) {
      closeList();
      const rows = [tableRow(line, true)];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(tableRow(lines[i], false)); i++; }
      out.push(`<div class="table-wrap"><table>${rows[0] ? `<thead>${rows[0]}</thead>` : ""}<tbody>${rows.slice(1).join("")}</tbody></table></div>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    if (/^\s*([-*+])\s+/.test(line)) {
      if (listOpen !== "ul") { closeList(); out.push("<ul>"); listOpen = "ul"; }
      out.push(`<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`); i++; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listOpen !== "ol") { closeList(); out.push("<ol>"); listOpen = "ol"; }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`); i++; continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }
    if (line.trim() === "") { closeList(); i++; continue; }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  background: #f5f5f7; color: #1d1d1f; line-height: 1.55; }
.wrap { max-width: 920px; margin: 0 auto; padding: 40px 24px 64px; }
.report-header { background: linear-gradient(135deg,#0a84ff,#0066cc); color: #fff; border-radius: 20px;
  padding: 36px 32px; margin-bottom: 28px; }
.report-header h1 { margin: 0; font-size: 28px; font-weight: 700; }
.report-header .meta { margin-top: 8px; font-size: 13px; opacity: .85; }
h1,h2,h3,h4 { color: #1d1d1f; line-height: 1.25; }
h1 { font-size: 26px; font-weight: 700; margin: 32px 0 14px; }
h2 { font-size: 21px; font-weight: 600; margin: 30px 0 12px; }
h3 { font-size: 16px; font-weight: 600; margin: 22px 0 10px; }
p { margin: 10px 0; }
a { color: #0066cc; text-decoration: none; }
code { background: #f2f2f7; border-radius: 5px; padding: 1px 6px; font-size: 88%;
  font-family: "SF Mono", ui-monospace, Menlo, monospace; }
ul,ol { margin: 10px 0 10px 4px; padding-left: 22px; }
li { margin: 4px 0; }
hr { border: 0; border-top: 1px solid #e2e2e7; margin: 28px 0; }
.table-wrap { overflow-x: auto; margin: 16px 0; border-radius: 14px; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.06); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
thead th { background: #1d1d1f; color: #fff; text-align: left; padding: 12px 14px; font-weight: 600; }
tbody td { padding: 11px 14px; border-top: 1px solid #f0f0f3; }
tbody tr:nth-child(even) { background: #fafafd; }
.report-footer { margin-top: 40px; color: #8e8e93; font-size: 12px; text-align: center; }
@page { size: Letter; margin: 14mm; }
@media print { body { background: #fff; } .table-wrap { box-shadow: none; } }
`;

/** Wrap a Markdown report into a full, self-contained HTML document. */
export function mdToHtml(md, { title = "smOS Report", subtitle = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style></head>
<body><div class="wrap">
<div class="report-header"><h1>${esc(title)}</h1>${subtitle ? `<div class="meta">${esc(subtitle)}</div>` : ""}</div>
${mdToFragment(md)}
<div class="report-footer">Generated by smOS · ${esc(new Date().toISOString().slice(0, 10))}</div>
</div></body></html>`;
}

/**
 * Write HTML next to a markdown report and render a PDF via render_pdf.py.
 * Returns { htmlPath, pdfPath, pdfOk }. PDF failure is non-fatal (HTML still ships).
 */
export function writeHtmlAndPdf(mdPath, md, meta = {}) {
  const htmlPath = mdPath.replace(/\.md$/, "") + ".html";
  writeFileSync(htmlPath, mdToHtml(md, meta));
  const pdfPath = htmlPath.replace(/\.html$/, ".pdf");
  let pdfOk = false;
  try {
    const r = spawnSync("python3", [resolve(ROOT, "render_pdf.py"), htmlPath, "--output", pdfPath],
      { encoding: "utf8" });
    pdfOk = r.status === 0;
    if (!pdfOk) console.error(`[md_to_html] PDF render failed for ${basename(htmlPath)}: ${(r.stderr || "").split("\n")[0]}`);
  } catch (e) {
    console.error(`[md_to_html] PDF render skipped: ${e.message}`);
  }
  return { htmlPath, pdfPath, pdfOk };
}
