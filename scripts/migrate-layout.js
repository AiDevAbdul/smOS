#!/usr/bin/env node
/**
 * migrate-layout.js — move a client/prospect from the legacy FLAT layout to the
 * canonical four-bucket layout defined in scripts/lib/paths.js.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. Idempotent: skips when the
 * source is gone or the destination already exists. Never deletes — it renames
 * (moves); tracked originals remain recoverable from git. Files it can't confidently
 * classify are listed under "NEEDS MANUAL REVIEW" rather than guessed at.
 *
 * Usage:
 *   node scripts/migrate-layout.js <slug> [--prospect] [--apply]
 *   node scripts/migrate-layout.js --all [--apply]      # every client + prospect
 */

import { readdirSync, existsSync, statSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import * as P from "./lib/paths.js";

const ROOT = P.repoRoot();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PROSPECT = args.includes("--prospect");
const ALL = args.includes("--all");
const slugArg = args.find((a) => !a.startsWith("--"));

const moves = [];
const review = [];

function plan(from, to) {
  if (!existsSync(from)) return;
  if (existsSync(to)) return;          // idempotent — already migrated
  moves.push({ from, to });
}

/** Parse a flat client report filename → { date, type, ext } or null. */
function parseReport(name) {
  // 2026-06-19_weekly.md | 2026-06-19_weekly_raw.json | 2026-06-25_audit.pdf
  let m = name.match(/^(\d{4}-\d{2}-\d{2})_(.+?)(_raw)?\.([a-z0-9]+)$/i);
  if (m) return { date: m[1], type: m[2], ext: m[3] ? "raw.json" : m[4] };
  // competitor_report_2026-06-30T04-25-17.html → date from ISO prefix, type 'competitor'
  m = name.match(/^competitor_report_(\d{4}-\d{2}-\d{2})T[\d-]+\.([a-z0-9]+)$/i);
  if (m) return { date: m[1], type: "competitor", ext: m[2] };
  return null;
}

function migrateClient(slug) {
  const root = P.clientRoot(slug);
  if (!existsSync(root)) { console.error(`no such client: ${slug}`); return; }

  // 1. profile.json
  plan(P.legacy.clientProfile(slug), P.clientProfile(slug));

  // 2. data/ engine JSON
  for (const f of P.DATA_FILES) plan(P.legacy.clientFlat(slug, f), P.clientData(slug, f));

  // 3. deliverables/<artifact>/<artifact>.{md,html,pdf}
  for (const [base, artifact] of Object.entries(P.DELIVERABLE_ARTIFACTS)) {
    for (const ext of P.DELIVERABLE_EXTS) {
      plan(P.legacy.clientFlat(slug, `${base}.${ext}`), P.clientDeliverable(slug, artifact, ext));
    }
  }
  // audit is a one-off deliverable in the flat root (audit_report.md)
  plan(P.legacy.clientFlat(slug, "audit_report.md"), P.clientDeliverable(slug, "audit", "md"));

  // 4. state/
  for (const f of P.STATE_FILES) plan(P.legacy.clientFlat(slug, f), P.clientState(slug, f));

  // 5. reports/<date>/<type>.<ext>  (from the flat reports/ folder)
  const repDir = P.legacy.clientReportsDir(slug);
  if (existsSync(repDir)) {
    for (const name of readdirSync(repDir)) {
      const full = resolve(repDir, name);
      if (statSync(full).isDirectory()) continue;
      if (name === "sent.json") { plan(full, P.clientState(slug, "sent.json")); continue; }
      const r = parseReport(name);
      if (r) { plan(full, P.clientReport(slug, r.date, r.type, r.ext)); continue; }
      if (name === "content_sops.html") { plan(full, P.clientDeliverable(slug, "content-sops", "html")); continue; }
      review.push(full);
    }
  }
}

function migrateProspect(slug) {
  const root = P.prospectRoot(slug);
  if (!existsSync(root)) { console.error(`no such prospect: ${slug}`); return; }
  for (const f of ["page_audit.json", "competitor_summary.json", "synthesis.json"]) {
    plan(P.legacy.prospectFlat(slug, f), P.prospectData(slug, f));
  }
  for (const ext of ["html", "pdf"]) {
    plan(P.legacy.prospectFlat(slug, `pre_audit.${ext}`), P.prospectDeliverable(slug, "pre-audit", ext));
  }
  const repDir = P.legacy.prospectReportsDir(slug);
  if (existsSync(repDir)) {
    for (const name of readdirSync(repDir)) {
      const full = resolve(repDir, name);
      if (statSync(full).isFile()) plan(full, P.prospectRaw(slug, name));
    }
  }
}

// ── select targets ──
if (ALL) {
  for (const s of (existsSync(resolve(ROOT, "clients")) ? readdirSync(resolve(ROOT, "clients")) : [])) {
    if (!s.startsWith("__") && !s.startsWith("_") && !s.includes("fixture")) migrateClient(s);
  }
  for (const s of (existsSync(resolve(ROOT, "prospects")) ? readdirSync(resolve(ROOT, "prospects")) : [])) {
    migrateProspect(s);
  }
} else if (slugArg) {
  PROSPECT ? migrateProspect(slugArg) : migrateClient(slugArg);
} else {
  console.error("usage: migrate-layout.js <slug> [--prospect] [--apply]  |  --all [--apply]");
  process.exit(2);
}

// ── report / apply ──
console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — ${moves.length} move(s)${review.length ? `, ${review.length} need manual review` : ""}\n`);
const rel = (p) => p.replace(ROOT + "/", "");
for (const { from, to } of moves) {
  console.log(`  ${rel(from)}\n    → ${rel(to)}`);
  if (APPLY) { mkdirSync(dirname(to), { recursive: true }); renameSync(from, to); }
}
if (review.length) {
  console.log(`\nNEEDS MANUAL REVIEW (left in place):`);
  for (const f of review) console.log(`  ${rel(f)}`);
}
if (!APPLY) console.log(`\nRe-run with --apply to perform these moves.`);
