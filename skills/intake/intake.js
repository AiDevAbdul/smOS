#!/usr/bin/env node
/**
 * /intake companion script — materializes onboarding deliverables.
 *
 * The Q&A itself is conversational — Claude runs it. This script takes the
 * collected answers JSON and produces:
 *   - clients/<slug>/client_profile.json
 *   - clients/<slug>/CLAUDE.md
 *
 * It also handles:
 *   - hydration from prospects/<slug>/page_audit.json (if /pre-audit ran)
 *   - currency/timezone detection via Meta API (when ad_account_id is real)
 *   - schema validation (refuses to write if required fields missing)
 *
 * Usage:
 *   node skills/intake/intake.js init <slug>             # scaffold blank answers file
 *   node skills/intake/intake.js build <slug>            # build from clients/<slug>/intake_answers.json
 *   node skills/intake/intake.js build <slug> --answers /path/to/answers.json
 *
 * NOTE: Direct Graph calls; MCP hooks do not fire. The script defaults to
 * NOT calling Meta if ad_account_id is TBD_*.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { createGraph, isTbd } from "../../scripts/lib/meta-graph.js";
import { clientProfile as profileSchema } from "../../schemas/index.js";
import { checkZeroStartPrereqs } from "../../scripts/lib/guards.js";
import { heroHeader } from "../../scripts/lib/design_system.js";
import { docShell, writeDocHtmlAndPdf, docSection, escHtml } from "../../scripts/lib/client_doc.js";
import { getDeal } from "../../scripts/lib/crm-store.js";
import { loadCatalog, pickPackage, extractSnapshot } from "../proposal/proposal.js";
import * as P from "../../scripts/lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv();

const TODAY = () => new Date().toISOString().slice(0, 10);

const REQUIRED_TOP = ["name", "business", "audience", "voice", "accounts", "kpis", "approvals"];
const REQUIRED_BUSINESS = ["product_description", "business_model", "usp"];
const REQUIRED_ACCOUNTS = ["ad_account_id"];

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function argVal(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function readJsonIfExists(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function blankAnswers(slug) {
  return {
    slug,
    name: null,
    business: {
      product_description: null,
      price_low: null,
      price_high: null,
      business_model: null,
      usp: null,
      conversion_event: null,
    },
    audience: {
      age_low: null,
      age_high: null,
      gender: null,
      geo_targets: [],
      pain_points: [],
    },
    voice: {
      tone: null,
      restricted_words: [],
      cta_style: null,
    },
    accounts: {
      ad_account_id: null,
      pixel_id: null,
      // Canonical IDs (single source of truth read by audit/launch/before-after/etc).
      facebook_page_id: null,
      instagram_business_id: null,
      // Legacy aliases kept mirrored for any transitional reader.
      page_id: null,
      ig_account_id: null,
      bm_id: null,
      currency: null,
      timezone: null,
    },
    kpis: {
      target_cpa: null,
      target_roas: null,
      monthly_budget_low: null,
      monthly_budget_high: null,
    },
    history: {
      previous_spend: null,
      what_worked: null,
      what_failed: null,
    },
    competitors: [],
    assets: {
      formats_available: [],
      brand_guidelines_url: null,
      brand_colors: [],
    },
    approvals: {
      channel: "discord",
      daily_cap: 500,
      extra_rules: [],
    },
  };
}

function hydrateFromProspect(slug, answers) {
  // The pipeline writes page_audit.json under prospects/{slug}/data/; older runs
  // left it in the prospect root — check both so either layout resolves.
  const prospect = readJsonIfExists(P.prospectData(slug, "page_audit.json"))
    || readJsonIfExists(resolve(P.prospectRoot(slug), "page_audit.json"));
  if (!prospect) return { hydrated: false, fields: [] };

  const fields = [];
  if (!answers.name && prospect.business_name) { answers.name = prospect.business_name; fields.push("name"); }
  if (!answers.business.product_description && prospect.about) {
    answers.business.product_description = prospect.about;
    fields.push("business.product_description");
  }
  if (!answers.accounts.facebook_page_id && prospect.facebook_page_id) {
    answers.accounts.facebook_page_id = prospect.facebook_page_id;
    answers.accounts.page_id = prospect.facebook_page_id; // mirror legacy alias
    fields.push("accounts.facebook_page_id");
  }
  if (!answers.accounts.instagram_business_id && prospect.instagram_business_id) {
    answers.accounts.instagram_business_id = prospect.instagram_business_id;
    answers.accounts.ig_account_id = prospect.instagram_business_id;
    fields.push("accounts.instagram_business_id");
  }
  if ((!answers.competitors || !answers.competitors.length) && Array.isArray(prospect.competitors)) {
    answers.competitors = prospect.competitors.slice(0, 3);
    fields.push("competitors");
  }
  if ((!answers.audience.geo_targets || !answers.audience.geo_targets.length) && prospect.country) {
    answers.audience.geo_targets = [prospect.country];
    fields.push("audience.geo_targets");
  }
  return { hydrated: true, fields };
}

async function detectAccountMeta(adAccountId) {
  // Returns {currency, timezone_name} from Meta. Caller guards isTbd.
  const graph = createGraph();
  const id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const res = await graph.get(`/${id}`, { fields: "currency,timezone_name,account_status,name" });
  return res;
}

// A "zero-start" client arrives with no Meta presence yet — no real ad account,
// Page, or pixel. They onboard via Phase 0 (/brand-* + /setup-accounts) which fills
// these in, so intake must NOT hard-require account ids for them.
function isZeroStart(a) {
  const acc = a.accounts || {};
  const real = (v) => v && !isTbd(v);
  return !real(acc.ad_account_id) && !real(acc.facebook_page_id) && !real(acc.pixel_id);
}

function validateAnswers(a, { zeroStart = false } = {}) {
  const errors = [];
  for (const k of REQUIRED_TOP) {
    if (a[k] === undefined || a[k] === null) errors.push(`missing:${k}`);
  }
  if (a.business) {
    for (const k of REQUIRED_BUSINESS) {
      if (!a.business[k]) errors.push(`missing:business.${k}`);
    }
  }
  // Account ids are required for an established client, but a zero-start client
  // legitimately has none yet — Phase 0 creates them. Don't block onboarding.
  if (a.accounts && !zeroStart) {
    for (const k of REQUIRED_ACCOUNTS) {
      if (!a.accounts[k]) errors.push(`missing:accounts.${k}`);
    }
  }
  return errors;
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{([A-Z_0-9]+)\}\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined || v === null || v === "") return `_${k.toLowerCase()}_TBD_`;
    if (Array.isArray(v)) return v.length ? v.join(", ") : `_${k.toLowerCase()}_TBD_`;
    return String(v);
  });
}

function buildTemplateVars(profile) {
  const a = profile;
  const acct = a.accounts || {};
  const aud = a.audience || {};
  const kpis = a.kpis || {};
  const voice = a.voice || {};
  const hist = a.history || {};
  const comps = a.competitors || [];
  const assets = a.assets || {};
  const apr = a.approvals || {};
  const targetCpa = kpis.target_cpa;
  return {
    CLIENT_NAME: a.name,
    CLIENT_SLUG: a.slug,
    BUSINESS_MODEL: a.business?.business_model,
    INTAKE_DATE: TODAY(),
    AD_ACCOUNT_ID: acct.ad_account_id,
    PIXEL_ID: acct.pixel_id,
    PAGE_ID: acct.page_id,
    IG_ACCOUNT_ID: acct.ig_account_id,
    BM_ID: acct.bm_id,
    CURRENCY: acct.currency || "USD",
    TIMEZONE: acct.timezone || "UTC",
    PRODUCT_DESCRIPTION: a.business?.product_description,
    PRICE_LOW: a.business?.price_low,
    PRICE_HIGH: a.business?.price_high,
    USP: a.business?.usp,
    CONVERSION_EVENT: a.business?.conversion_event,
    AGE_LOW: aud.age_low,
    AGE_HIGH: aud.age_high,
    GENDER: aud.gender,
    GEO_TARGETS: aud.geo_targets,
    PAIN_1: aud.pain_points?.[0],
    PAIN_2: aud.pain_points?.[1],
    PAIN_3: aud.pain_points?.[2],
    TONE: voice.tone,
    RESTRICTED_WORDS: voice.restricted_words,
    CTA_STYLE: voice.cta_style,
    TARGET_CPA: targetCpa,
    PAUSE_CPA: targetCpa ? targetCpa * 3 : "3× target",
    MIN_SPEND_CPA: 50,
    TARGET_ROAS: kpis.target_roas,
    PAUSE_ROAS: 1.0,
    MIN_SPEND_ROAS: 100,
    SCALE_ROAS: 3.0,
    PAUSE_CTR: "0.5%",
    MIN_SPEND_CTR: 30,
    FREQ_CAP: 4.0,
    BUDGET_LOW: kpis.monthly_budget_low,
    BUDGET_HIGH: kpis.monthly_budget_high,
    DAILY_CAP: apr.daily_cap,
    LAUNCH_CAP: 200,
    APPROVAL_CHANNEL: apr.channel,
    CLIENT_APPROVAL_RULE_1: apr.extra_rules?.[0],
    CLIENT_APPROVAL_RULE_2: apr.extra_rules?.[1],
    PREVIOUS_SPEND: hist.previous_spend,
    WHAT_WORKED: hist.what_worked,
    WHAT_FAILED: hist.what_failed,
    COMPETITOR_1: comps[0],
    COMPETITOR_2: comps[1],
    COMPETITOR_3: comps[2],
    ASSET_FORMATS: assets.formats_available,
    BRAND_GUIDELINES_URL: assets.brand_guidelines_url,
    BRAND_COLORS: assets.brand_colors,
  };
}

function buildProfile(answers, accountMeta, { zeroStart = false } = {}) {
  const profile = {
    ...answers,
    // Zero-start clients aren't live yet — they're in Phase 0. Mark them "planning"
    // (matches the existing convention) with the assets that gate going live.
    status: zeroStart ? "planning" : "active",
    onboarded_at: TODAY(),
  };
  if (zeroStart) {
    const acc = answers.accounts || {};
    const real = (v) => v && !isTbd(v);
    profile.blockers_before_live = [
      ["facebook_page_id", acc.facebook_page_id],
      ["instagram_business_id", acc.instagram_business_id],
      ["ad_account_id", acc.ad_account_id],
      ["pixel_id", acc.pixel_id],
    ].filter(([, v]) => !real(v)).map(([k]) => k);
  }
  if (accountMeta) {
    profile.accounts = {
      ...profile.accounts,
      currency: accountMeta.currency || profile.accounts.currency || "USD",
      timezone: accountMeta.timezone_name || profile.accounts.timezone || "UTC",
      ad_account_status: accountMeta.account_status,
      ad_account_name: accountMeta.name,
    };
  }
  return profile;
}

function archiveProspect(slug) {
  const src = resolve(P.prospectRoot(slug), "pre_audit.html");
  if (!existsSync(src)) return null;
  const destDir = resolve(P.clientRoot(slug), "baseline");
  mkdirSync(destDir, { recursive: true });
  const dest = resolve(destDir, "pre_audit.html");
  copyFileSync(src, dest);
  return dest;
}

/* ─────────────────── Client-facing welcome / kickoff doc ─────────────────── */
/* The internal deliverables (client_profile.json + CLAUDE.md) stay as-is. This
   ADDS a polished onboarding document the client actually receives — the Phase-3
   sibling of the /pre-audit and /proposal, carrying their numbers forward so the
   engagement reads as one continuous story from first pitch to kickoff. */

function loadIntakeContext(slug) {
  // Agency identity + package pricing from the catalog; the CRM deal (package,
  // retainer) if the client came through the pipeline; the pre-audit snapshot for
  // continuity. All optional — the doc degrades gracefully when any is missing.
  let catalog = null, deal = null, snap = null, pkg = null;
  try { catalog = loadCatalog(); } catch { /* no catalog — use fallback identity */ }
  try { deal = getDeal(slug); } catch { /* no CRM */ }
  try {
    const syn = readJsonIfExists(P.prospectData(slug, "synthesis.json")) || readJsonIfExists(resolve(P.prospectRoot(slug), "synthesis.json"));
    snap = extractSnapshot(syn);
  } catch { /* no pre-audit */ }
  if (catalog && deal) { try { pkg = pickPackage(catalog, { retainer: deal.deal?.monthly_retainer || 0 }); } catch { /* ignore */ } }
  const agency = catalog?.agency || { name: process.env.SMOS_AGENCY_NAME || "Ducker Creative", email: process.env.SMOS_AGENCY_EMAIL || "hello@duckercreative.com", tagline: "Performance social, run like an operating system." };
  return { agency, deal, snap, pkg, terms: catalog?.terms || null };
}

function welcomeCss() {
  return `
.wl-recall{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;background:var(--ds-surface);
  border:1px solid var(--ds-line);border-left:4px solid var(--ds-green);border-radius:var(--ds-r);padding:22px 26px;box-shadow:var(--ds-shadow-sm);}
.wl-recall__num{font-size:44px;font-weight:800;color:var(--ds-green-ink);line-height:1;font-variant-numeric:tabular-nums;text-align:center;}
.wl-recall__num span{display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ds-faint);margin-top:6px;}
.wl-recall__txt{font-size:14.5px;line-height:1.6;color:var(--ds-ink-2);}
.wl-checklist{list-style:none;margin:0;padding:0;}
.wl-checklist li{position:relative;padding:11px 0 11px 30px;border-bottom:1px solid var(--ds-line);font-size:14px;}
.wl-checklist li:last-child{border-bottom:none;}
.wl-checklist li::before{content:"";position:absolute;left:2px;top:14px;width:16px;height:16px;border-radius:5px;border:2px solid var(--ds-line-strong);}
.wl-hww{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;}
.wl-hww__ic{width:38px;height:38px;border-radius:10px;background:var(--ds-green-tint);color:var(--ds-green-ink);display:grid;place-items:center;font-size:18px;font-weight:800;margin-bottom:12px;}
.wl-hww__t{font-size:14.5px;font-weight:700;margin-bottom:5px;}
.wl-hww__d{font-size:12.5px;color:var(--ds-muted);line-height:1.5;}
@media (max-width:640px){.wl-recall{grid-template-columns:1fr;text-align:center;}}
`;
}

export function buildWelcomeHtml(profile, ctx, { zeroStart = false, date = TODAY() } = {}) {
  const { agency, deal, snap, pkg, terms } = ctx;
  const company = profile.name || profile.slug;
  const cur = profile.accounts?.currency || pkg?.currency || "USD";
  const kpis = profile.kpis || {};
  const money = (n) => `${cur} ${Number(n).toLocaleString()}`;

  const pills = [`Status · ${profile.status}`];
  if (pkg) pills.push(`Plan · ${pkg.name}`);
  if (kpis.monthly_budget_low) pills.push(`Budget · ${money(kpis.monthly_budget_low)}+/mo`);
  if (kpis.target_roas) pills.push(`Target ROAS · ${kpis.target_roas}×`);

  const hero = heroHeader({
    title: `Welcome aboard, ${company}`,
    eyebrow: `Onboarding · ${agency.name}`,
    subtitleHtml: `Kickoff &nbsp;·&nbsp; ${escHtml(date)} &nbsp;·&nbsp; your engagement starts here`,
    headline: "Everything we agreed, where you're starting, and exactly what happens next.",
    pills,
  });

  // What we agreed (from the CRM deal / package), if present.
  const agreed = pkg ? docSection({
    eyebrow: "What we agreed", title: "Your plan",
    body: `<div class="ds-kpi-grid">
<div class="ds-kpi"><div class="ds-kpi__label">Package</div><div class="ds-kpi__value" style="font-size:22px">${escHtml(pkg.name)}</div></div>
<div class="ds-kpi"><div class="ds-kpi__label">Monthly retainer</div><div class="ds-kpi__value" style="font-size:22px">${escHtml(money(deal?.deal?.monthly_retainer > 0 ? deal.deal.monthly_retainer : pkg.monthly_retainer))}</div></div>
${terms ? `<div class="ds-kpi"><div class="ds-kpi__label">Initial term</div><div class="ds-kpi__value" style="font-size:22px">${terms.contract_length_months} months</div></div>` : ""}
</div>`,
  }) : "";

  // Where you're starting (continuity from the pre-audit), if present.
  const recall = snap && snap.score != null ? docSection({
    eyebrow: "Where you're starting", title: "Your baseline",
    body: `<div class="wl-recall"><div class="wl-recall__num">${snap.upside}<span>pts upside</span></div>
<div class="wl-recall__txt">Your pre-audit scored <strong>${escHtml(company)}</strong> <strong>${snap.score}/100</strong>. ${escHtml(snap.headline || "")} We'll turn that upside into measured, booked results.</div></div>`,
  }) : docSection({
    eyebrow: "Where you're starting", title: "Your baseline",
    body: `<div class="ds-card">${escHtml(profile.business?.product_description || `${company} — ${profile.business?.usp || "premium offer"}`)}</div>`,
  });

  // First 90 days — zero-start vs established.
  const steps = zeroStart
    ? [["Build the foundation", "Stand up your brand, Page, Instagram, ad account and pixel — the identity and tracking a paid engine needs."],
       ["Launch & measure", "First campaigns built and launched with every lead measured; organic cadence running."],
       ["Prove & scale", "Review cost-per-booked-job and scale what works into a next-quarter plan."]]
    : [["Baseline & measure", "Confirm tracking (Pixel/GA4) and pull a baseline of your accounts so every result is attributable."],
       ["Launch & capture", "First structured test live; retargeting built from your existing audience."],
       ["Prove & scale", "Scale winning creatives and review cost-per-booked-job for a next-quarter plan."]];
  const roadmap = docSection({
    eyebrow: "Your first 90 days", title: "From kickoff to scaling",
    body: `<div class="ds-roadmap">${["30", "60", "90"].map((d, i) => `<div class="ds-step"><div class="ds-step-num">${d}</div><div class="ds-step-body"><div class="ds-step-title">Day ${d} — ${escHtml(steps[i][0])}</div><div class="ds-step-desc">${escHtml(steps[i][1])}</div></div></div>`).join("")}</div>`,
  });

  // What we need from you.
  const needs = [];
  if (zeroStart) {
    const map = { facebook_page_id: "Confirm or create your Facebook Page", instagram_business_id: "Set up an Instagram Business account", ad_account_id: "Approve creation of your Meta ad account", pixel_id: "Approve the website tracking pixel" };
    for (const b of profile.blockers_before_live || []) if (map[b]) needs.push(map[b]);
  } else {
    needs.push("Grant us access to your ad account, Page and pixel");
  }
  if (!profile.business?.conversion_event) needs.push("Confirm your primary conversion event (lead / WhatsApp click / purchase)");
  if (!profile.assets?.brand_guidelines_url) needs.push("Share brand assets — logo, colors, existing video/photos");
  needs.push("A 30-minute kickoff call to align on the first campaign");
  const checklist = docSection({
    eyebrow: "What we need from you", title: "To get started",
    body: `<div class="ds-card"><ul class="wl-checklist">${needs.map((n) => `<li>${escHtml(n)}</li>`).join("")}</ul></div>`,
  });

  const hww = docSection({
    eyebrow: "How we work", title: "You stay in control",
    body: `<div class="wl-hww">
<div class="ds-card"><div class="wl-hww__ic">✓</div><div class="wl-hww__t">You approve before spend</div><div class="wl-hww__d">Every campaign is shown to you first and only goes live once you sign off.</div></div>
<div class="ds-card"><div class="wl-hww__ic">◷</div><div class="wl-hww__t">Every change is logged</div><div class="wl-hww__d">Each optimization is recorded with its reasoning, so you always know what changed and why.</div></div>
<div class="ds-card"><div class="wl-hww__ic">▤</div><div class="wl-hww__t">Reporting on a fixed cadence</div><div class="wl-hww__d">Clean HTML + PDF reports on schedule — the same standard as your pre-audit.</div></div>
</div>`,
  });

  const next = docSection({
    eyebrow: "Next step", title: "Let's begin",
    body: `<div class="ds-card" style="text-align:center">
<p class="ds-caption" style="max-width:480px;margin:0 auto 18px">Reply to book your kickoff call and we'll send the onboarding checklist. We can have your first campaigns built within a week.</p>
<a class="ds-btn" href="mailto:${escHtml(agency.email)}?subject=${encodeURIComponent(`Kickoff — ${company}`)}">Book the kickoff call →</a>
<div class="ds-caption" style="margin-top:14px">${escHtml(agency.name)} · ${escHtml(agency.email)}</div>
</div>`,
  });

  const body = [hero, agreed, recall, roadmap, checklist, hww, next].filter(Boolean).join("\n");
  return docShell({ title: `Welcome — ${company}`, extraCss: welcomeCss(), body, date });
}

async function main() {
  const [mode, slugArg, ...rest] = process.argv.slice(2);
  if (!mode) {
    console.error("Usage: node skills/intake/intake.js <init|build> <slug> [--answers PATH]");
    process.exit(1);
  }

  if (mode === "init") {
    const slug = slugify(slugArg || "");
    if (!slug) throw new Error("init requires a slug arg");
    const clientDir = resolve(P.clientRoot(slug));
    mkdirSync(clientDir, { recursive: true });
    const answersPath = resolve(clientDir, "intake_answers.json");
    if (existsSync(answersPath)) {
      console.error(`[intake] answers file already exists: ${answersPath}`);
      process.exit(2);
    }
    const answers = blankAnswers(slug);
    const { hydrated, fields } = hydrateFromProspect(slug, answers);
    writeFileSync(answersPath, JSON.stringify(answers, null, 2));
    console.log(JSON.stringify({ mode, slug, answers_file: answersPath, hydrated, hydrated_fields: fields }, null, 2));
    return;
  }

  if (mode !== "build") throw new Error(`Unknown mode: ${mode}. Use init or build.`);

  const slug = slugify(slugArg || "");
  if (!slug) throw new Error("build requires a slug arg");

  const answersPath = argVal(rest, "--answers") || resolve(P.clientRoot(slug), "intake_answers.json");
  if (!existsSync(answersPath)) throw new Error(`Answers file not found: ${answersPath}`);
  const answers = JSON.parse(readFileSync(answersPath, "utf8"));

  // Ensure slug consistency
  if (!answers.slug) answers.slug = slug;

  // Hydrate any still-missing fields from prospect data (idempotent on re-run)
  const hyd = hydrateFromProspect(slug, answers);

  const zeroStart = isZeroStart(answers);
  const errors = validateAnswers(answers, { zeroStart });
  if (errors.length) {
    console.error("[intake] validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(3);
  }

  // Detect account metadata if real ID provided
  let accountMeta = null;
  const adAcct = answers.accounts.ad_account_id;
  if (adAcct && !isTbd(adAcct)) {
    try {
      accountMeta = await detectAccountMeta(adAcct);
    } catch (e) {
      console.error(`[intake] WARN: account meta detection failed (${e.message}) — continuing with provided values`);
    }
  }

  // Normalize so canonical IDs (facebook_page_id/instagram_business_id) and their
  // legacy aliases are both populated from whatever the operator supplied.
  const profile = profileSchema.normalize(buildProfile(answers, accountMeta, { zeroStart }));

  const clientDir = resolve(P.clientRoot(slug));
  mkdirSync(clientDir, { recursive: true });

  const profilePath = P.clientFile(slug, "client_profile.json", { forWrite: true });
  if (existsSync(profilePath)) {
    const backupPath = resolve(clientDir, `client_profile.backup.${Date.now()}.json`);
    copyFileSync(profilePath, backupPath);
    console.error(`[intake] existing profile backed up to ${backupPath}`);
  }
  writeFileSync(profilePath, JSON.stringify(profile, null, 2));

  // Generate per-client CLAUDE.md
  const tplPath = resolve(ROOT, "templates", "client-claude.md");
  const tpl = readFileSync(tplPath, "utf8");
  const vars = buildTemplateVars(profile);
  const md = fillTemplate(tpl, vars);
  const claudePath = resolve(clientDir, "CLAUDE.md");
  writeFileSync(claudePath, md);

  // Archive prospect pre-audit if present
  const archivedPath = archiveProspect(slug);

  // Client-facing welcome / kickoff doc (Phase-3 sibling of pre-audit + proposal).
  // Internal deliverables above are untouched; this is what the client receives.
  let welcomePath = null, welcomePdf = false;
  try {
    const ctx = loadIntakeContext(slug);
    const html = buildWelcomeHtml(profile, ctx, { zeroStart, date: TODAY() });
    welcomePath = resolve(clientDir, "welcome.html");
    const r = writeDocHtmlAndPdf(welcomePath, html);
    welcomePdf = r.pdfOk;
  } catch (e) {
    console.error(`[intake] WARN: welcome doc generation failed (${e.message}) — profile + CLAUDE.md still written`);
  }

  // Surface skipped/null fields for user awareness
  const skipped = [];
  const walk = (obj, prefix = "") => {
    for (const [k, v] of Object.entries(obj || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null) skipped.push(key);
      else if (Array.isArray(v) && !v.length) skipped.push(key);
      else if (typeof v === "object" && !Array.isArray(v)) walk(v, key);
    }
  };
  walk(profile);

  const prereq = checkZeroStartPrereqs(profile, { need: ["page", "ig", "ad_account", "pixel"] });
  const next = zeroStart
    ? "ZERO-START client (no Meta presence yet). Run Phase 0 before /audit: /brand-strategy → /brand-name → /brand-visual → /brand-book → /brand-social → /setup-accounts → /setup-web. See CLAUDE.md → Zero-Start Onboarding."
    : "run /audit to pull baseline state of accounts";

  console.log(JSON.stringify({
    mode,
    slug,
    status: profile.status,
    zero_start: zeroStart,
    blockers_before_live: profile.blockers_before_live || [],
    profile_path: profilePath,
    claude_md_path: claudePath,
    welcome_doc: welcomePath ? { html: welcomePath, pdf: welcomePdf ? welcomePath.replace(/\.html$/, ".pdf") : "(PDF skipped — install playwright)" } : null,
    prospect_archived: archivedPath,
    prospect_hydrated_fields: hyd.fields,
    account_meta_detected: accountMeta ? { currency: accountMeta.currency, timezone: accountMeta.timezone_name } : null,
    skipped_fields: skipped,
    next,
  }, null, 2));
}

// Only run when invoked directly (so tests/other skills can import the builders).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[intake] FATAL:", e.message);
    process.exit(1);
  });
}
