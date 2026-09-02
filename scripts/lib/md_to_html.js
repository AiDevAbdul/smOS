// scripts/lib/md_to_html.js — shared Markdown → styled HTML for client reports (H2).
//
// Every client-facing report (/report, /analyze, /before-after, /monthly-review)
// writes Markdown; this turns it into a self-contained, print-ready HTML page using
// the SAME "Ledger" design tokens as every other deliverable, then render_pdf.py
// converts it to the shareable PDF. One visual language across every deliverable.
//
// Deliberately dependency-free: a small, predictable Markdown subset (headings,
// bold/italic/code, links, lists, tables, hr, paragraphs) — enough for our
// template-filled reports, with HTML escaped so data can't break the layout.

import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { reportHead, heroHeader, reportFooter } from "./design_system.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inline: `code`, **bold**, *italic*, [text](url). Order matters; code first.
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); // non-greedy: bold may contain *italic*
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

  // A source line that starts a block of its own (vs. a hard-wrapped
  // continuation of the previous paragraph / list item).
  const isBlockStart = (l) =>
    l === undefined || l.trim() === "" ||
    /^\s*\|.*\|\s*$/.test(l) ||            // table row
    /^(#{1,6})\s+/.test(l) ||               // heading
    /^\s*([-*+])\s+/.test(l) ||             // ul item
    /^\s*\d+\.\s+/.test(l) ||               // ol item
    /^\s*>/.test(l) ||                      // blockquote
    /^\s*([-*_])\1{2,}\s*$/.test(l);        // hr

  while (i < lines.length) {
    const line = lines[i];

    // Table block: a header row followed by a |---| separator
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1] || "")) {
      closeList();
      const rows = [tableRow(line, true)];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(tableRow(lines[i], false)); i++; }
      out.push(`<div class="ds-table-wrap"><table>${rows[0] ? `<thead>${rows[0]}</thead>` : ""}<tbody>${rows.slice(1).join("")}</tbody></table></div>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // List items: swallow hard-wrapped continuation lines into the same <li>,
    // so a wrapped item doesn't split the list into fragments.
    if (/^\s*([-*+])\s+/.test(line)) {
      if (listOpen !== "ul") { closeList(); out.push("<ul>"); listOpen = "ul"; }
      let item = line.replace(/^\s*[-*+]\s+/, "");
      while (!isBlockStart(lines[i + 1])) { i++; item += " " + lines[i].trim(); }
      out.push(`<li>${inline(item)}</li>`); i++; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listOpen !== "ol") { closeList(); out.push("<ol>"); listOpen = "ol"; }
      let item = line.replace(/^\s*\d+\.\s+/, "");
      while (!isBlockStart(lines[i + 1])) { i++; item += " " + lines[i].trim(); }
      out.push(`<li>${inline(item)}</li>`); i++; continue;
    }

    // Blockquote block: consecutive `>` lines → a fine-print callout.
    if (/^\s*>/.test(line)) {
      closeList();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const paras = quote.join("\n").split(/\n{2,}/)
        .map((p) => `<p>${inline(p.replace(/\n/g, " ").trim())}</p>`).join("");
      out.push(`<div class="ds-callout ds-callout--warn">${paras}</div>`);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }
    if (line.trim() === "") { closeList(); i++; continue; }

    // Paragraph: coalesce hard-wrapped source lines into ONE <p> (also lets
    // inline spans like **bold** cross source-line wraps).
    closeList();
    let para = line.trim();
    while (!isBlockStart(lines[i + 1])) { i++; para += " " + lines[i].trim(); }
    out.push(`<p>${inline(para)}</p>`);
    i++;
  }
  closeList();
  return out.join("\n");
}

/** Wrap a Markdown report into a full, self-contained HTML document on the smOS design system. */
export function mdToHtml(md, { title = "smOS Report", subtitle = "", eyebrow = "" } = {}) {
  // The masthead already carries the report title — drop the markdown's own
  // leading H1 so it doesn't render twice.
  const body = String(md).replace(/^\s*#\s+[^\n]*\n+/, "");
  return `<!DOCTYPE html>
<html lang="en">${reportHead({ title })}
<body><div class="ds-wrap">
${heroHeader({ title, subtitle, eyebrow })}
${mdToFragment(body)}
${reportFooter()}
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
