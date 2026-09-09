#!/usr/bin/env node
/**
 * /smos-status companion — a read-only, unified status check for one slug.
 *
 * Answers "where is this client/prospect in the smOS pipeline, what's done,
 * what's remaining, what's next" by inspecting on-disk files only — no Meta
 * API calls, no writes. Covers three layers in one report:
 *   1. Agency/CRM  — crm/pipeline.json deal stage
 *   2. Phase 0     — zero-start brand/account/web gates (brand_profile.json,
 *                    client_profile.json accounts + setup checklists)
 *   3. Main pipeline — audit → research → audience-map → strategy-brief →
 *                    creative → launch → analyze → report, + organic
 *                    (content-plan → publish) and agency docs (proposal/
 *                    contract/billing)
 *
 * Usage: node skills/smos-status/status.js <slug>
 * Output: one JSON object on stdout (never throws on missing files/dirs).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  repoRoot, clientRoot, clientFile, clientDeliverableDir, clientReportsRoot,
  billingLedger,
} from "../../scripts/lib/paths.js";

const ROOT = repoRoot();

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function fileExists(slug, name) {
  return existsSync(clientFile(slug, name));
}

function deliverableExists(slug, artifact) {
  const dir = clientDeliverableDir(slug, artifact);
  return existsSync(dir) && readdirSync(dir).length > 0;
}

function anyRootFile(slug, names) {
  const dir = clientRoot(slug);
  return names.some((n) => existsSync(resolve(dir, n)));
}

function reportCount(slug, type) {
  const root = clientReportsRoot(slug);
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const date of readdirSync(root)) {
    const dir = resolve(root, date);
    try {
      if (readdirSync(dir).some((f) => f.startsWith(type))) n++;
    } catch { /* not a dir */ }
  }
  return n;
}

// Placeholder detection mirrors schemas/client_profile.js validateAccounts().
const PLACEHOLDERS = new Set(["TBD", "TODO", "", null, undefined]);
function isSet(v) { return !PLACEHOLDERS.has(v); }

function step(id, label, done, detail) {
  return { id, label, status: done ? "done" : "missing", detail: detail || null };
}

function partialStep(id, label, status, detail) {
  return { id, label, status, detail: detail || null };
}

function loadDeal(slug) {
  const pipelinePath = resolve(ROOT, "crm", "pipeline.json");
  const deals = readJson(pipelinePath) || [];
  return deals.find((d) => d.slug === slug) || null;
}

function checkPhase0(slug, profile, brand) {
  const accounts = profile?.accounts || {};
  const setupChecklist = accounts.setup_checklist || profile?.setup_checklist || {};

  const positioning = brand?.strategy?.positioning_approved_at;
  const nameApproved = brand?.verbal?.name_approved_at;
  const logoApproved = brand?.visual?.logo_approved_at;

  const accountsReady = ["ad_account_id", "facebook_page_id", "instagram_business_id", "pixel_id"]
    .every((k) => isSet(accounts[k]));
  const webReady = isSet(profile?.website_url) || isSet(accounts.website_url);

  return [
    step("intake", "/intake — client profile created", !!profile, profile ? null : "clients/{slug}/profile.json missing"),
    step("brand-strategy", "/brand-strategy — positioning gate", isSet(positioning), isSet(positioning) ? `approved ${positioning}` : "GATE 1 not stamped (human approval required)"),
    step("brand-name", "/brand-name — name + trademark gate", isSet(nameApproved), isSet(nameApproved) ? `approved ${nameApproved}` : "GATE 2 not stamped — requires /brand-strategy first"),
    step("brand-visual", "/brand-visual — logo gate", isSet(logoApproved), isSet(logoApproved) ? `approved ${logoApproved}` : "GATE 3 not stamped — requires /brand-name first"),
    step("brand-book", "/brand-book — guidelines doc", anyRootFile(slug, ["brand_book.html", "brand_book.pdf", "brand_book.md"])),
    step("brand-social", "/brand-social — social surface", fileExists(slug, "social.json") || anyRootFile(slug, ["social.json"])),
    step("setup-accounts", "/setup-accounts — ad account/pixel live", accountsReady, accountsReady ? null : "one or more accounts.* ids still TBD/missing"),
    step("setup-web", "/setup-web — domain + landing", webReady),
    step("capi-setup", "/capi-setup — pixel/CAPI verified", fileExists(slug, "capi_report.json")),
  ];
}

function checkMainPipeline(slug) {
  const strategyBrief = readJson(clientFile(slug, "strategy_brief.json"));
  const launchPlan = readJson(clientFile(slug, "launch_plan.json"));

  return [
    step("audit", "/audit — baseline snapshot", fileExists(slug, "baseline_snapshot.json")),
    step("audit-creative", "/audit-creative — creative score", anyRootFile(slug, ["creative_audit_summary.json", "creative_assets.json"])),
    step("research", "/research — competitor intel", fileExists(slug, "competitor_intel.json")),
    step("audience-map", "/audience-map — targeting plan", fileExists(slug, "audience_map.json")),
    strategyBrief
      ? (strategyBrief.approved_at
          ? partialStep("strategy-brief", "/strategy-brief — approved brief", "done", `approved ${strategyBrief.approved_at}`)
          : partialStep("strategy-brief", "/strategy-brief — approved brief", "blocked", "written but NOT yet approved (human gate) — /launch is blocked until approved"))
      : step("strategy-brief", "/strategy-brief — approved brief", false),
    step("creative", "/creative — ad copy package", fileExists(slug, "ad_copy.json")),
    step("launch", "/launch — campaigns built (PAUSED)", !!launchPlan, launchPlan ? null : "no launch_plan.json yet"),
    step("analyze", "/analyze — live performance pulled", fileExists(slug, "performance_analysis.json")),
    step("report", "/report or /before-after — a client report shipped", reportCount(slug, "report") + reportCount(slug, "before-after") + reportCount(slug, "audit") > 0),
  ];
}

function checkOrganic(slug) {
  return [
    step("content-plan", "/content-plan — calendar built", fileExists(slug, "content_plan.json") && fileExists(slug, "content_calendar.json")),
    step("publish", "/publish — items published", anyRootFile(slug, ["publish_log.json"]) || fileExists(slug, "publish_log.json")),
  ];
}

function checkAgency(slug, deal) {
  const hasLedger = existsSync(billingLedger(slug));
  return [
    step("crm", "CRM deal on file", !!deal, deal ? `stage: ${deal.stage}` : "no deal record — run /crm add"),
    step("proposal", "/proposal — sent", !!deal?.links?.proposal),
    step(
      "contract",
      "/contract — signed",
      !!deal?.links?.contract,
      deal?.links?.contract
        ? (deal?.won_at ? `won ${deal.won_at}` : null)
        : (deal?.won_at ? `deal won ${deal.won_at} — no /contract artifact on file (bypassed formal flow?)` : null)
    ),
    step("billing", "/billing — invoicing active", hasLedger),
  ];
}

function nextAction(sections) {
  for (const s of sections) {
    const gap = s.steps.find((st) => st.status !== "done");
    if (gap) return { section: s.label, step: gap.label, status: gap.status, detail: gap.detail };
  }
  return null;
}

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: node skills/smos-status/status.js <slug>");
    process.exit(2);
  }

  const profile = readJson(clientFile(slug, "profile.json"));
  const brand = readJson(clientFile(slug, "brand_profile.json"));
  const deal = loadDeal(slug);
  const isClient = !!profile;
  const isZeroStart = isClient && !["ad_account_id", "facebook_page_id"].every((k) => isSet(profile?.accounts?.[k]));

  const sections = [];
  sections.push({ key: "agency", label: "Agency / CRM", steps: checkAgency(slug, deal) });
  if (isClient) {
    sections.push({ key: "phase0", label: "Phase 0 — Zero-Start Onboarding", steps: checkPhase0(slug, profile, brand) });
    sections.push({ key: "pipeline", label: "Main Pipeline", steps: checkMainPipeline(slug) });
    sections.push({ key: "organic", label: "Organic / Content", steps: checkOrganic(slug) });
  }

  const out = {
    slug,
    is_client: isClient,
    is_zero_start: isZeroStart,
    crm_stage: deal?.stage || null,
    sections,
    next_action: nextAction(sections),
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
