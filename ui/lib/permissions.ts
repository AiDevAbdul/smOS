// ui/lib/permissions.ts — in-process registry of pending headless
// permission-prompt requests, mirroring ui/lib/registry.ts's globalThis
// singleton pattern (survives `next dev` HMR module re-evaluation; in
// `next start` it's just a plain singleton for the process lifetime).
//
// Flow: mcp/ui-permission-bridge (a stdio MCP server passed to `claude -p`
// via --permission-prompt-tool) POSTs a request here via
// app/api/permissions/route.ts (createRequest), then polls
// app/api/permissions/[id]/route.ts until a human decides via
// app/api/permissions/[id]/decide/route.ts (decideRequest) in the browser
// banner rendered by RunConsole.
import { randomUUID } from "node:crypto";

export type PermissionBehavior = "allow" | "deny";

export interface PermissionDecision {
  behavior: PermissionBehavior;
  note?: string;
  decidedAt: string;
  decidedBy?: string;
}

export interface PermissionRequestRecord {
  id: string;
  runId: string | null;
  toolName: string;
  input: unknown;
  /** The `tool_use_id` the CLI sends with every permission check (verified
   *  against Claude Code 2.1.265). Used to collapse a re-check of the same
   *  tool call onto one banner instead of stacking duplicates. */
  toolUseId: string | null;
  status: "pending" | "decided" | "timeout";
  createdAt: string;
  decision: PermissionDecision | null;
}

interface PermissionRegistry {
  requests: Map<string, PermissionRequestRecord>;
}

const REGISTRY_KEY = "__smosUiPermissionRegistry__";
function getRegistry(): PermissionRegistry {
  const g = globalThis as unknown as Record<string, PermissionRegistry>;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = { requests: new Map() };
  return g[REGISTRY_KEY];
}

/** How long a pending request is still considered "live" for listPending()
 *  purposes before the bridge's own timeout (~5 min) would have fired. Kept
 *  generous — the bridge, not the UI, is the source of truth on timeout. */
const STALE_MS = 10 * 60_000;

export function createRequest(opts: {
  runId?: string | null;
  toolName: string;
  input: unknown;
  toolUseId?: string | null;
}): PermissionRequestRecord {
  const runId = opts.runId ?? null;
  const toolUseId = opts.toolUseId ?? null;

  // The CLI can re-issue a permission check for the same tool_use_id (its own
  // logs call this "reExecuted"). Reuse the still-pending record so the
  // operator sees one banner and one decision, not a growing stack of
  // identical ones — and so the bridge's poll on the original id still
  // resolves.
  if (toolUseId) {
    for (const existing of getRegistry().requests.values()) {
      if (
        existing.status === "pending" &&
        existing.toolUseId === toolUseId &&
        existing.runId === runId
      ) {
        return existing;
      }
    }
  }

  const id = randomUUID();
  const record: PermissionRequestRecord = {
    id,
    runId,
    toolName: opts.toolName,
    input: opts.input ?? null,
    toolUseId,
    status: "pending",
    createdAt: new Date().toISOString(),
    decision: null,
  };
  getRegistry().requests.set(id, record);
  return record;
}

export function getRequest(id: string): PermissionRequestRecord | undefined {
  return getRegistry().requests.get(id);
}

export function decideRequest(
  id: string,
  decision: { behavior: PermissionBehavior; note?: string; decidedBy?: string }
): PermissionRequestRecord | null {
  const record = getRegistry().requests.get(id);
  if (!record) return null;
  if (record.status !== "pending") return record; // already decided/timed out — no-op
  record.status = "decided";
  record.decision = {
    behavior: decision.behavior,
    note: decision.note,
    decidedBy: decision.decidedBy,
    decidedAt: new Date().toISOString(),
  };
  return record;
}

/** Pending requests, newest first, optionally scoped to one run. Drops
 *  requests stale beyond STALE_MS so a crashed bridge doesn't leave a
 *  phantom banner forever (the bridge itself denies-closed on its own
 *  ~5 min timeout; this is just UI-side housekeeping). */
export function listPending(runId?: string | null): PermissionRequestRecord[] {
  const now = Date.now();
  const all = [...getRegistry().requests.values()].filter((r) => {
    if (r.status !== "pending") return false;
    if (now - new Date(r.createdAt).getTime() > STALE_MS) return false;
    return true;
  });
  const filtered = runId ? all.filter((r) => r.runId === runId) : all;
  return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
