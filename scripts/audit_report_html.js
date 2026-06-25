#!/usr/bin/env node
/**
 * audit_report_html.js — the ONE standardized /audit HTML renderer.
 *
 * Reads clients/<slug>/audit_raw.json (the deterministic output of skills/audit/audit.js)
 * and emits a branded, self-contained HTML deliverable. Mirrors the pre-audit rule:
 * never hand-write a per-client renderer — if a section is missing, edit THIS template
 * so every future client inherits it. PDF is produced by scripts/render_pdf.py.
 *
 * Usage:
 *   node scripts/audit_report_html.js <slug> [--out <path.html>]
 *
 * The qualitative blocks (wins / issues / next steps) are read from the filled
 * audit_report.md if present (Claude writes them there), so the HTML and MD stay in sync.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const yn = (v) => (v == null ? '<span class="pill wn">unknown</span>' : v ? '<span class="pill ok">yes</span>' : '<span class="pill bd">no</span>');
const ringColor = (s) => (s >= 67 ? "var(--good)" : s >= 34 ? "var(--warn)" : "var(--bad)");

// Pull numbered bullet text out of the filled markdown report. Matches either a bold
// inline label ("**Top 3 wins…:**") or a section heading ("## Recommended Next Steps").
function listFromMd(md, header) {
  if (!md) return [];
  const re = new RegExp(`(?:\\*\\*${header}[^\\n]*|##+\\s*${header}[^\\n]*)\\n([\\s\\S]*?)(?:\\n\\s*-\\s\\*\\*|\\n---|\\n##)`, "i");
  const block = md.match(re)?.[1] || "";
  return [...block.matchAll(/^\s*\d+\.\s+(.*)$/gm)]
    .map((m) => m[1].trim())
    .filter((t) => t && !/_\(Claude to fill/i.test(t));
}

// Render a markdown bullet: bold spans → <b>, `code` spans → <code>, after escaping.
function mdInline(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

function bullets(items, cls) {
  if (!items.length) return `<li class="${cls}"><em>(pending qualitative analysis)</em></li>`;
  return items.map((t) => `<li class="${cls}">${mdInline(t)}</li>`).join("\n");
}

function render(slug) {
  const raw = JSON.parse(readFileSync(resolve(ROOT, "clients", slug, "audit_raw.json"), "utf8"));
  const mdPath = resolve(ROOT, "clients", slug, "audit_report.md");
  const md = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";

  const fb = raw.organic?.facebook || {};
  const ig = raw.organic?.instagram || {};
  const paid = raw.paid || {};
  const wt = raw.website_tracking || {};
  const xref = raw.pixel_cross_reference || {};
  const score = raw.health_score ?? 0;
  const date = (raw.generated_at || "").slice(0, 10);
  const name = fb.page_name || slug;

  const wins = listFromMd(md, "Top 3 wins");
  const issues = listFromMd(md, "Top 3 issues");
  const steps = listFromMd(md, "Top 3 next steps") .length ? listFromMd(md, "Top 3 next steps") : listFromMd(md, "Recommended Next Steps");

  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
  const igLine = ig.source === "pre_audit_public_estimate"
    ? `${fmt(ig.followers)} <span class="pill wn">pre-audit estimate</span>`
    : fmt(ig.followers);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — Account Audit (${date})</title>
<style>
:root{--ink:#1a1f2e;--mut:#5b6478;--line:#e6e8ef;--blue:#1d4ed8;--bg:#f7f8fb;--good:#0f9d58;--warn:#e8a300;--bad:#d93025}
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:860px;margin:0 auto;padding:40px 28px}
header{border-bottom:3px solid var(--blue);padding-bottom:18px;margin-bottom:28px}
.brand{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--blue);font-weight:700}
h1{font-size:27px;margin:6px 0 4px}.meta{color:var(--mut);font-size:13px}
.meta code{background:#eef1f7;padding:1px 6px;border-radius:4px;font-size:12px}
h2{font-size:19px;margin:34px 0 14px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.score{display:flex;align-items:center;gap:22px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px 26px}
.ring{width:96px;height:96px;border-radius:50%;display:grid;place-items:center;flex:0 0 auto;background:conic-gradient(${ringColor(score)} 0 ${Math.round(score * 3.6)}deg,#eceef4 ${Math.round(score * 3.6)}deg 360deg)}
.ring b{width:74px;height:74px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:26px;font-weight:800}
.ring small{display:block;font-size:11px;color:var(--mut);font-weight:600;text-align:center}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}
.card .k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);font-weight:700}
.card .v{font-size:22px;font-weight:800;margin-top:4px}.card .s{font-size:12px;color:var(--mut)}
ul{margin:8px 0 8px 4px;list-style:none}
li{padding:6px 0 6px 26px;position:relative;border-bottom:1px solid #f0f2f7}li:last-child{border-bottom:0}
li.win::before{content:"✓";color:var(--good);font-weight:800;position:absolute;left:4px}
li.iss::before{content:"!";color:var(--bad);font-weight:800;position:absolute;left:7px}
ol.steps{counter-reset:s;list-style:none}
li.step::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:6px;width:18px;height:18px;background:var(--blue);color:#fff;border-radius:50%;font-size:11px;font-weight:700;display:grid;place-items:center}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{background:#eef1f7;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px}
.ok{background:#e6f4ea;color:var(--good)}.wn{background:#fdf3da;color:#9a6b00}.bd{background:#fce8e6;color:var(--bad)}
.callout{background:#fff5f5;border:1px solid #f3c9c5;border-left:4px solid var(--bad);border-radius:8px;padding:14px 16px;margin:14px 0}
footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:12px}
@media(max-width:640px){.cards{grid-template-columns:1fr}.score{flex-direction:column;text-align:center}}
</style></head><body><div class="wrap">
<header><div class="brand">${esc(name)} · Account Audit</div>
<h1>Meta Account &amp; Page Audit</h1>
<div class="meta">${date} · Page <code>${esc(fb.page_id || "—")}</code> · Ad acct <code>${esc(paid.account_id || "none")}</code>${raw.pre_audit_source ? ` · pre-audit reused from <code>${esc(raw.pre_audit_source)}</code>` : ""}</div></header>

<div class="score"><div class="ring"><b>${score}<small>/100</small></b></div>
<div><h2 style="border:0;margin:0 0 4px;padding:0">Overall health</h2>
<p style="color:var(--mut)">Weighted across page completeness, pixel health, audiences, naming, posting consistency, engagement, and account financials. Components blocked by permissions are dropped and the rest renormalized — not scored as zero.</p></div></div>

<div class="cards">
<div class="card"><div class="k">FB followers</div><div class="v">${fmt(fb.followers)}</div><div class="s">${fb.new_follows_90d != null ? `+${fmt(fb.new_follows_90d)} new (90d)` : "organic"}</div></div>
<div class="card"><div class="k">Last post</div><div class="v">${fb.days_since_last_post != null ? fb.days_since_last_post + "d" : "—"}</div><div class="s">${fb.post_count ?? 0} in last 60d</div></div>
<div class="card"><div class="k">Video mix</div><div class="v">${fb.format_mix_pct?.video ?? 0}%</div><div class="s">of windowed posts</div></div>
<div class="card"><div class="k">Ad account</div><div class="v">${paid.skipped ? "none" : paid.account_status === 1 ? "Active" : "code " + (paid.account_status ?? "?")}</div><div class="s">${paid.currency || ""} · ${fmt(paid.total_spend_lifetime ?? 0)} spent</div></div>
<div class="card"><div class="k">Pixel</div><div class="v">${esc(paid.pixel_health || "none")}</div><div class="s">${wt.meta_pixel_on_site === false ? "not on site" : wt.meta_pixel_on_site ? "on site" : "site unknown"}</div></div>
<div class="card"><div class="k">Custom audiences</div><div class="v">${paid.custom_audience_count ?? 0}</div><div class="s">${paid.custom_audience_healthy ?? 0} healthy</div></div>
</div>

<h2>Top wins</h2><ul>${bullets(wins, "win")}</ul>
<h2>Top issues</h2><ul>${bullets(issues, "iss")}</ul>

${xref.corroborated_finding ? `<h2>Pixel / tracking</h2><div class="callout"><b>🔴 Corroborated:</b> ${esc(xref.corroborated_finding)}</div>` : ""}

<h2>Website &amp; tracking ${raw.pre_audit_source ? `<span class="pill wn">from pre-audit</span>` : ""}</h2>
<table>
<tr><th>Signal</th><th>Status</th></tr>
<tr><td>Meta Pixel installed on site</td><td>${yn(wt.meta_pixel_on_site)}</td></tr>
<tr><td>Conversion events on site</td><td>${yn(wt.conversion_events_on_site)}</td></tr>
<tr><td>Google Analytics 4</td><td>${wt.ga4 ? `<span class="pill ok">yes</span> <code>${esc(wt.ga4_id || "")}</code>` : yn(wt.ga4)}</td></tr>
<tr><td>Google Tag Manager</td><td>${wt.google_tag ? `<span class="pill ok">yes</span> <code>${esc(wt.google_tag_id || "")}</code>` : yn(wt.google_tag)}</td></tr>
<tr><td>Mobile responsive</td><td>${yn(wt.mobile_responsive)}</td></tr>
<tr><td>Ad Library history</td><td>${raw.ad_library_history?.verdict ? `<span class="pill wn">${esc(raw.ad_library_history.verdict)}</span>` : "—"}</td></tr>
</table>

<h2>Engine readiness</h2>
<table>
<tr><th>Asset</th><th>Status</th></tr>
<tr><td>Facebook Page</td><td>${fb.skipped ? '<span class="pill bd">missing id</span>' : fb.has_page_token ? '<span class="pill ok">ready (page token)</span>' : '<span class="pill wn">limited (no page role)</span>'}</td></tr>
<tr><td>Instagram</td><td>${ig.source === "pre_audit_public_estimate" ? '<span class="pill bd">not linked (estimate only)</span>' : ig.skipped ? '<span class="pill wn">skipped</span>' : '<span class="pill ok">linked</span>'} ${ig.source === "pre_audit_public_estimate" ? `· ${igLine}` : ""}</td></tr>
<tr><td>Ad account</td><td>${paid.skipped ? '<span class="pill bd">none</span>' : paid.account_status === 1 ? '<span class="pill ok">active</span>' : '<span class="pill wn">status ' + (paid.account_status ?? "?") + "</span>"}</td></tr>
<tr><td>Pixel firing</td><td>${paid.pixel_health === "full" ? '<span class="pill ok">full</span>' : paid.pixel_health === "partial" ? '<span class="pill wn">partial</span>' : '<span class="pill bd">none</span>'}</td></tr>
</table>
${fb.engagement_available === false ? `<p style="font-size:12.5px;color:var(--mut);margin-top:8px">Per-post engagement unavailable — ${esc(fb.engagement_blocked_reason || "permission gap")}. Cadence &amp; format mix are live; consider Meta App Review for <code>pages_read_user_content</code>.</p>` : ""}

<h2>Recommended next steps</h2><ol class="steps">${bullets(steps, "step")}</ol>

<footer>Generated by smOS /audit on ${date}. Baseline scope: ${paid.skipped || (paid.total_spend_lifetime ?? 0) === 0 ? "organic + account-readiness (no paid spend history)" : "full organic + paid"}. Immutable baseline for future before/after comparisons.</footer>
</div></body></html>`;
}

function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: node scripts/audit_report_html.js <slug> [--out <path>]"); process.exit(1); }
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : resolve(ROOT, "clients", slug, "reports", `${new Date().toISOString().slice(0, 10)}_audit.html`);
  const html = render(slug);
  writeFileSync(out, html);
  console.log(out);
}

main();
