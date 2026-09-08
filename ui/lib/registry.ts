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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type RunStatus = "running" | "done" | "failed";

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
  events: RunEvent[];
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  listeners: Set<(event: RunEvent) => void>;
}

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
}): RunRecord {
  const runId = randomUUID();
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);

  const child = spawn("claude", args, {
    cwd: REPO_ROOT,
    env: process.env,
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
