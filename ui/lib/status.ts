// ui/lib/status.ts — server-side data loader wrapping the existing
// `node skills/smos-status/status.js <slug>` CLI contract.
//
// status.js's `main()` runs unconditionally at the bottom of the file (reads
// process.argv, calls process.exit on usage errors) because it's a skill
// companion, not a library — every skill in this repo follows the same
// "one JSON object on stdout" contract (see CLAUDE.md § Skill execution
// contract). Importing it directly would re-run that CLI entrypoint inside
// the Next.js server process. Shelling out to it, exactly as the CLI does,
// keeps status.js as the single source of truth without changing its
// contract for a UI-only caller.
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface StatusStep {
  id: string;
  label: string;
  status: "done" | "missing" | "blocked" | "partial" | string;
  detail: string | null;
}

export interface StatusSection {
  key: string;
  label: string;
  steps: StatusStep[];
}

export interface ClientStatus {
  slug: string;
  is_client: boolean;
  is_zero_start: boolean;
  crm_stage: string | null;
  sections: StatusSection[];
  next_action: { section: string; step: string; status: string; detail: string | null } | null;
}

export function listClientSlugs(): string[] {
  const clientsDir = resolve(REPO_ROOT, "clients");
  if (!existsSync(clientsDir)) return [];
  return readdirSync(clientsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

export function getClientStatus(slug: string): ClientStatus | null {
  try {
    const out = execFileSync(
      process.execPath,
      [resolve(REPO_ROOT, "skills", "smos-status", "status.js"), slug],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function getAllClientStatuses(): ClientStatus[] {
  return listClientSlugs()
    .map((slug) => getClientStatus(slug))
    .filter((s): s is ClientStatus => s !== null);
}
