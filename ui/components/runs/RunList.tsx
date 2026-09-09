"use client";

/** Left pane of the Runs split: one selectable row per run. */

import { fmtCost, fmtDateTime, fmtDuration } from "../../lib/format";
import type { RunSummary } from "../../lib/runs";

const DOT: Record<string, string> = {
  running: "ds-dot--running",
  done: "ds-dot--done",
  failed: "ds-dot--failed",
};

export default function RunList({
  runs,
  selectedId,
  onSelect,
}: {
  runs: RunSummary[];
  selectedId: string | null;
  onSelect: (runId: string | null) => void;
}) {
  return (
    <div className="ds-run-list" role="listbox" aria-label="Run history">
      <button
        type="button"
        className={`ds-run-list__row${selectedId === null ? " is-selected" : ""}`}
        role="option"
        aria-selected={selectedId === null}
        onClick={() => onSelect(null)}
      >
        <span className="ds-dot" aria-hidden="true" />
        <span style={{ fontWeight: 600 }}>New run</span>
        <span className="ds-run-list__meta">launcher</span>
      </button>

      {runs.map((r) => (
        <button
          type="button"
          key={r.runId}
          className={`ds-run-list__row${selectedId === r.runId ? " is-selected" : ""}`}
          role="option"
          aria-selected={selectedId === r.runId}
          onClick={() => onSelect(r.runId)}
        >
          <span className={`ds-dot ${DOT[r.status] ?? ""}`} aria-hidden="true" />
          <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: r.skill ? "var(--ds-font-mono)" : undefined,
                fontSize: r.skill ? 12.5 : 13,
              }}
            >
              {r.skill ?? (r.prompt.slice(0, 60) || "(empty prompt)")}
            </span>
            <span style={{ fontSize: 11, color: "var(--ds-muted)" }}>
              {/* Absolute, not relative: this row hydrates, and a clock read
                  during hydration disagrees with the server's render. */}
              {[r.slug ?? "no client", fmtDateTime(r.startedAt)].join(" · ")}
            </span>
          </span>
          <span className="ds-run-list__meta">
            {r.status === "running" ? "running" : [fmtDuration(r.durationMs), fmtCost(r.costUsd)].join(" · ")}
          </span>
          {/* Status is never carried by the dot's color alone. */}
          <span className="ds-sr-only">{r.status}</span>
        </button>
      ))}

      {runs.length === 0 && (
        <p style={{ padding: "var(--ds-space-4)", margin: 0, fontSize: 12.5, color: "var(--ds-muted)" }}>
          No runs recorded yet.
        </p>
      )}
    </div>
  );
}
