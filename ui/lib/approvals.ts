// ui/lib/approvals.ts — read-only listing over the approvals store
// (data/approvals/*.json) for the Approvals inbox / clients-board badge.
// Decisions themselves go through scripts/lib/approvals.js's `decide()`
// (Phase D), not through a duplicated write path here.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function storeDir(): string {
  // Statically scoped (data/approvals under the repo root) rather than a
  // fully dynamic path, so Turbopack doesn't trace the whole project as a
  // side effect of this read-only fs walk — see the build warning this fixed.
  return process.env.SMOS_APPROVALS_DIR || resolve(REPO_ROOT, "data", "approvals");
}

// turbopackIgnore hints below: this is a fixed, repo-relative directory, not
// a user-controlled path — the dynamic-access warning doesn't apply.
function safeReaddir(dir: string): string[] {
  if (!existsSync(/* turbopackIgnore: true */ dir)) return [];
  return readdirSync(/* turbopackIgnore: true */ dir);
}

export interface ApprovalRecord {
  id: string;
  slug: string | null;
  action: string;
  summary: string;
  payload: unknown;
  requiredRole: string;
  status: "pending" | "approved" | "rejected" | "expired" | string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string | null;
  decidedBy?: string;
  decidedAt?: string;
}

export function listApprovals(opts: { slug?: string | null; status?: string | null } = {}): ApprovalRecord[] {
  const dir = storeDir();
  const records: ApprovalRecord[] = [];
  for (const file of safeReaddir(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(/* turbopackIgnore: true */ resolve(dir, file), "utf8"));
      records.push(rec);
    } catch {
      // skip unreadable record
    }
  }
  return records
    .filter((r) => (opts.slug ? r.slug === opts.slug : true))
    .filter((r) => (opts.status ? r.status === opts.status : true))
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
}

export function countPending(slug?: string | null): number {
  return listApprovals({ slug: slug ?? null, status: "pending" }).length;
}
