// ui/lib/registry.ts — the in-process run registry.
//
// A Claude run started via `claude -p ... --output-format stream-json` can
// outlive a single HTTP request (the browser tab can reload, the SSE stream
// can drop). So the registry, not the route handler, owns the child process:
// app/api/runs spawns into it, app/api/runs/[runId]/stream tails its event
// buffer and replays from whatever offset the client asks for.
//
// `next dev` reloads route-handler modules on every edit (HMR), which would
// normally wipe a module-level Map and orphan the child process. Stashing the
// registry on `globalThis` survives that — the module re-evaluates, the data
// underneath does not. In production (`next start`) there is one long-lived
// process so this is just a plain singleton.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Finished runs are appended here as NDJSON. The in-memory registry dies with
 * the Next.js process, so without this file the Runs screen would show an
 * empty history — and its cost/duration charts would have nothing to plot —
 * every time the dev server restarted. `logs/` is gitignored.
 */
const HISTORY_FILE = resolve(REPO_ROOT, "logs", "ui-runs.jsonl");

/**
 * Where the permission bridge should POST its approval requests — i.e. this
 * server. `next dev`/`next start` put the chosen port in PORT; fall back to
 * Next's default so the common case needs no configuration. Only used when a
 * run opts into the bridge.
 */
const UI_BASE_URL =
  process.env.SMOS_UI_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

export type RunStatus = "running" | "done" | "failed";

/**
 * The `result` event that `claude --output-format stream-json` emits once, last.
 * It is the only place the CLI reports what a run actually cost, so it is
 * lifted out of the raw event buffer into a typed field rather than being
 * re-parsed by every consumer.
 */
export interface RunResult {
  subtype: string | null;
  costUsd: number | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  isError: boolean;
}

export interface RunEvent {
  seq: number;
  at: string;
  // Raw parsed NDJSON object from `claude --output-format stream-json`, or a
  // registry-synthesized envelope ({type:"registry_error"|"registry_exit"}).
  data: unknown;
}

export interface RunRecord {
  runId: string;
  slug: string | null;
  skillPrompt: string;
  claudeSessionId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  /** Populated when the CLI's `result` event arrives; null while running. */
  result: RunResult | null;
  /** Last assistant text, capped — kept so an archived run can still show
   *  what it concluded once its event buffer is gone. */
  finalText: string | null;
  events: RunEvent[];
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  listeners: Set<(event: RunEvent) => void>;
  /** True for a run rehydrated from disk: metadata and outcome survive, the
   *  event-by-event transcript does not. Consumers must say so rather than
   *  rendering an empty stream as if the run produced no output. */
  archived?: boolean;
}

/** What gets written to HISTORY_FILE — the record minus the live-only fields.
 *  The full event buffer is deliberately not persisted: transcripts run to
 *  megabytes, and the summary below is what the history view actually reads. */
export type ArchivedRun = Omit<RunRecord, "events" | "child" | "listeners"> & {
  eventCount: number;
};

interface Registry {
  runs: Map<string, RunRecord>;
}

const REGISTRY_KEY = "__smosUiRunRegistry__";
function getRegistry(): Registry {
  const g = globalThis as unknown as Record<string, Registry>;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = { runs: new Map() };
  return g[REGISTRY_KEY];
}

function pushEvent(run: RunRecord, data: unknown) {
  const event: RunEvent = { seq: run.events.length, at: new Date().toISOString(), data };
  run.events.push(event);
  for (const listener of run.listeners) listener(event);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Lift the CLI's terminal `result` event into typed fields. */
function parseResult(e: Record<string, unknown>): RunResult {
  return {
    subtype: typeof e.subtype === "string" ? e.subtype : null,
    costUsd: num(e.total_cost_usd),
    durationMs: num(e.duration_ms),
    durationApiMs: num(e.duration_api_ms),
    numTurns: num(e.num_turns),
    isError: e.is_error === true,
  };
}

/** Last assistant text block in an `assistant` event, or null. */
function assistantText(e: Record<string, unknown>): string | null {
  const message = e.message as { content?: unknown } | undefined;
  if (!Array.isArray(message?.content)) return null;
  const text = message.content
    .filter((c): c is { type: string; text: string } => {
      const b = c as { type?: unknown; text?: unknown };
      return b?.type === "text" && typeof b.text === "string";
    })
    .map((c) => c.text)
    .join("");
  return text.trim() ? text.slice(0, 4000) : null;
}

function archive(run: RunRecord) {
  const row: ArchivedRun = {
    runId: run.runId,
    slug: run.slug,
    skillPrompt: run.skillPrompt,
    claudeSessionId: run.claudeSessionId,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    result: run.result,
    finalText: run.finalText,
    eventCount: run.events.length,
    archived: true,
  };
  try {
    mkdirSync(dirname(HISTORY_FILE), { recursive: true });
    appendFileSync(HISTORY_FILE, `${JSON.stringify(row)}\n`, "utf8");
  } catch {
    // History is a convenience, never a correctness requirement — a run that
    // completed must not be reported as failed because the log was unwritable.
  }
}

/** Read archived runs, newest last. Malformed lines are skipped, not thrown. */
export function readRunHistory(): ArchivedRun[] {
  if (!existsSync(HISTORY_FILE)) return [];
  let raw: string;
  try {
    raw = readFileSync(HISTORY_FILE, "utf8");
  } catch {
    return [];
  }
  const rows: ArchivedRun[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ArchivedRun;
      if (parsed && typeof parsed.runId === "string") rows.push({ ...parsed, archived: true });
    } catch {
      continue;
    }
  }
  return rows;
}

/**
 * Spawn `claude -p <prompt> --output-format stream-json --verbose` (cwd = repo
 * root, so skills/CLAUDE.md/hooks load exactly as they do from the terminal).
 * Pass `resumeSessionId` to continue a prior session instead of starting a new
 * conversation. Returns immediately with the runId; output streams into the
 * run's event buffer as it arrives.
 */
export function startRun(opts: {
  prompt: string;
  slug?: string | null;
  resumeSessionId?: string | null;
  /**
   * Opt-in headless permission bridge (Phase D). When true, every tool-use
   * permission check in this run is routed to the operator UI instead of
   * being auto-approved/denied by the CLI's default headless behavior: adds
   * `--permission-prompt-tool mcp__ui-permission-bridge__approve` and sets
   * `SMOS_UI_RUN_ID` on the child so the bridge (mcp/ui-permission-bridge)
   * can tag its POSTs to app/api/permissions with this run's id. Defaults to
   * false/undefined so existing callers (app/api/runs's current POST body)
   * are unaffected unless they explicitly opt in.
   */
  usePermissionBridge?: boolean;
}): RunRecord {
  const runId = randomUUID();
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  if (opts.usePermissionBridge) {
    // Register the bridge inline for this run only. Without this the CLI
    // exits with "MCP tool mcp__ui-permission-bridge__approve (passed via
    // --permission-prompt-tool) not found", since nothing else in the repo
    // declares the server. An inline --mcp-config needs no `claude mcp add`
    // and no interactive confirmation; and because --strict-mcp-config is
    // deliberately NOT passed, the repo's own MCP servers still load.
    args.push(
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          "ui-permission-bridge": {
            command: process.execPath,
            args: [resolve(REPO_ROOT, "mcp", "ui-permission-bridge", "index.js")],
            env: { SMOS_UI_RUN_ID: runId, SMOS_UI_BASE_URL: UI_BASE_URL },
          },
        },
      }),
      "--permission-prompt-tool",
      "mcp__ui-permission-bridge__approve"
    );
  }

  // ~/.config/smos/.env (loaded into process.env by instrumentation.ts for
  // route handlers that need META_*/SUPABASE_* config) may carry an
  // ANTHROPIC_API_KEY placeholder for the /research and /pre-audit LLM
  // classifier. That must never reach this spawned `claude` process — an
  // API-key auth source (even an invalid placeholder) takes precedence over
  // subscription OAuth login and breaks every UI-launched run. Strip it.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  if (opts.usePermissionBridge) childEnv.SMOS_UI_RUN_ID = runId;

  const child = spawn("claude", args, {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const run: RunRecord = {
    runId,
    slug: opts.slug ?? null,
    skillPrompt: opts.prompt,
    claudeSessionId: opts.resumeSessionId ?? null,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    result: null,
    finalText: null,
    events: [],
    child,
    listeners: new Set(),
  };
  getRegistry().runs.set(runId, run);

  let stdoutBuf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed?.session_id === "string") run.claudeSessionId = parsed.session_id;
        if (parsed?.type === "result") run.result = parseResult(parsed);
        if (parsed?.type === "assistant") {
          const text = assistantText(parsed);
          if (text) run.finalText = text;
        }
        pushEvent(run, parsed);
      } catch {
        pushEvent(run, { type: "registry_raw_stdout", line });
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  child.on("error", (err) => {
    pushEvent(run, { type: "registry_error", message: err.message });
  });

  child.on("close", (code) => {
    run.status = code === 0 ? "done" : "failed";
    run.exitCode = code;
    run.endedAt = new Date().toISOString();
    run.child = null;
    if (code !== 0 && stderrBuf.trim()) {
      pushEvent(run, { type: "registry_stderr", stderr: stderrBuf.trim() });
    }
    pushEvent(run, { type: "registry_exit", code });
    archive(run);
  });

  return run;
}

export function getRun(runId: string): RunRecord | undefined {
  return getRegistry().runs.get(runId);
}

export function listRuns(slug?: string | null): RunRecord[] {
  const all = [...getRegistry().runs.values()];
  const filtered = slug ? all.filter((r) => r.slug === slug) : all;
  return filtered.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/**
 * Live runs plus everything archived to disk, newest first. Deliberately
 * separate from `listRuns` (which stays live-only, since AppShell uses it to
 * count *currently running* processes). A live record always wins over its
 * archived copy — the same run is written to history when it exits, so the
 * two overlap for the lifetime of the process.
 */
export function listRunsWithHistory(slug?: string | null): RunRecord[] {
  const live = [...getRegistry().runs.values()];
  const liveIds = new Set(live.map((r) => r.runId));
  const archived: RunRecord[] = readRunHistory()
    .filter((r) => !liveIds.has(r.runId))
    .map((r) => ({ ...r, events: [], child: null, listeners: new Set(), archived: true }));

  const all = [...live, ...archived];
  const filtered = slug ? all.filter((r) => r.slug === slug) : all;
  return filtered.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** Subscribe to events on a run from `sinceSeq` (exclusive) onward, replaying
 *  buffered events synchronously before live ones start arriving. */
export function subscribe(
  runId: string,
  sinceSeq: number,
  onEvent: (event: RunEvent) => void
): () => void {
  const run = getRun(runId);
  if (!run) return () => {};
  for (const event of run.events) {
    if (event.seq > sinceSeq) onEvent(event);
  }
  run.listeners.add(onEvent);
  return () => run.listeners.delete(onEvent);
}

/** Best-effort kill (SIGTERM) — used when the operator cancels a run from the UI. */
export function killRun(runId: string): boolean {
  const run = getRun(runId);
  if (!run || !run.child) return false;
  run.child.kill("SIGTERM");
  return true;
}
