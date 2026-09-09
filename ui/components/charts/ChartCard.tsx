"use client";

/**
 * The wrapper every Console chart goes through. It owns the four states the
 * design system's chart checklist demands — loading, empty, error, and a
 * keyboard/screen-reader accessible data table — so no individual chart has
 * to reimplement them, and none can skip them.
 *
 * Height is reserved by the card, not the chart, so async data can't shift
 * layout (CLS).
 */

import { useId, useState, type ReactNode } from "react";

export interface ChartCardProps {
  title: string;
  /** Mono caption beside the title — units, or the metric pair being plotted. */
  unit?: string;
  /** Provenance of the numbers. Charts that can't say where their data came
   *  from are not trustworthy, so this renders as a visible chip. */
  source?: { label: string; kind?: "live" | "approx" | "plain" };
  /** Right-aligned controls (a range switcher, a legend toggle). */
  actions?: ReactNode;
  /** One-line takeaway; also becomes the chart's accessible summary. */
  summary?: string;
  height?: number;
  loading?: boolean;
  error?: string | null;
  /** When empty, the card explains what to run instead of drawing an axis. */
  empty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** Rows powering the "Show table" fallback: header row first. */
  table?: { head: string[]; rows: Array<Array<string | number>> };
  /** Heading level for the card title. Defaults to 2; pass 3 when the card
   *  genuinely sits under an h2 section heading. Skipping a level is an
   *  accessibility failure, not a styling choice — the CSS class fixes the
   *  size either way. */
  headingLevel?: 2 | 3 | 4;
  children: ReactNode;
}

export default function ChartCard({
  title,
  unit,
  source,
  actions,
  summary,
  height = 240,
  loading = false,
  error = null,
  empty = false,
  emptyTitle = "No data yet",
  emptyHint,
  table,
  headingLevel = 2,
  children,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";

  const sourceClass =
    source?.kind === "live"
      ? "ds-source-chip ds-source-chip--live"
      : source?.kind === "approx"
        ? "ds-source-chip ds-source-chip--approx"
        : "ds-source-chip";

  return (
    <section
      className="ds-chart-card"
      aria-labelledby={titleId}
      style={{ ["--ds-chart-h" as string]: `${height}px` }}
    >
      <header className="ds-chart-card__head">
        <Heading className="ds-chart-card__title" id={titleId}>
          {title}
        </Heading>
        {unit && <span className="ds-chart-card__unit">{unit}</span>}
        {source && <span className={sourceClass}>{source.label}</span>}
        {actions && <div className="ds-chart-card__actions">{actions}</div>}
      </header>

      <div className="ds-chart-card__body">
        {loading ? (
          <div className="ds-skeleton" style={{ height, borderRadius: "var(--ds-r-sm)" }} aria-busy="true" />
        ) : error ? (
          <div className="ds-empty" style={{ minHeight: height }}>
            <svg aria-hidden="true">
              <use href="/icons.svg#i-alert" />
            </svg>
            <p className="ds-empty__title">Couldn&rsquo;t load this chart</p>
            <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0 }}>{error}</p>
          </div>
        ) : empty ? (
          <div className="ds-empty" style={{ minHeight: height }}>
            <svg aria-hidden="true">
              <use href="/icons.svg#i-trend" />
            </svg>
            <p className="ds-empty__title">{emptyTitle}</p>
            {emptyHint && (
              <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0, maxWidth: "42ch" }}>
                {emptyHint}
              </p>
            )}
          </div>
        ) : (
          <figure style={{ margin: 0, height }} role="img" aria-label={summary || title}>
            {children}
          </figure>
        )}
      </div>

      {(summary || table) && !loading && !error && !empty && (
        <footer className="ds-chart-card__foot">
          {summary && <span>{summary}</span>}
          {table && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost ds-btn--sm"
              style={{ marginLeft: "auto" }}
              aria-expanded={showTable}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? "Hide table" : "Show table"}
            </button>
          )}
        </footer>
      )}

      {/* Charts alone aren't screen-reader friendly; the table is the accessible
          equivalent and doubles as the exact-value readout. */}
      {showTable && table && (
        <div className="ds-chart-card__table">
          <table className="ds-grid">
            <caption className="ds-sr-only">{`${title} — data table`}</caption>
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j > 0 ? "ds-num" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
