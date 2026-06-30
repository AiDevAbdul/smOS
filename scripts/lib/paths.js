// scripts/lib/paths.js — SINGLE SOURCE OF TRUTH for every on-disk data path.
//
// Why this exists: paths were previously hardcoded (`resolve(dir, "ad_copy.json")`,
// `resolve(clientDir, "reports")`) across ~23 skill/script files, so the layout
// could never be changed in one place and steadily drifted into a flat dump that
// mixed raw JSON, rendered .md/.html/.pdf, dated reports, and state files.
//
// Canonical layout (per the 2026-06-30 file-structure plan), four buckets:
//   clients/<slug>/
//     profile.json                      identity (was client_profile.json)
//     CLAUDE.md
//     data/<file>.json                  engine source-of-truth JSON
//     deliverables/<artifact>/<artifact>.{md,html,pdf}   human renders (BY ARTIFACT)
//     reports/<YYYY-MM-DD>/<type>.{md,html,pdf} + <type>.raw.json   dated recurring
//     state/<file>                      internal bookkeeping (sent.json, etc.)
//   prospects/<slug>/ { data/, data/raw/, deliverables/<artifact>/ }
//   data/research-cache/                global niche + market-research cache
//   public/                             generated web hub (gitignored)
//
// MIGRATION SAFETY: writers should target the canonical path; readers that must
// work before migration use `resolveExisting(canonical, legacy)` so an un-migrated
// file is still found in its old flat location.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function repoRoot() {
  return ROOT;
}

/** mkdir -p the *parent directory* of a file path, then return the path (for writers). */
export function ensureParent(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  return filePath;
}

/** Return `preferred` if it exists, else `legacy` if it exists, else `preferred` (for writes). */
export function resolveExisting(preferred, legacy) {
  if (existsSync(preferred)) return preferred;
  if (legacy && existsSync(legacy)) return legacy;
  return preferred;
}

// ──────────────────────────── client ────────────────────────────

export const clientRoot = (slug) => resolve(ROOT, "clients", slug);
export const clientProfile = (slug) => resolve(clientRoot(slug), "profile.json");
export const clientClaude = (slug) => resolve(clientRoot(slug), "CLAUDE.md");

export const clientDataDir = (slug) => resolve(clientRoot(slug), "data");
export const clientData = (slug, file) => resolve(clientDataDir(slug), file);

export const clientDeliverableDir = (slug, artifact) => resolve(clientRoot(slug), "deliverables", artifact);
/** Renders grouped BY ARTIFACT: deliverables/<artifact>/<artifact>.<ext>. */
export const clientDeliverable = (slug, artifact, ext) =>
  resolve(clientDeliverableDir(slug, artifact), `${artifact}.${ext}`);

export const clientReportDir = (slug, date) => resolve(clientRoot(slug), "reports", date);
/** Dated recurring report: reports/<YYYY-MM-DD>/<type>.<ext> (ext "raw.json" allowed). */
export const clientReport = (slug, date, type, ext) =>
  resolve(clientReportDir(slug, date), `${type}.${ext}`);

export const clientState = (slug, file) => resolve(clientRoot(slug), "state", file);

// ──────────────────────────── prospect ──────────────────────────

export const prospectRoot = (slug) => resolve(ROOT, "prospects", slug);
export const prospectData = (slug, file) => resolve(prospectRoot(slug), "data", file);
export const prospectRaw = (slug, file) => resolve(prospectRoot(slug), "data", "raw", file);
export const prospectDeliverable = (slug, artifact, ext) =>
  resolve(prospectRoot(slug), "deliverables", artifact, `${artifact}.${ext}`);

// ──────────────────────────── global ────────────────────────────

export const researchCacheDir = () => resolve(ROOT, "data", "research-cache");
export const researchCache = (file) => resolve(researchCacheDir(), file);
export const nichesDir = () => resolve(ROOT, "data", "niches");
export const publicHub = (...parts) => resolve(ROOT, "public", ...parts);

// ──────────────────────── canonical artifact map ────────────────
// logical engine file (data bucket) → kebab artifact folder (deliverables bucket).
// Drives migrate-layout.js and any renderer that needs both.

/** Engine JSON that belongs in clients/<slug>/data/. */
export const DATA_FILES = [
  "baseline_snapshot.json",
  "audit_raw.json",
  "competitor_intel.json",
  "audience_map.json",
  "strategy_brief.json",
  "ad_copy.json",
  "content_plan.json",
  "content_calendar.json",
  "launch_plan.json",
  "launch_artifacts.json",
  "creative_test_plan.json",
  "inbox.json",
];

/** Rendered deliverables: legacy flat basename (no ext) → kebab artifact folder. */
export const DELIVERABLE_ARTIFACTS = {
  strategy_brief: "strategy-brief",
  ad_copy: "ad-copy",
  audience_map: "audience-map",
  content_plan: "content-plan",
  creative_test_plan: "creative-test",
  content_sops: "content-sops",
};

/** clients/<slug>/reports — the dated-report root (one subfolder per run). */
export const clientReportsRoot = (slug) => resolve(clientRoot(slug), "reports");

/** State/bookkeeping files (clients/<slug>/state/). */
export const STATE_FILES = ["sent.json", "pixel_install_instructions.md"];

export const DELIVERABLE_EXTS = ["md", "html", "pdf"];

// ─────────────────────────── legacy paths ───────────────────────
// Old flat locations, for back-compat reads and for the migrator's "from" side.

export const legacy = {
  clientProfile: (slug) => resolve(clientRoot(slug), "client_profile.json"),
  clientFlat: (slug, file) => resolve(clientRoot(slug), file),
  clientReportsDir: (slug) => resolve(clientRoot(slug), "reports"),
  prospectFlat: (slug, file) => resolve(prospectRoot(slug), file),
  prospectReportsDir: (slug) => resolve(prospectRoot(slug), "reports"),
  topLevelReports: (file) => resolve(ROOT, "reports", file),
};

// ──────────────────── clientFile(): the one classifier ──────────────────
// Maps a *logical* filename to its canonical absolute path by bucket, so skills
// stop hardcoding `resolve(dir, name)`. The bucket rules live ONLY here.
//
//   reads  (default):  prefer the canonical location, fall back to the legacy flat
//                      path so un-migrated data still loads.
//   writes ({forWrite:true}): always the canonical path, with parent dir created.
//
// Operational JSON the engine writes between steps (performance_analysis, campaign_log)
// is treated as data/. Anything unrecognized stays at the client root (safe default).

const EXTRA_DATA_FILES = new Set(["performance_analysis.json", "campaign_log.json"]);

export function clientFile(slug, name, { forWrite = false } = {}) {
  const pick = (canonical, legacyPath) =>
    forWrite ? ensureParent(canonical) : resolveExisting(canonical, legacyPath);

  // profile (accept either historical name)
  if (name === "profile.json" || name === "client_profile.json") {
    return pick(clientProfile(slug), legacy.clientProfile(slug));
  }
  // engine data JSON
  if (DATA_FILES.includes(name) || EXTRA_DATA_FILES.has(name)) {
    return pick(clientData(slug, name), legacy.clientFlat(slug, name));
  }
  // rendered deliverables: <base>.<md|html|pdf> where <base> maps to a kebab artifact
  const m = name.match(/^(.+)\.(md|html|pdf)$/);
  if (m && DELIVERABLE_ARTIFACTS[m[1]]) {
    const artifact = DELIVERABLE_ARTIFACTS[m[1]];
    return pick(clientDeliverable(slug, artifact, m[2]), legacy.clientFlat(slug, name));
  }
  // the one-off audit deliverable
  if (name === "audit_report.md") {
    return pick(clientDeliverable(slug, "audit", "md"), legacy.clientFlat(slug, name));
  }
  // state / bookkeeping
  if (STATE_FILES.includes(name)) {
    return pick(clientState(slug, name), legacy.clientFlat(slug, name));
  }
  // unknown → keep at client root (back-compat preferred for reads)
  return pick(resolve(clientRoot(slug), name), legacy.clientFlat(slug, name));
}
