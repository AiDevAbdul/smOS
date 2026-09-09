// ui/lib/runs.ts — the serializable view of the run registry.
//
// A RunRecord holds a live ChildProcess and a Set of listeners, neither of
// which can cross the Server/Client Component boundary. Every screen therefore
// reads RunSummary (plain JSON) rather than the record itself, and the
// aggregate stats below are computed on the server so the charts receive
// finished numbers instead of re-deriving them in the browser.

import { listRunsWithHistory, type RunRecord, type RunStatus } from "./registry";

export interface RunSummary {
  runId: string;
  slug: string | null;
  prompt: string;
  /** Skill route parsed off the front of the prompt ("/analyze"), or null for
   *  a free-text run. Used to group cost by skill. */
  skill: string | null;
  sessionId: string | null;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  /** True when this run was rehydrated from logs/ui-runs.jsonl: its outcome
   *  survived a restart, its transcript did not. */
  archived: boolean;
  costUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  resultSubtype: string | null;
  isError: boolean;
  finalText: string | null;
  eventCount: number;
}

const SKILL_RE = /^\s*\/([a-z0-9][a-z0-9:-]*)/i;

export function parseSkill(prompt: string): string | null {
  const m = SKILL_RE.exec(prompt ?? "");
  return m ? `/${m[1].toLowerCase()}` : null;
}

function toSummary(r: RunRecord): RunSummary {
  return {
    runId: r.runId,
    slug: r.slug,
    prompt: r.skillPrompt ?? "",
    skill: parseSkill(r.skillPrompt ?? ""),
    sessionId: r.claudeSessionId,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    exitCode: r.exitCode,
    archived: r.archived === true,
    costUsd: r.result?.costUsd ?? null,
    // A run killed mid-flight never emits `result`, so fall back to wall-clock
    // from the timestamps rather than showing no duration at all.
    durationMs:
      r.result?.durationMs ??
      (r.endedAt ? new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime() : null),
    numTurns: r.result?.numTurns ?? null,
    resultSubtype: r.result?.subtype ?? null,
    isError: r.result?.isError === true,
    finalText: r.finalText ?? null,
    eventCount: "eventCount" in r ? Number((r as { eventCount?: number }).eventCount ?? 0) : r.events.length,
  };
}

export function listRunSummaries(slug?: string | null): RunSummary[] {
  return listRunsWithHistory(slug).map(toSummary);
}

export interface DayPoint {
  date: string;
  runs: number;
  cost: number;
}

export interface SkillRow {
  label: string;
  runs: number;
  cost: number;
  avgDurationMs: number | null;
  failed: number;
}

export interface RunStats {
  total: number;
  running: number;
  done: number;
  failed: number;
  /** Runs that reported a cost. Cost totals are only meaningful over these —
   *  a cancelled run emits no `result`, so counting it as $0 would understate
   *  the average. */
  costed: number;
  totalCost: number;
  medianDurationMs: number | null;
  totalTurns: number;
  byDay: DayPoint[];
  bySkill: SkillRow[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeRunStats(runs: RunSummary[]): RunStats {
  const costs = runs.map((r) => r.costUsd).filter((c): c is number => typeof c === "number");
  const durations = runs.map((r) => r.durationMs).filter((d): d is number => typeof d === "number" && d > 0);

  const days = new Map<string, DayPoint>();
  for (const r of runs) {
    const date = (r.startedAt ?? "").slice(0, 10);
    if (!date) continue;
    const p = days.get(date) ?? { date, runs: 0, cost: 0 };
    p.runs += 1;
    p.cost += r.costUsd ?? 0;
    days.set(date, p);
  }

  const skills = new Map<string, SkillRow & { _dur: number[] }>();
  for (const r of runs) {
    const label = r.skill ?? "free text";
    const row = skills.get(label) ?? { label, runs: 0, cost: 0, avgDurationMs: null, failed: 0, _dur: [] };
    row.runs += 1;
    row.cost += r.costUsd ?? 0;
    if (r.status === "failed" || r.isError) row.failed += 1;
    if (typeof r.durationMs === "number" && r.durationMs > 0) row._dur.push(r.durationMs);
    skills.set(label, row);
  }

  return {
    total: runs.length,
    running: runs.filter((r) => r.status === "running").length,
    done: runs.filter((r) => r.status === "done").length,
    failed: runs.filter((r) => r.status === "failed").length,
    costed: costs.length,
    totalCost: costs.reduce((a, b) => a + b, 0),
    medianDurationMs: median(durations),
    totalTurns: runs.reduce((a, r) => a + (r.numTurns ?? 0), 0),
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    bySkill: [...skills.values()]
      .map(({ _dur, ...row }) => ({
        ...row,
        avgDurationMs: _dur.length ? _dur.reduce((a, b) => a + b, 0) / _dur.length : null,
      }))
      .sort((a, b) => b.runs - a.runs),
  };
}
