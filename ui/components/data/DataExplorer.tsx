"use client";

/**
 * The Data screen: a searchable list of a client's handoff files on the left,
 * and on the right the selected file's shape — record count, derived facet
 * charts, and the raw JSON.
 *
 * Facets come from the file's real structure (see lib/data-files.ts), so a file
 * whose fields are all ids or free text honestly reports "nothing to chart"
 * instead of being given a decorative graph.
 */

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import ChartCard from "../charts/ChartCard";
import DonutStat from "../charts/DonutStat";
import RankBar from "../charts/RankBar";
import MetricCard from "../MetricCard";
import { fmtCompact, fmtDateTime, fmtNumber } from "../../lib/format";
import type { DataFileSummary } from "../../lib/data-files";

/**
 * Palette indices that carry no verdict. The chart palette's slots 2 and 3 are
 * amber and red — the design system's caution/action hues — and a neutral
 * distribution painted red reads as a problem. Blue / teal / purple / steel
 * only.
 */
const NEUTRAL_HUES: Array<0 | 4 | 5 | 6> = [0, 4, 5, 6];

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function prettyKey(key: string): string {
  return key.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function DataExplorer({
  files,
  selected,
  content,
  contentBytes,
}: {
  files: DataFileSummary[];
  /** Which file the server read, from `?file=`. */
  selected: string;
  /** Parsed JSON of `selected` only — null when it is too large to inline. */
  content: unknown;
  contentBytes: number;
}) {
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Selection lives in the URL, not in state: only the selected file's JSON is
  // read and shipped, so opening the Data tab doesn't send every handoff file
  // (inbox.json alone runs to hundreds of KB) to the browser. It also makes a
  // file deep-linkable.
  function select(file: string) {
    startTransition(() => {
      router.replace(`${pathname}?file=${encodeURIComponent(file)}`, { scroll: false });
    });
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    // Search the filename and the field names inside it, so "platform" finds
    // the calendar and the inbox without knowing either filename.
    return files.filter(
      (f) =>
        f.file.toLowerCase().includes(q) ||
        f.topKeys.some((k) => k.toLowerCase().includes(q)) ||
        f.facets.some((facet) => facet.key.toLowerCase().includes(q))
    );
  }, [files, query]);

  const current = files.find((f) => f.file === selected) ?? null;

  if (files.length === 0) {
    return (
      <div className="ds-empty" style={{ minHeight: 220 }}>
        <svg aria-hidden="true">
          <use href="/icons.svg#i-data" />
        </svg>
        <p className="ds-empty__title">No handoff data yet</p>
        <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0, maxWidth: "48ch" }}>
          Nothing under <code>clients/…/data/</code> has been written by a skill run yet. Each skill
          drops its JSON handoff there for the next one to read.
        </p>
      </div>
    );
  }

  return (
    <div className="ds-split ds-panel" style={{ overflow: "hidden", minHeight: 560 }}>
      <div className="ds-split__a" style={{ width: 260, flexBasis: 260 }}>
        <div style={{ padding: "var(--ds-space-3)", borderBottom: "1px solid var(--ds-line)" }}>
          <label className="ds-sr-only" htmlFor="data-search">
            Search data files and fields
          </label>
          <input
            id="data-search"
            className="ds-input"
            type="search"
            placeholder="Search files or fields…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="ds-run-list" role="listbox" aria-label="Data files">
          {shown.map((f) => (
            <button
              type="button"
              key={f.file}
              role="option"
              aria-selected={f.file === selected}
              className={`ds-run-list__row${f.file === selected ? " is-selected" : ""}`}
              onClick={() => select(f.file)}
            >
              <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
                <span
                  style={{
                    fontFamily: "var(--ds-font-mono)",
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {f.file}
                </span>
                <span style={{ fontSize: 11, color: "var(--ds-muted)" }}>
                  {f.parseError
                    ? "unparseable"
                    : f.recordCount
                      ? `${fmtCompact(f.recordCount)} records`
                      : "no record array"}
                </span>
              </span>
              <span className="ds-run-list__meta">{kb(f.bytes)}</span>
            </button>
          ))}
          {shown.length === 0 && (
            <p style={{ padding: "var(--ds-space-4)", margin: 0, fontSize: 12.5, color: "var(--ds-muted)" }}>
              No file matches “{query}”.
            </p>
          )}
        </div>
      </div>

      <div className="ds-split__handle" aria-hidden="true" style={{ cursor: "default" }} />

      <div
        className="ds-split__b"
        style={{ padding: "var(--ds-space-5)", opacity: pending ? 0.6 : 1 }}
        aria-busy={pending}
      >
        {!current ? (
          <p style={{ color: "var(--ds-muted)" }}>Pick a file to inspect.</p>
        ) : (
          <div>
            <div className="ds-sec" style={{ marginTop: 0 }}>
              <div>
                <h2 className="ds-sec__title" style={{ fontFamily: "var(--ds-font-mono)", fontSize: 17 }}>
                  {current.file}
                </h2>
                <p className="ds-sec__sub">
                  {current.recordPath
                    ? `Records under ${current.recordPath}`
                    : "No array of records at the top level"}
                  {current.modifiedAt ? ` · updated ${fmtDateTime(current.modifiedAt)}` : ""}
                </p>
              </div>
            </div>

            {current.parseError ? (
              <div className="ds-inline-error" role="alert">
                This file is on disk but isn&rsquo;t valid JSON: {current.parseError}
              </div>
            ) : (
              <>
                <div className="ds-metric-grid" style={{ marginBottom: "var(--ds-space-5)" }}>
                  <MetricCard
                    label="Records"
                    value={current.recordCount ? fmtNumber(current.recordCount) : "—"}
                    note={current.recordPath ?? "not a record collection"}
                    hue={0}
                  />
                  <MetricCard label="File size" value={kb(current.bytes)} note="on disk" hue={4} />
                  <MetricCard
                    label="Top-level keys"
                    value={current.topKeys.length ? fmtNumber(current.topKeys.length) : "—"}
                    note={current.topKeys.slice(0, 4).join(", ") || "root is an array"}
                    hue={5}
                  />
                </div>

                {current.facets.length > 0 ? (
                  <div className="ds-duo">
                    {current.facets.map((facet, i) => {
                      const total = facet.values.reduce((a, v) => a + v.value, 0);
                      const table = {
                        head: [prettyKey(facet.key), "Records"],
                        rows: facet.values.map((v) => [v.name, v.value]),
                      };
                      return (
                        <ChartCard
                          key={facet.key}
                          title={prettyKey(facet.key)}
                          unit={`${facet.values.length} values`}
                          headingLevel={3}
                          height={210}
                          source={{ label: current.file, kind: "live" }}
                          summary={`${fmtNumber(total)} records grouped by ${facet.key}`}
                          table={table}
                        >
                          {/* Few categories read best as a donut; more as a
                              ranking, where the labels have room. */}
                          {facet.values.length <= 5 ? (
                            <DonutStat
                              data={facet.values}
                              centerLabel="records"
                              centerValue={fmtCompact(total)}
                              format={(v) => fmtNumber(v)}
                            />
                          ) : (
                            <RankBar
                              data={facet.values}
                              label="Records"
                              format={(v) => fmtNumber(v)}
                              hue={NEUTRAL_HUES[i % NEUTRAL_HUES.length]}
                            />
                          )}
                        </ChartCard>
                      );
                    })}
                  </div>
                ) : (
                  <p
                    style={{
                      fontSize: 12.5,
                      color: "var(--ds-muted)",
                      margin: "0 0 var(--ds-space-5)",
                      maxWidth: "60ch",
                    }}
                  >
                    Nothing to chart here — this file&rsquo;s fields are identifiers, timestamps or free
                    text rather than categories. The raw JSON is below.
                  </p>
                )}

                <details className="ds-panel" style={{ padding: "var(--ds-space-4)" }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontFamily: "var(--ds-font-mono)",
                      fontSize: 12,
                      color: "var(--ds-ink-2)",
                    }}
                  >
                    Raw JSON
                  </summary>
                  {content === null ? (
                    <p style={{ fontSize: 12.5, color: "var(--ds-muted)", marginTop: "var(--ds-space-3)" }}>
                      {kb(contentBytes)} is too large to inline here. Read it from{" "}
                      <code>clients/…/data/{current.file}</code> — the summary above is derived from
                      the whole file.
                    </p>
                  ) : (
                    <pre className="ds-json" style={{ marginTop: "var(--ds-space-3)" }}>
                      {JSON.stringify(content, null, 2)}
                    </pre>
                  )}
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
