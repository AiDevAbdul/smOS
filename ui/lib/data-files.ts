// ui/lib/data-files.ts — summarizes a client's handoff-data files for the Data
// screen.
//
// The summary is derived from each file's actual shape rather than from a
// hand-written table per filename. Skills add and reshape these files often, so
// a per-file renderer would silently go stale; a generic "find the array of
// records, tally its low-cardinality string fields" pass keeps working, and
// says plainly when a file has no chartable structure.

import { readFileSync, existsSync, statSync } from "node:fs";
import { DATA_FILES, clientData } from "../../scripts/lib/paths.js";

export interface Facet {
  /** The field tallied, e.g. "platform". */
  key: string;
  values: Array<{ name: string; value: number }>;
}

export interface DataFileSummary {
  file: string;
  bytes: number;
  modifiedAt: string | null;
  /** Where the records were found: the root array, or the object key holding it. */
  recordPath: string | null;
  recordCount: number;
  /** Top-level keys, for an object file. */
  topKeys: string[];
  facets: Facet[];
  parseError: string | null;
}

const MAX_FACETS = 3;
/** A field with one value per record (an id, a timestamp) charts as noise. */
const MAX_CARDINALITY = 12;
const SKIP_KEYS = /(^|_)(id|ids|url|uri|link|text|caption|body|hash|token|at|ts|time|date)$/i;

function isRecordArray(v: unknown): v is Array<Record<string, unknown>> {
  return Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r));
}

/** Find the array of records — the root, or the longest one an object holds. */
function findRecords(value: unknown): { path: string | null; rows: Array<Record<string, unknown>> } {
  if (isRecordArray(value)) return { path: "(root array)", rows: value };
  if (!value || typeof value !== "object") return { path: null, rows: [] };
  let best: { path: string | null; rows: Array<Record<string, unknown>> } = { path: null, rows: [] };
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isRecordArray(v) && v.length > best.rows.length) best = { path: k, rows: v };
  }
  return best;
}

function tally(rows: Array<Record<string, unknown>>): Facet[] {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (SKIP_KEYS.test(k)) continue;
      // Only scalars name a category; an object or array field doesn't.
      if (typeof v !== "string" && typeof v !== "boolean" && v !== null) continue;
      const label = v === null ? "(none)" : String(v);
      // A free-text value is a value, not a category.
      if (label.length > 32) continue;
      const m = counts.get(k) ?? new Map<string, number>();
      m.set(label, (m.get(label) ?? 0) + 1);
      counts.set(k, m);
    }
  }

  return [...counts.entries()]
    .filter(([, m]) => {
      if (m.size <= 1 || m.size > MAX_CARDINALITY) return false;
      // Every value appearing exactly once means the field identifies records
      // rather than grouping them (a title, a per-item angle). Charting it
      // draws a row of identical 1s that says nothing.
      return Math.max(...m.values()) > 1;
    })
    // Prefer the fields that actually partition the set: fewest values first,
    // which is what makes a readable donut.
    .sort((a, b) => a[1].size - b[1].size)
    .slice(0, MAX_FACETS)
    .map(([key, m]) => ({
      key,
      values: [...m.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    }));
}

function summarize(file: string, path: string): DataFileSummary {
  const stat = statSync(path);
  const base: DataFileSummary = {
    file,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    recordPath: null,
    recordCount: 0,
    topKeys: [],
    facets: [],
    parseError: null,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ...base, parseError: err instanceof Error ? err.message : "failed to parse JSON" };
  }

  const { path: recordPath, rows } = findRecords(parsed);
  return {
    ...base,
    recordPath,
    recordCount: rows.length,
    topKeys:
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>)
        : [],
    facets: rows.length ? tally(rows) : [],
  };
}

export function listDataFileSummaries(slug: string): DataFileSummary[] {
  const out: DataFileSummary[] = [];
  for (const file of DATA_FILES as string[]) {
    const path = clientData(slug, file);
    if (!existsSync(path)) continue;
    try {
      out.push(summarize(file, path));
    } catch {
      continue;
    }
  }
  return out;
}

/** Full parsed contents of one data file, for the JSON pane. */
export function readDataFile(slug: string, file: string): unknown {
  if (!(DATA_FILES as string[]).includes(file)) return null;
  const path = clientData(slug, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
