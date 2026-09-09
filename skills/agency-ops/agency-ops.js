#!/usr/bin/env node
/**
 * /agency-ops companion (Group D5) — the agency's own operating dashboard.
 *
 * Sibling to /portal, but pointed inward: /portal shows ONE client their results;
 * this shows the operator the whole book — MRR, NRR, churn, win rate, pipeline
 * velocity, AR aging, per-client margin and delivery capacity.
 *
 * Two things it does that the rest of the reporting layer doesn't:
 *
 *  1. It RECORDS AN MRR SNAPSHOT on every run (`agency/mrr_snapshots.json`).
 *     NRR is not derivable from current state — retainer changes aren't versioned
 *     on the deal, so reconstructing past MRR would read every historical amount
 *     as today's. Snapshots make NRR real from the second run onward, and until
 *     then it reports null with that explanation rather than a fake number.
 *
 *  2. It is NOT published to a guessable public path. This page carries the whole
 *     agency's revenue, margin and receivables; `public/reports/<slug>/` is
 *     readable by anyone who guesses a slug. Output goes to `agency/` (gitignored)
 *     and `--share` mints a signed, expiring token via scripts/lib/share-token.js.
 *
 * Usage:
 *   node skills/agency-ops/agency-ops.js                    # render HTML + PDF
 *   node skills/agency-ops/agency-ops.js --since 2026-07-01 # window the rate metrics
 *   node skills/agency-ops/agency-ops.js --month 2026-09    # margin/capacity period
 *   node skills/agency-ops/agency-ops.js --json             # data only, no render
 *   node skills/agency-ops/agency-ops.js --share [--ttl 14] # mint a share token
 *   node skills/agency-ops/agency-ops.js --no-snapshot      # don't record MRR today
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { reportHead, heroHeader, reportFooter } from "../../scripts/lib/design_system.js";
import { writeDocHtmlAndPdf, escHtml } from "../../scripts/lib/client_doc.js";
import { loadPipeline } from "../../scripts/lib/crm-store.js";
import { listInvoices } from "../../scripts/lib/billing-store.js";
import { agencyDashboard, recordSnapshot } from "../../scripts/lib/agency-metrics.js";
import { clientProfitability, rosterLoad, portfolioMargin, normalizeRoster } from "../../scripts/lib/agency-economics.js";
import { clientHealth } from "../../scripts/lib/client-health.js";
import { mintShareToken, shareConfigured } from "../../scripts/lib/share-token.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const AGENCY_DIR = resolve(ROOT, "agency");
const SNAPSHOTS = resolve(AGENCY_DIR, "mrr_snapshots.json");

function readJson(p, fallback) {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

function loadRoster() {
  const p = resolve(ROOT, "config", "roster.json");
  return normalizeRoster(readJson(p, null));
}

const money = (n, c) => `${c} ${Number(n).toLocaleString()}`;
/** Render a per-currency map as one line, or an em-dash when empty. */
const perCurrency = (by) => {
  const keys = Object.keys(by || {});
  if (!keys.length) return "—";
  return keys.map((c) => money(by[c], c)).join(" · ");
};

/**
 * A metric that could not be computed renders its REASON, not a blank or a zero.
 * This is the whole point of the D5 honesty contract being visible in the UI.
 */
function metricCell(value, reason, format = (v) => v) {
  if (value === null || value === undefined) {
    return `<span class="ao-null">Not reported</span>${reason ? `<div class="ao-why">${escHtml(reason)}</div>` : ""}`;
  }
  return format(value);
}

function css() {
  return `
.ao-null{font-family:var(--ds-font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ds-muted);}
.ao-why{font-size:12px;color:var(--ds-muted);margin-top:4px;max-width:62ch;line-height:1.45;}
.ao-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;}
.ao-num{font-variant-numeric:tabular-nums;white-space:nowrap;}
td.ao-num,th.ao-num{text-align:right;}
.ao-neg{color:var(--ds-bad);font-weight:700;}
.ao-sec{margin-top:34px;}
`;
}

function buildHtml(dash, margins, portfolio, healths, roster, opts) {
  const mrrLine = perCurrency(dash.mrr.by_currency);
  const hero = heroHeader({
    title: "Agency Operations",
    eyebrow: "smOS · Internal",
    subtitleHtml: `As of <strong>${escHtml(dash.as_of.slice(0, 10))}</strong>${opts.since ? ` &nbsp;·&nbsp; window from ${escHtml(opts.since)}` : ""} &nbsp;·&nbsp; period ${escHtml(opts.month)}`,
    pills: [
      `MRR · ${mrrLine}`,
      `Clients · ${dash.mrr.clients}`,
      `Open deals · ${dash.pipeline.open_deals}`,
      `Overdue invoices · ${dash.ar.overdue_count}`,
    ],
  });

  const kpis = `<div class="ds-kpi-grid">
<div class="ds-kpi"><div class="ds-kpi__label">Active MRR</div><div class="ds-kpi__value">${escHtml(mrrLine)}</div></div>
<div class="ds-kpi"><div class="ds-kpi__label">Active clients</div><div class="ds-kpi__value">${dash.mrr.clients}</div></div>
<div class="ds-kpi"><div class="ds-kpi__label">Weighted pipeline (annual)</div><div class="ds-kpi__value">${escHtml(perCurrency(dash.pipeline.weighted_annual_by_currency))}</div></div>
<div class="ds-kpi"><div class="ds-kpi__label">Overdue receivables</div><div class="ds-kpi__value">${escHtml(perCurrency(Object.fromEntries(Object.entries(dash.ar.by_currency || {}).map(([c, v]) => [c, v.overdue_total]))))}</div></div>
</div>`;

  const unmeasuredNote = dash.mrr.clients_without_retainer
    ? `<div class="ds-callout ds-callout--warn"><strong>${dash.mrr.clients_without_retainer} client(s) carry no retainer on the deal</strong> (${dash.mrr.clients_without_retainer_slugs.map(escHtml).join(", ")}), so they are missing from MRR entirely. Record terms with <code>/crm set &lt;slug&gt; retainer=&lt;amount&gt;</code>.</div>`
    : "";

  // Retention: NRR per currency, with the reason shown when it can't be computed.
  const nrrRows = Object.entries(dash.nrr).map(([c, n]) => `<div class="ds-sheet__row">
<div class="ds-sheet__metric">Net revenue retention${c === "_none" ? "" : ` · ${escHtml(c)}`}</div>
<div class="ds-sheet__read">${metricCell(n.nrr_pct, n.reason, (v) => `${v}% <span class="ds-badge ${v >= 100 ? "ds-badge--good" : "ds-badge--warn"}">${v >= 100 ? "expanding" : "contracting"}</span>`)}</div>
</div>`).join("");

  const retention = `<section class="ao-sec"><h2>Retention</h2><div class="ds-sheet">
${nrrRows}
<div class="ds-sheet__row"><div class="ds-sheet__metric">Logo churn</div><div class="ds-sheet__read">${metricCell(dash.churn.rate_pct, dash.churn.reason, (v) => `${v}%`)}</div></div>
<div class="ds-sheet__row"><div class="ds-sheet__metric">Win rate</div><div class="ds-sheet__read">${metricCell(dash.win_rate.rate_pct, dash.win_rate.reason, (v) => `${v}% <span class="ds-badge ds-badge--info">${dash.win_rate.won}W / ${dash.win_rate.lost}L</span>`)}</div></div>
<div class="ds-sheet__row"><div class="ds-sheet__metric">Pipeline velocity (lead → won)</div><div class="ds-sheet__read">${metricCell(dash.velocity.median_days, dash.velocity.reason, (v) => `${v} days median <span class="ds-badge ds-badge--neutral">n=${dash.velocity.sample}, range ${dash.velocity.range_days[0]}–${dash.velocity.range_days[1]}d</span>`)}</div></div>
</div></section>`;

  // Per-client margin. Unmeasured rows say why instead of showing a confident 0.
  const marginRows = margins.map((m) => `<tr>
<td>${escHtml(m.company || m.slug)}</td>
<td>${escHtml(m.owner || "—")}</td>
<td class="ao-num">${m.revenue === null ? "—" : escHtml(money(m.revenue, m.currency))}</td>
<td class="ao-num">${m.cost === null ? "—" : escHtml(money(m.cost, m.currency))}</td>
<td class="ao-num">${m.margin === null ? '<span class="ao-null">n/r</span>' : `<span class="${m.margin < 0 ? "ao-neg" : ""}">${escHtml(money(m.margin, m.currency))}${m.margin_pct !== null ? ` (${m.margin_pct}%)` : ""}</span>`}</td>
<td>${m.hours === null ? "—" : `${m.hours}h <span class="ds-badge ${m.hours_basis === "logged" ? "ds-badge--good" : "ds-badge--warn"}">${escHtml(m.hours_basis)}</span>`}</td>
</tr>${m.unmeasured ? `<tr><td colspan="6"><div class="ao-why">${m.reasons.map(escHtml).join("<br>")}</div></td></tr>` : ""}`).join("");

  const marginSection = `<section class="ao-sec"><h2>Per-client margin · ${escHtml(opts.month)}</h2>
<div class="ds-table-wrap"><table>
<thead><tr><th>Client</th><th>Owner</th><th class="ao-num">Revenue</th><th class="ao-num">Cost to serve</th><th class="ao-num">Margin</th><th>Hours</th></tr></thead>
<tbody>${marginRows || '<tr><td colspan="6">No won clients.</td></tr>'}</tbody>
</table></div>
${portfolio.loss_making.length ? `<div class="ds-callout ds-callout--bad"><strong>Loss-making:</strong> ${portfolio.loss_making.map(escHtml).join(", ")} — the retainer does not cover the cost to serve.</div>` : ""}
${portfolio.unmeasured_count ? `<div class="ds-callout ds-callout--warn"><strong>${portfolio.unmeasured_count} client(s) could not be measured</strong>, so the portfolio total below covers only ${portfolio.measured}. Unknown cost is reported as unknown, never as zero.</div>` : ""}
<div class="ds-sheet">${Object.entries(portfolio.by_currency).map(([c, v]) => `<div class="ds-sheet__row"><div class="ds-sheet__metric">Portfolio margin · ${escHtml(c)}</div><div class="ds-sheet__read">${escHtml(money(v.margin, c))} of ${escHtml(money(v.revenue, c))} <span class="ds-badge ${v.margin_pct >= 50 ? "ds-badge--good" : v.margin_pct >= 0 ? "ds-badge--warn" : "ds-badge--bad"}">${v.margin_pct}%</span></div></div>`).join("") || '<div class="ds-sheet__row"><div class="ds-sheet__metric">Portfolio margin</div><div class="ds-sheet__read"><span class="ao-null">Not reported</span><div class="ao-why">No client had both revenue and cost recorded in a single currency.</div></div></div>'}</div>
</section>`;

  // Health + renewals.
  const healthRows = healths.map((h) => `<tr>
<td>${escHtml(h.company || h.slug)}</td>
<td>${h.score === null ? '<span class="ao-null">n/r</span>' : `${h.score} <span class="ds-badge ${h.band === "healthy" ? "ds-badge--good" : h.band === "watch" ? "ds-badge--info" : h.band === "at_risk" ? "ds-badge--warn" : "ds-badge--bad"}">${escHtml(h.band)}${h.band_provisional ? " · provisional" : ""}</span>`}</td>
<td class="ao-num">${h.confidence}%</td>
<td>${escHtml(h.renewal.date || "unknown")} <span class="ds-badge ${h.renewal.status === "overdue" ? "ds-badge--bad" : h.renewal.status === "due_soon" ? "ds-badge--warn" : "ds-badge--neutral"}">${escHtml(h.renewal.status)}</span></td>
<td class="ao-num">${h.tenure_months === null ? "—" : `${h.tenure_months} mo`}</td>
</tr>`).join("");

  const healthSection = `<section class="ao-sec"><h2>Client health &amp; renewals</h2>
<div class="ds-table-wrap"><table>
<thead><tr><th>Client</th><th>Health</th><th class="ao-num">Confidence</th><th>Renewal</th><th class="ao-num">Tenure</th></tr></thead>
<tbody>${healthRows || '<tr><td colspan="5">No won clients.</td></tr>'}</tbody>
</table></div>
<div class="ds-callout"><strong>Confidence</strong> is the share of the scoring weight that had data. A missing signal is excluded from the denominator, never scored zero — a client with no artifacts scores <em>Not reported</em>, not 100. Below 50% the band is marked <em>provisional</em>: a hint, not a finding.</div>
</section>`;

  // AR aging.
  const arRows = Object.entries(dash.ar.buckets).map(([bucket, v]) => `<div class="ds-sheet__row"><div class="ds-sheet__metric">${escHtml(bucket)}</div><div class="ds-sheet__read">${v.count} invoice(s)</div></div>`).join("");
  const arSection = `<section class="ao-sec"><h2>Receivables</h2>
<div class="ao-grid">
<div class="ds-card"><h3>Outstanding by currency</h3><div class="ds-sheet">${Object.entries(dash.ar.by_currency || {}).map(([c, v]) => `<div class="ds-sheet__row"><div class="ds-sheet__metric">${escHtml(c)}</div><div class="ds-sheet__read">${escHtml(money(v.outstanding, c))} total · <strong>${escHtml(money(v.overdue_total, c))}</strong> overdue</div></div>`).join("") || '<div class="ds-sheet__row"><div class="ds-sheet__metric">Nothing outstanding</div><div class="ds-sheet__read">—</div></div>'}</div></div>
<div class="ds-card"><h3>Aging buckets</h3><div class="ds-sheet">${arRows}</div></div>
</div>
${dash.ar.mixed_currency ? '<div class="ds-callout ds-callout--warn">Receivables span multiple currencies, so there is deliberately no single blended total here — those amounts cannot be added.</div>' : ""}
${dash.ar.worst.length ? `<div class="ds-table-wrap"><table><thead><tr><th>Invoice</th><th>Client</th><th class="ao-num">Amount</th><th class="ao-num">Days overdue</th><th>Reminders</th></tr></thead><tbody>${dash.ar.worst.map((i) => `<tr><td>${escHtml(i.id)}</td><td>${escHtml(i.company || i.slug)}</td><td class="ao-num">${escHtml(money(i.total, i.currency))}</td><td class="ao-num">${i.days_overdue > 0 ? `<span class="ao-neg">${i.days_overdue}</span>` : i.days_overdue}</td><td>${i.reminders_sent}</td></tr>`).join("")}</tbody></table></div>` : ""}
</section>`;

  // Capacity.
  const capRows = (roster.members || []).map((m) => `<tr>
<td>${escHtml(m.name || m.id)}</td>
<td>${escHtml(m.role || "—")}</td>
<td class="ao-num">${m.clients}${m.max_clients ? ` / ${m.max_clients}` : ""} ${m.over_client_limit ? '<span class="ds-badge ds-badge--bad">over</span>' : ""}</td>
<td class="ao-num">${m.hours}${m.max_hours_per_month ? ` / ${m.max_hours_per_month}h` : "h"} ${m.over_hours_limit ? '<span class="ds-badge ds-badge--bad">over</span>' : ""}</td>
<td>${m.clients_with_unknown_hours.length ? `<span class="ds-badge ds-badge--warn">floor</span> ${m.clients_with_unknown_hours.map(escHtml).join(", ")}` : "—"}</td>
</tr>`).join("");

  const capSection = `<section class="ao-sec"><h2>Delivery capacity · ${escHtml(opts.month)}</h2>
<div class="ds-table-wrap"><table>
<thead><tr><th>Member</th><th>Role</th><th class="ao-num">Clients</th><th class="ao-num">Hours</th><th>Unknown hours</th></tr></thead>
<tbody>${capRows || '<tr><td colspan="5">No roster configured — see config/roster.json.</td></tr>'}</tbody>
</table></div>
${roster.unassigned?.length ? `<div class="ds-callout ds-callout--warn"><strong>${roster.unassigned.length} client(s) have no roster owner</strong> (${roster.unassigned.map((u) => escHtml(u.slug)).join(", ")}) — their load is counted nowhere. Assign with <code>/crm set &lt;slug&gt; owner=&lt;member-id&gt;</code>.</div>` : ""}
</section>`;

  const verdict = `<div class="ds-verdict"><p>The book carries <em>${escHtml(mrrLine)}</em> across ${dash.mrr.clients} active client${dash.mrr.clients === 1 ? "" : "s"}${portfolio.loss_making.length ? `, of which <em>${portfolio.loss_making.length}</em> currently cost more to serve than they pay` : ""}. ${dash.ar.overdue_count ? `<em>${dash.ar.overdue_count}</em> invoice${dash.ar.overdue_count === 1 ? " is" : "s are"} past due.` : "No receivables are past due."} Metrics this dataset cannot support are marked <em>Not reported</em> with the reason, rather than shown as zero.</p></div>`;

  return `<!doctype html><html lang="en">
${reportHead({ title: "Agency Operations — smOS", extraHead: `<style>${css()}</style>` })}
<body>
${hero}
<main class="ds-wrap ds-wrap--wide">
${verdict}
${kpis}
${unmeasuredNote}
${retention}
${marginSection}
${healthSection}
${arSection}
${capSection}
${reportFooter(dash.as_of.slice(0, 10))}
</main>
</body></html>`;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : undefined; };

  const now = new Date().toISOString();
  const month = String(flag("month") || now.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) { console.error(`--month must be YYYY-MM, got "${month}".`); process.exit(1); }
  const since = flag("since") && flag("since") !== true ? String(flag("since")) : null;
  if (since && !/^\d{4}-\d{2}-\d{2}/.test(since)) { console.error(`--since must be YYYY-MM-DD, got "${since}".`); process.exit(1); }

  const deals = loadPipeline();
  const won = deals.filter((d) => d.stage === "won");
  const rosterCfg = loadRoster();

  // Snapshot BEFORE building the dashboard, so today's MRR is in the history the
  // NRR calculation reads — otherwise the first run of the day always reports one
  // fewer snapshot than exists on disk.
  let snapshots = readJson(SNAPSHOTS, []);
  if (!flag("no-snapshot")) {
    snapshots = recordSnapshot(snapshots, deals, now);
    mkdirSync(AGENCY_DIR, { recursive: true });
    writeFileSync(SNAPSHOTS, JSON.stringify(snapshots, null, 2));
  }

  const arByClient = Object.fromEntries(won.map((d) => [d.slug, listInvoices(d.slug)]));
  const capacity = rosterLoad(deals, rosterCfg, month);
  const dash = agencyDashboard({ deals, arByClient, snapshots, rosterLoadOut: capacity, since, now });
  const margins = won.map((d) => clientProfitability(d, rosterCfg, month));
  const portfolio = portfolioMargin(margins);
  const healths = won.map((d) => clientHealth({ deal: d, invoices: arByClient[d.slug] || [], today: now.slice(0, 10) }));

  let share = null;
  if (flag("share")) {
    const ttl = Number(flag("ttl")) || 14;
    if (!shareConfigured()) {
      share = { minted: false, reason: "SMOS_SHARE_SECRET is not set (or is a placeholder / under 16 chars) — refusing to mint an unsigned share token. See .env.example." };
    } else {
      try {
        const t = mintShareToken({ resource: "agency-ops", ttlDays: ttl });
        share = { minted: true, token: t.token, expires_at: t.expires_at, note: "The serving layer MUST call verifyShareToken() and refuse on failure. A token in front of a still-world-readable file protects nothing." };
      } catch (e) { share = { minted: false, reason: e.message }; }
    }
  }

  if (flag("json")) {
    console.log(JSON.stringify({ dashboard: dash, margins, portfolio, healths, share }, null, 2));
    return;
  }

  mkdirSync(AGENCY_DIR, { recursive: true });
  const htmlPath = resolve(AGENCY_DIR, "agency-ops.html");
  const html = buildHtml(dash, margins, portfolio, healths, capacity, { month, since });
  const { pdfPath, pdfOk } = writeDocHtmlAndPdf(htmlPath, html);

  console.log(JSON.stringify({
    html: htmlPath,
    pdf: pdfOk ? pdfPath : "(PDF skipped — install playwright)",
    mrr: dash.mrr.by_currency,
    clients: dash.mrr.clients,
    snapshots: snapshots.length,
    nrr_available: Object.values(dash.nrr).some((n) => n.nrr_pct !== null),
    loss_making: portfolio.loss_making,
    unmeasured_margin_clients: portfolio.unmeasured_count,
    overdue_invoices: dash.ar.overdue_count,
    over_capacity: capacity.capacity.members_over_limit,
    unassigned_clients: capacity.unassigned.map((u) => u.slug),
    share,
    note: "Written to agency/ (gitignored), NOT public/reports/ — this page carries whole-book revenue, margin and receivables.",
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("[agency-ops] FATAL:", e.message); process.exit(1); }
}

export { buildHtml };
