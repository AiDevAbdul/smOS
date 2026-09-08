"use client";

import { useState } from "react";

export interface ReportEntry {
  label: string;
  url: string;
}

export function ReportViewer({ reports }: { reports: ReportEntry[] }) {
  const [selected, setSelected] = useState(0);
  if (reports.length === 0) {
    return (
      <div className="ds-empty">
        <div className="ds-empty__title">No reports yet</div>
        <p>Run /audit, /report, /analyze, or /bundle for this client to generate one.</p>
      </div>
    );
  }
  const current = reports[selected];

  return (
    <div>
      <div className="ds-form-row" style={{ marginBottom: "var(--ds-space-4)" }}>
        {reports.map((r, i) => (
          <button
            key={r.url}
            className={`ds-file-chip${i === selected ? " is-active" : ""}`}
            style={
              i === selected
                ? { borderColor: "var(--ds-blue)", color: "var(--ds-blue-strong)", cursor: "pointer" }
                : { cursor: "pointer" }
            }
            onClick={() => setSelected(i)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <iframe
        title={current.label}
        src={current.url}
        style={{ width: "100%", height: "80vh", border: "none" }}
      />
    </div>
  );
}
