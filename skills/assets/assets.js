#!/usr/bin/env node
/**
 * /assets companion script (Phase 3.4) — DAM CLI over scripts/lib/dam.js.
 *
 * Usage:
 *   node skills/assets/assets.js <slug> register '<asset json>'
 *   node skills/assets/assets.js <slug> metrics <asset_id> '<metrics json>'
 *   node skills/assets/assets.js <slug> top [--by hook_rate]
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../../scripts/lib/load-env.js";
import { register, recordMetrics, topPerformers, loadIndex } from "../../scripts/lib/dam.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
loadEnv({ silent: true });

const [slug, cmd, ...rest] = process.argv.slice(2);
if (!slug || !cmd) { console.error("usage: assets.js <slug> <register|metrics|top> ..."); process.exit(2); }
if (!existsSync(resolve(ROOT, "clients", slug, "client_profile.json"))) {
  console.error(`HALT: client ${slug} not found.`); process.exit(3);
}

try {
  if (cmd === "register") {
    const a = register(slug, JSON.parse(rest[0] || "{}"));
    console.log(`registered ${a.asset_id} (v${a.version}, ${a.media_type})`);
  } else if (cmd === "metrics") {
    const a = recordMetrics(slug, rest[0], JSON.parse(rest[1] || "{}"));
    console.log(`updated metrics for ${a.asset_id}: ${JSON.stringify(a.metrics)}`);
  } else if (cmd === "top") {
    const by = (rest.find((r) => r.startsWith("--by="))?.split("=")[1]) || "hook_rate";
    const top = topPerformers(slug, { by });
    console.log(`${loadIndex(slug).assets.length} assets · top by ${by}:`);
    top.forEach((a, i) => console.log(`  ${i + 1}. ${a.asset_id} — ${by}=${a.metrics[by]}`));
  } else {
    console.error(`unknown subcommand: ${cmd}`); process.exit(2);
  }
} catch (e) {
  console.error(`assets error: ${e.message}`); process.exit(1);
}
