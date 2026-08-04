#!/usr/bin/env node
/**
 * /proposal companion (Phase 5) — generates a branded client proposal (HTML+PDF)
 * from a service catalog + the prospect's /pre-audit findings, then advances the
 * CRM deal to `proposed` and links the artifact.
 *
 * Source of truth for pricing: config/services.json (catalog). The recommended
 * package is chosen by --package, else inferred from the deal's retainer, else
 * "growth". Per-deal retainer overrides the catalog price when set.
 *
 * Rendering (revised 2026-07-16): the proposal is an "opportunity-led" Phase-2
 * document, the sibling of the /pre-audit report. It is built as STRUCTURED HTML
 * on the shared smOS design system (canonical ds-hero + ds-* components + a small
 * proposal-specific stylesheet built on --ds-* tokens) — NOT generic markdown.
 * This fixes the old path's duplicate <h1>, literal `_italics_`, empty hero, and
 * unstyled body, and lets Phase 2 carry Phase 1's numbers so the two documents
 * tell one continuous story. A markdown twin is still written for portability.
 *
 * Usage:
 *   node skills/proposal/proposal.js <slug> [--package growth] [--no-crm]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { reportHead, heroHeader, reportFooter } from "../../scripts/lib/design_system.js";
import { getDeal, upsertDeal } from "../../scripts/lib/crm-store.js";
import { deal as dealSchema } from "../../schemas/index.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

/* ─────────────────────────────── catalog ─────────────────────────────── */

export function loadCatalog() {
  const p = resolve(ROOT, "config", "services.json");
  if (!existsSync(p)) throw new Error("config/services.json not found — scaffold the service catalog first.");
  const cat = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(cat.packages) || !cat.packages.length) throw new Error("services.json has no packages");
  return cat;
}

/** Pick the recommended package: explicit > closest-to-retainer > default 'growth'/first. */
export function pickPackage(catalog, { packageId = null, retainer = 0 } = {}) {
  const pkgs = catalog.packages;
  if (packageId) {
    const hit = pkgs.find((p) => p.id === packageId);
    if (!hit) throw new Error(`No package "${packageId}". Available: ${pkgs.map((p) => p.id).join(", ")}`);
    return hit;
  }
  if (retainer > 0) {
    return pkgs.reduce((best, p) =>
      Math.abs(p.monthly_retainer - retainer) < Math.abs(best.monthly_retainer - retainer) ? p : best, pkgs[0]);
  }
  return pkgs.find((p) => p.id === "growth") || pkgs[0];
}

/**
 * Two-tier "start here → step up" story. Greenfield prospects should see a lower
 * entry tier they can start on before scaling to the recommended package, so we
 * pair the recommended tier (featured) with the tier BELOW it when one exists,
 * else the tier above. Falls back to the single recommended tier.
 * Returns [{pkg, featured}] in display order.
 */
export function pickTierPair(catalog, pkg) {
  const pkgs = catalog.packages;
  const idx = pkgs.findIndex((p) => p.id === pkg.id);
  const lower = idx > 0 ? pkgs[idx - 1] : null;
  const higher = idx >= 0 && idx < pkgs.length - 1 ? pkgs[idx + 1] : null;
  if (lower) return [{ pkg: lower, featured: false }, { pkg, featured: true }];
  if (higher) return [{ pkg, featured: true }, { pkg: higher, featured: false }];
  return [{ pkg, featured: true }];
}

/* ─────────────────────────────── findings ────────────────────────────── */

function loadFindings(slug) {
  // Pull the prospect's situation from /pre-audit output if it ran. The pipeline
  // writes the derived JSONs under prospects/{slug}/data/; older runs left them in
  // the prospect root — check both so either layout resolves.
  for (const f of ["synthesis.json", "page_audit.json"]) {
    for (const p of [P.prospectData(slug, f), resolve(P.prospectRoot(slug), f)]) {
      if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* ignore */ } }
    }
  }
  return null;
}

/** Derive the pre-audit "snapshot" that lets Phase 2 quote Phase 1 verbatim. */
export function extractSnapshot(findings) {
  if (!findings) return null;
  const score = Number.isFinite(findings.score) ? findings.score : null;
  const upside = score != null ? 100 - score : null;
  const blob = [findings.headline, ...(findings.wins || []), ...(findings.gaps || [])]
    .filter(Boolean).map((x) => (typeof x === "string" ? x : (x.text || x.title || ""))).join(" · ");
  // Followers: "4,370 likes" / "4370 followers"
  const fMatch = blob.match(/([\d][\d,]{2,})\s*(?:page\s*)?(?:likes|followers)/i);
  const followers = fMatch ? fMatch[1] : null;
  // Outspend: explicit ratio field, else "8×" / "8x" in the copy
  let outspend = Number.isFinite(findings.outspend_ratio) ? findings.outspend_ratio : null;
  if (outspend == null) { const m = blob.match(/(\d+(?:\.\d+)?)\s*[×xX]\b/); if (m) outspend = Number(m[1]); }
  return { score, upside, followers, outspend, headline: findings.headline || "" };
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (cur, n) => `${cur} ${Number(n).toLocaleString()}`;

/** Normalize a findings win/gap entry (string or object) to text. */
const itemText = (x) => (typeof x === "string" ? x : (x?.text || x?.title || x?.problem || String(x)));

/** Prefer tiered wins/gaps when the pre-audit provides them, else the flat list. */
function winGapItems(findings, which) {
  if (!findings) return [];
  const tiers = findings[`${which}_tiers`];
  if (tiers && (tiers.quick || tiers.strategic)) {
    return [...(tiers.quick || []), ...(tiers.strategic || [])].map(itemText);
  }
  return (findings[which] || []).map(itemText);
}

/* ─────────────────────────── markdown twin ───────────────────────────── */
/* Kept for portability (email paste, plaintext). Emphasis uses *asterisks* so a
   generic markdown renderer produces <em>/<strong> (the old `_x_` rendered
   literally). Not the primary deliverable — the HTML below is. */
/** Render one-time add-on deliverables (website builds, video/graphics packages, …)
 *  as a markdown list, clearly separated from the recurring retainer. */
function addonsMarkdown(addons) {
  if (!addons || !addons.length) return "";
  const cur = addons[0].currency || "USD";
  const total = addons.reduce((s, a) => s + (a.amount || 0), 0);
  let md = `## One-time deliverables (separate from the monthly retainer)\n\n`;
  md += addons.map((a) => `- **${a.name}** — ${money(a.currency || cur, a.amount)}${a.description ? ` — ${a.description}` : ""}`).join("\n");
  md += `\n\n**Total one-time investment:** ${money(cur, total)} (billed once, separately from the recurring retainer)\n\n`;
  return md;
}

export function buildProposalMarkdown({ company, catalog, pkg, retainer, findings, addons, currency }) {
  const a = catalog.agency, t = catalog.terms, cur = currency || pkg.currency;
  const price = retainer > 0 ? retainer : pkg.monthly_retainer;
  const snap = extractSnapshot(findings);
  const list = (arr) => arr.map((x) => `- ${x}`).join("\n");
  let md = `# Growth Proposal — ${company}\n\nPrepared for **${company}** · by **${a.name}** (${a.email})\n\n*${a.tagline}*\n\n---\n\n`;
  if (snap && snap.score != null) {
    md += `> Your pre-audit scored ${company} **${snap.score}/100** — **${snap.upside} points of upside**. This proposal turns that gap into booked jobs.\n\n`;
  }
  md += `## The opportunity\n\n`;
  const wins = winGapItems(findings, "wins"), gaps = winGapItems(findings, "gaps");
  if (wins.length) md += `**Strong foundation to build on**\n${list(wins)}\n\n`;
  if (gaps.length) md += `**Where the upside is**\n${list(gaps)}\n\n`;
  if (!wins.length && !gaps.length) md += `Based on our review of ${company}'s social presence, there's clear room to improve paid performance and bring organic and paid under one system.\n\n`;
  md += `## Recommended package — ${pkg.name}\n\n*${pkg.best_for}*\n\n**${money(cur, price)}/month** · one-time setup ${money(cur, pkg.setup_fee)}\n\n**Included**\n${list(pkg.includes)}\n\n`;
  md += addonsMarkdown(addons);
  md += `## How we work\n\nYou approve every campaign before spend. Every optimization is logged with its reasoning, and you get HTML + PDF reporting on a fixed cadence — the same standard as the pre-audit this proposal sits beside.\n\n`;
  md += `## Terms\n\n- **Term:** ${t.contract_length_months}-month initial commitment\n- **Ad spend:** ${t.ad_spend}\n- **Payment:** ${t.payment}\n- **Cancellation:** ${t.cancellation}\n\n`;
  md += `## Next step\n\nApprove and we'll send the agreement (e-sign) and onboarding. Your accounts can be set up and first campaigns built within a week.\n`;
  return md;
}

/* ─────────────────────────── HTML (primary) ──────────────────────────── */

/** Proposal-specific components, all built on --ds-* tokens (no raw hex, no
 *  forked palette) — the same discipline the pre-audit renderer follows. */
function proposalCss() {
  return `
/* ── Continuity recall band (ties Phase 2 back to the Phase-1 audit) ── */
.prop-recall{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;
  background:var(--ds-surface);border:1px solid var(--ds-line);border-left:4px solid var(--ds-green);
  border-radius:var(--ds-r);padding:22px 26px;box-shadow:var(--ds-shadow-sm);margin:8px 0 4px;}
.prop-recall__num{font-size:44px;font-weight:800;letter-spacing:-.02em;color:var(--ds-green-ink);
  line-height:1;font-variant-numeric:tabular-nums;text-align:center;}
.prop-recall__num span{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;color:var(--ds-faint);margin-top:6px;}
.prop-recall__txt{font-size:14.5px;line-height:1.6;color:var(--ds-ink-2);}
.prop-recall__txt strong{color:var(--ds-ink);}
/* ── Two-column wins / gaps ── */
.prop-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.prop-col{border-top:3px solid var(--ds-line);}
.prop-col--win{border-top-color:var(--ds-green);}
.prop-col--gap{border-top-color:var(--ds-amber);}
.prop-col__type{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px;}
.prop-col--win .prop-col__type{color:var(--ds-green-ink);}
.prop-col--gap .prop-col__type{color:var(--ds-amber-ink);}
.prop-col ul{list-style:none;margin:0;padding:0;}
.prop-col li{position:relative;padding:9px 0 9px 24px;font-size:13.5px;line-height:1.5;border-bottom:1px solid var(--ds-line);}
.prop-col li:last-child{border-bottom:none;}
.prop-col--win li::before{content:"✓";position:absolute;left:0;color:var(--ds-green);font-weight:800;}
.prop-col--gap li::before{content:"→";position:absolute;left:0;color:var(--ds-amber);font-weight:800;}
/* ── Pricing tiers ── */
.prop-tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:stretch;}
.prop-tier{position:relative;display:flex;flex-direction:column;background:var(--ds-surface);
  border:1px solid var(--ds-line);border-radius:var(--ds-r-lg);padding:26px 26px 28px;box-shadow:var(--ds-shadow-sm);}
.prop-tier--featured{border:1.5px solid var(--ds-green);box-shadow:var(--ds-shadow);}
.prop-tier--featured::after{content:"Recommended";position:absolute;top:-11px;left:26px;
  background:var(--ds-green);color:#fff;font-size:10px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;padding:4px 12px;border-radius:var(--ds-r-pill);}
.prop-tier__name{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ds-muted);}
.prop-tier__price{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:10px 0 2px;}
.prop-tier__price small{font-size:14px;font-weight:600;color:var(--ds-muted);}
.prop-tier__setup{font-size:12.5px;color:var(--ds-muted);margin-bottom:6px;}
.prop-tier__for{font-size:12.5px;font-style:italic;color:var(--ds-ink-2);margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--ds-line);}
.prop-tier ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;flex:1;}
.prop-tier li{position:relative;padding-left:24px;font-size:13px;line-height:1.45;}
.prop-tier li::before{content:"✓";position:absolute;left:0;color:var(--ds-green);font-weight:800;}
.prop-tier__note{margin-top:16px;font-size:11.5px;color:var(--ds-faint);}
/* ── ROI / value band (dark) ── */
.prop-roi{background:var(--ds-grad-ink);color:#fff;border-radius:var(--ds-r-lg);padding:30px 32px;box-shadow:var(--ds-shadow);}
.prop-roi__h{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ds-green);margin-bottom:16px;}
.prop-roi__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:24px;}
.prop-roi__n{font-size:26px;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--ds-green);}
.prop-roi__l{font-size:12.5px;color:rgba(255,255,255,.72);margin-top:4px;line-height:1.45;}
.prop-roi__foot{margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.14);font-size:11.5px;color:rgba(255,255,255,.6);line-height:1.5;}
/* ── How we work ── */
.prop-hww{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;}
.prop-hww__ic{width:38px;height:38px;border-radius:10px;background:var(--ds-green-tint);color:var(--ds-green-ink);
  display:grid;place-items:center;font-size:18px;font-weight:800;margin-bottom:12px;}
.prop-hww__t{font-size:14.5px;font-weight:700;margin-bottom:5px;}
.prop-hww__d{font-size:12.5px;color:var(--ds-muted);line-height:1.5;}
/* ── Terms grid ── */
.prop-terms{display:grid;grid-template-columns:1fr 1fr;gap:0 40px;}
.prop-term{padding:14px 0;border-bottom:1px solid var(--ds-line);}
.prop-term__k{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ds-muted);margin-bottom:4px;}
.prop-term__v{font-size:13.5px;}
/* ── Accept / close ── */
.prop-accept{text-align:center;}
.prop-accept .ds-btn{font-size:15px;padding:15px 40px;}
.prop-sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:34px;text-align:left;}
.prop-sign__line{border-top:1.5px solid var(--ds-ink);padding-top:8px;margin-top:40px;font-size:12px;color:var(--ds-muted);}
.prop-valid{margin-top:20px;font-size:11.5px;color:var(--ds-faint);}
@media (max-width:640px){.prop-recall,.prop-cols,.prop-terms,.prop-sign{grid-template-columns:1fr;}}
`;
}

function heroSection({ company, agency, date, snap }) {
  const pills = [];
  if (snap) {
    if (snap.score != null) pills.push(`Audit score · ${snap.score}/100`);
    if (snap.upside != null) pills.push(`Upside · ${snap.upside} pts`);
    if (snap.followers) pills.push(`FB audience · ${snap.followers}`);
    if (snap.outspend) pills.push(`Competitor outspend · ${snap.outspend}×`);
  }
  const headline = snap && snap.upside != null
    ? `Your pre-audit surfaced ${snap.upside} points of untapped upside. Here's the plan, the price, and the timeline to capture it — ${String(agency.tagline).replace(/\.$/, "").toLowerCase()}.`
    : agency.tagline;
  const subtitleHtml = `Prepared for <strong>${esc(company)}</strong> &nbsp;·&nbsp; by ${esc(agency.name)} &nbsp;·&nbsp; ${esc(date)}`;
  return heroHeader({
    title: `A growth engine for ${company}`,
    eyebrow: `Growth Proposal · ${agency.name}`,
    subtitleHtml,
    headline,
    pills,
  });
}

function section(id, eyebrow, title, sub, bodyHtml) {
  return `<section class="ds-section" id="${id}">
${eyebrow ? `<div class="ds-eyebrow">${esc(eyebrow)}</div>` : ""}
${title ? `<h2>${esc(title)}</h2>` : ""}
${sub ? `<p class="ds-caption" style="margin:-2px 0 16px;max-width:640px">${esc(sub)}</p>` : ""}
${bodyHtml}
</section>`;
}

function recallBand(company, snap) {
  if (!snap || snap.score == null) return "";
  const hl = snap.headline ? esc(snap.headline) : "";
  return `<div class="prop-recall">
<div class="prop-recall__num">${snap.upside}<span>pts upside</span></div>
<div class="prop-recall__txt">Your growth pre-audit scored <strong>${esc(company)}</strong> <strong>${snap.score}/100</strong> — not a failing grade, but a measure of how much is switched off. ${hl} This proposal turns that gap into booked jobs.</div>
</div>`;
}

function winsGaps(findings) {
  const wins = winGapItems(findings, "wins"), gaps = winGapItems(findings, "gaps");
  if (!wins.length && !gaps.length) {
    return `<div class="ds-card">Based on our review, there's clear room to improve paid performance and bring organic and paid under one system.</div>`;
  }
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  return `<div class="prop-cols">
<div class="ds-card prop-col prop-col--win"><div class="prop-col__type">Strong foundation to build on</div><ul>${li(wins)}</ul></div>
<div class="ds-card prop-col prop-col--gap"><div class="prop-col__type">Where the upside is</div><ul>${li(gaps)}</ul></div>
</div>`;
}

function pricing(catalog, pkg, retainer, currency) {
  const pair = pickTierPair(catalog, pkg);
  const cards = pair.map(({ pkg: p, featured }) => {
    const cur = currency || p.currency;
    const price = featured && retainer > 0 ? retainer : p.monthly_retainer;
    const items = (p.includes || []).map((x) => `<li>${esc(x)}</li>`).join("");
    return `<div class="prop-tier${featured ? " prop-tier--featured" : ""}">
<div class="prop-tier__name">${esc(p.name)}</div>
<div class="prop-tier__price">${esc(money(cur, price))}<small>/mo</small></div>
<div class="prop-tier__setup">One-time setup ${esc(money(cur, p.setup_fee))}</div>
<div class="prop-tier__for">${esc(p.best_for)}</div>
<ul>${items}</ul>
<div class="prop-tier__note">Ad spend billed separately, direct to Meta.</div>
</div>`;
  }).join("");
  return `<div class="prop-tiers">${cards}</div>`;
}

/** Render one-time add-on deliverables (website builds, video/graphics packages, …)
 *  as their own HTML block, clearly separated from the recurring retainer above. */
function addonsBlock(addons) {
  if (!addons || !addons.length) return "";
  const cur = addons[0].currency || "USD";
  const total = addons.reduce((s, a) => s + (a.amount || 0), 0);
  const rows = addons.map((a) => `<div class="prop-term"><div class="prop-term__k">${esc(a.name)}</div><div class="prop-term__v">${esc(money(a.currency || cur, a.amount))}${a.description ? ` — ${esc(a.description)}` : ""}</div></div>`).join("");
  return `<div class="ds-card"><div class="prop-terms">${rows}</div></div>
<div class="prop-tier__note" style="margin-top:12px">Total one-time investment: <strong>${esc(money(cur, total))}</strong> — billed once, up front, separately from the monthly retainer above.</div>`;
}

function roiBand(findings) {
  const opps = (findings?.opportunities || []).slice(0, 3);
  if (!opps.length) return "";
  const items = opps.map((o) => {
    const title = typeof o === "string" ? o : (o.title || o.problem || "");
    const tag = typeof o === "object" && o.impact ? `${o.impact} impact` : "priority move";
    return `<div><div class="prop-roi__n">→</div><div class="prop-roi__l"><strong style="color:#fff">${esc(title)}</strong><br>${esc(tag)}</div></div>`;
  }).join("");
  return `<div class="prop-roi">
<div class="prop-roi__h">What the retainer is working toward</div>
<div class="prop-roi__grid">${items}</div>
<div class="prop-roi__foot">Priorities carried directly from your pre-audit. Real targets — cost per lead, cost per booked job — are locked at onboarding against your actual budget, ticket price and close rate.</div>
</div>`;
}

function howWeWork() {
  const cards = [
    ["✓", "You approve before spend", "Every campaign is built and shown to you first. It only goes live once you sign off — no surprise spend, ever."],
    ["◷", "Every change is logged", "Each optimization is recorded with the reasoning behind it, so you always know what changed and why."],
    ["▤", "Reporting on a fixed cadence", "Clean HTML + PDF reports on schedule — the same standard as the pre-audit this proposal sits beside."],
  ].map(([ic, t, d]) => `<div class="ds-card"><div class="prop-hww__ic">${ic}</div><div class="prop-hww__t">${esc(t)}</div><div class="prop-hww__d">${esc(d)}</div></div>`).join("");
  return `<div class="prop-hww">${cards}</div>`;
}

function roadmap(findings) {
  const recs = findings?.recommendations || [];
  const fallback = [
    ["Measure & verify", "Install tracking (Pixel + GA4) with a lead/WhatsApp conversion event; verify and link social profiles; audit existing assets for ad use."],
    ["Launch & capture", "First structured lead-gen test live with every lead measured; organic cadence running; retargeting audience building from the existing following."],
    ["Prove & scale", "Winning creatives scaled, cost-per-booked-job reviewed, and a next-quarter growth plan built on real numbers."],
  ];
  const days = ["30", "60", "90"];
  const steps = days.map((d, i) => {
    const rec = recs[i];
    const title = rec ? esc(rec.problem ? `Fix: ${rec.problem}` : (rec.title || fallback[i][0])) : fallback[i][0];
    const desc = rec ? esc(rec.action || rec.outcome || fallback[i][1]) : fallback[i][1];
    return `<div class="ds-step"><div class="ds-step-num">${d}</div><div class="ds-step-body"><div class="ds-step-title">Day ${d} — ${title}</div><div class="ds-step-desc">${desc}</div></div></div>`;
  }).join("");
  return `<div class="ds-roadmap">${steps}</div>`;
}

function terms(t) {
  const rows = [
    ["Initial term", `${t.contract_length_months}-month initial commitment`],
    ["Ad spend", t.ad_spend],
    ["Payment", t.payment],
    ["Cancellation", t.cancellation],
  ].map(([k, v]) => `<div class="prop-term"><div class="prop-term__k">${esc(k)}</div><div class="prop-term__v">${esc(v)}</div></div>`).join("");
  return `<div class="ds-card"><div class="prop-terms">${rows}</div></div>`;
}

function acceptBlock({ company, agency, date }) {
  const subject = encodeURIComponent(`Approved — ${company} Growth Proposal`);
  const body = encodeURIComponent(`Hi ${agency.name}, we'd like to proceed. Please send the agreement and onboarding.`);
  return `<div class="ds-card prop-accept">
<h3 style="font-size:22px">Ready to switch the channel on?</h3>
<p class="ds-caption" style="max-width:480px;margin:8px auto 22px">Approve below and we'll send the agreement to e-sign plus your onboarding checklist. Your accounts can be set up and the first campaigns built within a week.</p>
<a class="ds-btn" href="mailto:${esc(agency.email)}?subject=${subject}&body=${body}">Approve &amp; Start Onboarding →</a>
<div class="prop-sign">
<div><div class="prop-sign__line">Signature — ${esc(company)}</div></div>
<div><div class="prop-sign__line">Date</div></div>
</div>
<div class="prop-valid">Proposal valid for 30 days from ${esc(date)} · ${esc(agency.name)} · ${esc(agency.email)}</div>
</div>`;
}

export function buildProposalHtml({ company, catalog, pkg, retainer, findings, date, addons, currency }) {
  const agency = catalog.agency, t = catalog.terms;
  const snap = extractSnapshot(findings);
  const roi = roiBand(findings);
  const addonsHtml = addonsBlock(addons);
  const body = [
    heroSection({ company, agency, date, snap }),
    recallBand(company, snap),
    section("opportunity", "The opportunity", "What we're building on — and what we're fixing",
      "Straight from your pre-audit: we start from genuine strengths and close the gaps costing you measurable growth.", winsGaps(findings)),
    section("package", "Recommended package", "Where you start, and where we take it",
      "Start on the entry tier to stand up measurement and prove the channel, then step up once the numbers are in.", pricing(catalog, pkg, retainer, currency)),
    addonsHtml ? section("addons", "One-time deliverables", "Beyond the monthly retainer",
      "Priced separately from the recurring management retainer — due once, up front, not month to month.", addonsHtml) : "",
    roi ? `<section class="ds-section">${roi}</section>` : "",
    section("how", "How we work", "You stay in control the whole way", "", howWeWork()),
    section("timeline", "Your first 90 days", "From signed to scaling", "", roadmap(findings)),
    section("terms", "Terms", "The agreement, in plain terms", "", terms(t)),
    section("next", "Next step", "", "", acceptBlock({ company, agency, date })),
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
${reportHead({ title: `Growth Proposal — ${company}`, extraHead: `<style>${proposalCss()}</style>` })}
<body><div class="ds-wrap">
${body}
${reportFooter(date)}
</div></body></html>`;
}

/** Write the HTML and render a PDF via render_pdf.py (mirrors md_to_html's PDF step). */
function writeProposalPdf(htmlPath) {
  const pdfPath = htmlPath.replace(/\.html$/, "") + ".pdf";
  let pdfOk = false;
  try {
    const r = spawnSync("python3", [resolve(ROOT, "scripts", "render_pdf.py"), htmlPath, "--output", pdfPath], { encoding: "utf8" });
    pdfOk = r.status === 0;
    if (!pdfOk) console.error(`[proposal] PDF render failed for ${basename(htmlPath)}: ${(r.stderr || "").split("\n")[0]}`);
  } catch (e) {
    console.error(`[proposal] PDF render skipped: ${e.message}`);
  }
  return { pdfPath, pdfOk };
}

/* ─────────────────────────────── main ────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const slug = args[0];
  if (!slug) { console.error("Usage: proposal.js <slug> [--package growth] [--no-crm]"); process.exit(1); }
  const pkgIdx = args.indexOf("--package");
  const packageId = pkgIdx >= 0 ? args[pkgIdx + 1] : null;

  const catalog = loadCatalog();
  const dealRec = getDeal(slug);
  const company = dealRec?.company_name || slug;
  const retainer = dealRec?.deal?.monthly_retainer || 0;
  const pkg = pickPackage(catalog, { packageId, retainer });
  const findings = loadFindings(slug);
  const addons = dealRec?.deal?.addons || [];
  // The deal's currency wins over the catalog package's — a client billed in EUR
  // must not see a USD retainer next to EUR one-time line items.
  const currency = dealRec?.deal?.currency || pkg.currency;
  const date = new Date().toISOString().slice(0, 10);

  const outDir = resolve(ROOT, "proposals", slug);
  mkdirSync(outDir, { recursive: true });

  // Markdown twin (portable) + structured HTML (primary deliverable) + PDF.
  const md = buildProposalMarkdown({ company, catalog, pkg, retainer, findings, addons, currency });
  const mdPath = resolve(outDir, "proposal.md");
  writeFileSync(mdPath, md);

  const html = buildProposalHtml({ company, catalog, pkg, retainer, findings, date, addons, currency });
  const htmlPath = resolve(outDir, "proposal.html");
  writeFileSync(htmlPath, html);
  const { pdfPath, pdfOk } = writeProposalPdf(htmlPath);

  let crm = { skipped: true };
  if (!args.includes("--no-crm")) {
    const linkPath = pdfOk ? `proposals/${slug}/proposal.pdf` : `proposals/${slug}/proposal.html`;
    const current = dealRec?.stage || "lead";
    const stage = dealSchema.isValidTransition(current, "proposed") || current === "proposed" ? "proposed" : current;
    try {
      const saved = await upsertDeal(slug, {
        company_name: company,
        stage,
        links: { proposal: linkPath },
        deal: { monthly_retainer: retainer > 0 ? retainer : pkg.monthly_retainer, currency },
        activities: [...(dealRec?.activities || []), { at: new Date().toISOString(), type: "proposal", note: `proposed ${pkg.name} (${currency} ${retainer > 0 ? retainer : pkg.monthly_retainer}/mo)` }],
      });
      crm = { stage: saved.stage, proposal_link: saved.links.proposal, stage_changed: stage !== current };
    } catch (e) { crm = { error: e.message }; }
  }

  console.log(JSON.stringify({
    slug, company, package: pkg.id,
    monthly: `${currency} ${retainer > 0 ? retainer : pkg.monthly_retainer}`,
    html: htmlPath, pdf: pdfOk ? pdfPath : "(PDF skipped — install playwright)",
    used_pre_audit: !!findings, crm,
    next: "Send to the prospect. On signature: /contract, then /intake + /billing.",
  }, null, 2));
}

// Only run when invoked directly (so tests can import the helpers).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("[proposal] FATAL:", e.message); process.exit(1); });
}
