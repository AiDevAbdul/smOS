import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

export function getToolInput(payload) {
  return payload?.tool_input || payload?.input || payload?.params || {};
}

export function getToolName(payload) {
  return payload?.tool_name || payload?.tool || "";
}

export function allow(message) {
  if (message) process.stderr.write(`[allow] ${message}\n`);
  process.exit(0);
}

export function block(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

export function loadClientProfile(slug) {
  if (!slug) return null;
  const p = resolve(ROOT, "clients", slug, "client_profile.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function resolveClientSlugFromAccount(ad_account_id) {
  if (!ad_account_id) return null;
  const clientsDir = resolve(ROOT, "clients");
  if (!existsSync(clientsDir)) return null;
  const slugs = readdirSyncSafe(clientsDir);
  for (const slug of slugs) {
    const profile = loadClientProfile(slug);
    if (profile?.accounts?.ad_account_id === ad_account_id) return slug;
  }
  return null;
}

function readdirSyncSafe(p) {
  try { return readdirSync(p); } catch { return []; }
}
