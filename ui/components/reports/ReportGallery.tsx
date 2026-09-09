"use client";

/**
 * Thumbnail gallery for a client's rendered reports.
 *
 * The thumbnail is the report itself in a scaled-down iframe rather than a
 * pre-rendered screenshot: reports are self-contained HTML (the renderers
 * inline the design-system CSS), so this shows the real document with no
 * screenshot pipeline to build or keep in sync. Previews are inert
 * (pointer-events: none, tabbing suppressed) so a click lands on the card.
 */

import { useState } from "react";
import { fmtDateTime } from "../../lib/format";

export interface ReportItem {
  /** Stable key and accessible name, e.g. "2026-09-02 / weekly_report". */
  label: string;
  /** Report type parsed off the filename — weekly_report, audit, … */
  type: string;
  /** "2026-09-02", or "hub" for the /bundle public hub. */
  group: string;
  url: string;
  pdfUrl: string | null;
  modifiedAt: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  weekly_report: "Weekly report",
  monthly_review: "Monthly review",
  performance_analysis: "Performance analysis",
  audit_report: "Audit",
  audit: "Audit",
  before_after: "Before / after",
  pre_audit: "Pre-audit",
  research: "Research",
  index: "Client hub",
};

function pretty(type: string): string {
  return TYPE_LABEL[type] ?? type.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function ReportGallery({ reports }: { reports: ReportItem[] }) {
  const [open, setOpen] = useState<ReportItem | null>(null);

  if (reports.length === 0) {
    return (
      <div className="ds-empty" style={{ minHeight: 220 }}>
        <svg aria-hidden="true">
          <use href="/icons.svg#i-report" />
        </svg>
        <p className="ds-empty__title">No reports yet</p>
        <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0, maxWidth: "48ch" }}>
          Run <code>/audit</code>, <code>/report</code>, <code>/analyze</code> or <code>/bundle</code>{" "}
          for this client. Every report skill writes HTML + PDF, and both show up here.
        </p>
      </div>
    );
  }

  // Newest group first; the server already sorted, this only groups.
  const groups: Array<[string, ReportItem[]]> = [];
  for (const r of reports) {
    const last = groups[groups.length - 1];
    if (last && last[0] === r.group) last[1].push(r);
    else groups.push([r.group, [r]]);
  }

  if (open) {
    return (
      <div>
        <div
          className="ds-sec"
          style={{ marginTop: 0, alignItems: "center", gap: "var(--ds-space-3)", flexWrap: "wrap" }}
        >
          <div>
            <h2 className="ds-sec__title">{pretty(open.type)}</h2>
            <p className="ds-sec__sub">{open.label}</p>
          </div>
          <div className="ds-sec__actions">
            {open.pdfUrl && (
              <a className="ds-btn ds-btn--ghost ds-btn--sm" href={open.pdfUrl} target="_blank" rel="noreferrer">
                Open PDF
              </a>
            )}
            <a className="ds-btn ds-btn--ghost ds-btn--sm" href={open.url} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
            <button type="button" className="ds-btn ds-btn--sm" onClick={() => setOpen(null)}>
              Back to all reports
            </button>
          </div>
        </div>
        <div className="ds-panel" style={{ overflow: "hidden" }}>
          <iframe
            title={open.label}
            src={open.url}
            style={{ width: "100%", height: "78vh", border: "none", display: "block" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      {groups.map(([group, items]) => (
        <section key={group} style={{ marginBottom: "var(--ds-space-6)" }}>
          <div className="ds-sec">
            <div>
              <h2 className="ds-sec__title" style={{ fontSize: 18 }}>
                {group === "hub" ? "Client hub (/bundle)" : group}
              </h2>
              <p className="ds-sec__sub">
                {items.length} report{items.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="ds-card-grid">
            {items.map((r) => (
              <article key={r.url} className="ds-report-card">
                <button
                  type="button"
                  className="ds-report-card__shot"
                  onClick={() => setOpen(r)}
                  aria-label={`Open ${pretty(r.type)} — ${r.label}`}
                >
                  <span className="ds-report-card__frame" aria-hidden="true">
                    <iframe
                      title=""
                      src={r.url}
                      loading="lazy"
                      tabIndex={-1}
                      aria-hidden="true"
                      scrolling="no"
                    />
                  </span>
                </button>
                <div className="ds-report-card__meta">
                  <span className="ds-report-card__type">{pretty(r.type)}</span>
                  <span className="ds-report-card__sub">
                    {r.modifiedAt ? fmtDateTime(r.modifiedAt) : r.group}
                  </span>
                  <span className="ds-report-card__links">
                    {r.pdfUrl ? (
                      <a href={r.pdfUrl} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    ) : (
                      <span
                        style={{ color: "var(--ds-muted)" }}
                        title="Only the HTML render is on disk — PDFs are rebuilt by render_pdf.py"
                      >
                        HTML only
                      </span>
                    )}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
