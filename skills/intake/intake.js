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
  const prospectPath = resolve(ROOT, "prospects", slug, "page_audit.json");
  const prospect = readJsonIfExists(prospectPath);
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

function validateAnswers(a) {
  const errors = [];
  for (const k of REQUIRED_TOP) {
    if (a[k] === undefined || a[k] === null) errors.push(`missing:${k}`);
  }
  if (a.business) {
    for (const k of REQUIRED_BUSINESS) {
      if (!a.business[k]) errors.push(`missing:business.${k}`);
    }
  }
  if (a.accounts) {
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

function buildProfile(answers, accountMeta) {
  const profile = {
    ...answers,
    status: "active",
    onboarded_at: TODAY(),
  };
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
  const src = resolve(ROOT, "prospects", slug, "pre_audit.html");
  if (!existsSync(src)) return null;
  const destDir = resolve(ROOT, "clients", slug, "baseline");
  mkdirSync(destDir, { recursive: true });
  const dest = resolve(destDir, "pre_audit.html");
  copyFileSync(src, dest);
  return dest;
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
    const clientDir = resolve(ROOT, "clients", slug);
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

  const answersPath = argVal(rest, "--answers") || resolve(ROOT, "clients", slug, "intake_answers.json");
  if (!existsSync(answersPath)) throw new Error(`Answers file not found: ${answersPath}`);
  const answers = JSON.parse(readFileSync(answersPath, "utf8"));

  // Ensure slug consistency
  if (!answers.slug) answers.slug = slug;

  // Hydrate any still-missing fields from prospect data (idempotent on re-run)
  const hyd = hydrateFromProspect(slug, answers);

  const errors = validateAnswers(answers);
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
  const profile = profileSchema.normalize(buildProfile(answers, accountMeta));

  const clientDir = resolve(ROOT, "clients", slug);
  mkdirSync(clientDir, { recursive: true });

  const profilePath = resolve(clientDir, "client_profile.json");
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

  console.log(JSON.stringify({
    mode,
    slug,
    profile_path: profilePath,
    claude_md_path: claudePath,
    prospect_archived: archivedPath,
    prospect_hydrated_fields: hyd.fields,
    account_meta_detected: accountMeta ? { currency: accountMeta.currency, timezone: accountMeta.timezone_name } : null,
    skipped_fields: skipped,
    next: "run /audit to pull baseline state of accounts",
  }, null, 2));
}

main().catch((e) => {
  console.error("[intake] FATAL:", e.message);
  process.exit(1);
});
