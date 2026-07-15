#!/usr/bin/env node
/**
 * scripts/generate-active-clients.js — derive CLAUDE.md's "Active Clients" section
 * from crm/pipeline.json instead of hand-editing it.
 *
 * "Active" = deal.stage === "won" (see schemas/deal.js STAGES). Each line links to
 * the client's CLAUDE.md if clients/{slug}/CLAUDE.md exists, else the deal itself.
 *
 * Usage:
 *   node scripts/generate-active-clients.js           # print the generated block
 *   node scripts/generate-active-clients.js --write    # replace the section in CLAUDE.md
 *   node scripts/generate-active-clients.js --check    # exit 1 if CLAUDE.md is stale
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPipeline } from "./lib/crm-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CLAUDE_MD = resolve(ROOT, "CLAUDE.md");

const START = "## Active Clients";
const END_RE = /\n---\n/;

function engagementStart(slug) {
  const p = resolve(ROOT, "clients", slug, "profile.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")).engagement_start_date ?? null; } catch { return null; }
}

// "Active" = a deal the CRM marked won (proposal + contract on file), OR one that
// already has a materialized clients/{slug} profile — some clients (e.g. Blue Rose
// Auto) were onboarded directly and never ran through /proposal, so client_profile
// existing is the more reliable real-world signal than the sales-stage gate alone.
export function renderActiveClients(deals) {
  const active = deals
    .filter((d) => d.stage === "won" || d.links?.client_profile)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!active.length) return `${START}\n\n_None yet — see \`crm/pipeline.json\`._\n`;
  const lines = active.map((d) => {
    const hasClaude = existsSync(resolve(ROOT, "clients", d.slug, "CLAUDE.md"));
    const link = hasClaude ? `clients/${d.slug}/CLAUDE.md` : `crm/pipeline.json (${d.slug})`;
    const status = d.stage === "won" ? "Active" : "Planning mode (no live Meta accounts yet)";
    const start = d.won_at ? d.won_at.slice(0, 10) : (engagementStart(d.slug) || "unknown");
    return `- [${d.company_name}](${link}) · Status: ${status} · Engagement start: ${start}`;
  });
  return `${START}\n\n${lines.join("\n")}\n`;
}

function replaceSection(content, block) {
  const startIdx = content.indexOf(START);
  if (startIdx === -1) throw new Error(`"${START}" heading not found in CLAUDE.md`);
  const rest = content.slice(startIdx);
  const endMatch = rest.match(END_RE);
  const sectionEnd = endMatch ? startIdx + endMatch.index + 1 : content.length; // keep trailing "---\n"
  return content.slice(0, startIdx) + block + content.slice(sectionEnd);
}

function main() {
  const args = process.argv.slice(2);
  const deals = loadPipeline();
  const block = renderActiveClients(deals);

  if (args.includes("--check")) {
    const current = readFileSync(CLAUDE_MD, "utf8");
    const startIdx = current.indexOf(START);
    const rest = current.slice(startIdx);
    const endMatch = rest.match(END_RE);
    const existingBlock = current.slice(startIdx, startIdx + (endMatch ? endMatch.index + 1 : rest.length));
    if (existingBlock.trim() !== block.trim()) {
      console.error("CLAUDE.md Active Clients section is stale. Run: node scripts/generate-active-clients.js --write");
      process.exit(1);
    }
    console.log("CLAUDE.md Active Clients section is up to date.");
    return;
  }

  if (args.includes("--write")) {
    const current = readFileSync(CLAUDE_MD, "utf8");
    writeFileSync(CLAUDE_MD, replaceSection(current, block));
    console.log("CLAUDE.md Active Clients section regenerated.");
    return;
  }

  console.log(block);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
