"use client";

/**
 * Detail pane for one selected run.
 *
 * Two cases, and conflating them would be dishonest:
 *   - a live run (still in the registry) has its full event buffer, so the
 *     transcript replays and a running one keeps streaming;
 *   - an archived run was rehydrated from logs/ui-runs.jsonl after a restart.
 *     Its outcome survived; its transcript did not. Rendering an empty stream
 *     would imply the run produced no output, so the pane says what happened
 *     instead.
 */

import { useEffect, useRef, useState } from "react";
import { fmtCost, fmtDateTime, fmtDuration, fmtNumber } from "../../lib/format";
import type { RunSummary } from "../../lib/runs";
import { RunStream, type StreamEvent } from "./RunStream";

const STATUS_BADGE: Record<string, string> = {
  running: "ds-badge--info",
  done: "ds-badge--good",
  failed: "ds-badge--bad",
};

export default function RunDetail({ run }: { run: RunSummary }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [live, setLive] = useState(run.status === "running");
  const esRef = useRef<EventSource | null>(null);

  // Replay (and, for a running run, keep following) the registry's event
  // buffer. Archived runs have no buffer to ask for, so don't open a stream.
  useEffect(() => {
    setEvents([]);
    setLive(run.status === "running");
    if (run.archived) return;

    const es = new EventSource(`/api/runs/${run.runId}/stream`);
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      setEvents((prev) => [...prev, { seq: Number(msg.lastEventId), data }]);
      if (data?.type === "registry_exit") {
        setLive(false);
        es.close();
      }
    };
    es.addEventListener("registry-status", () => {
      setLive(false);
      es.close();
    });
    es.onerror = () => es.close();
    esRef.current = es;
    return () => es.close();
  }, [run.runId, run.archived, run.status]);

  const facts: Array<[string, string]> = [
    ["Status", run.status + (run.isError ? " · reported an error" : "")],
    ["Started", fmtDateTime(run.startedAt)],
    ["Ended", run.endedAt ? fmtDateTime(run.endedAt) : "—"],
    ["Duration", fmtDuration(run.durationMs)],
    ["Cost", fmtCost(run.costUsd)],
    ["Turns", run.numTurns == null ? "—" : fmtNumber(run.numTurns)],
    ["Exit code", run.exitCode == null ? "—" : String(run.exitCode)],
    ["Client", run.slug ?? "—"],
    ["Session", run.sessionId ? run.sessionId.slice(0, 8) : "—"],
  ];

  return (
    <div>
      <div className="ds-run-header">
        <span className="ds-run-header__id">{run.runId.slice(0, 8)}</span>
        <span className={`ds-badge ${STATUS_BADGE[run.status] ?? "ds-badge--neutral"}`}>{run.status}</span>
        {run.skill && <span className="ds-badge ds-badge--neutral">{run.skill}</span>}
        {run.archived && (
          <span className="ds-badge ds-badge--neutral" title="Rehydrated from logs/ui-runs.jsonl">
            archived
          </span>
        )}
      </div>

      <div className="ds-panel" style={{ padding: "var(--ds-space-4)", marginBottom: "var(--ds-space-4)" }}>
        <div className="ds-eyebrow" style={{ marginBottom: "var(--ds-space-2)" }}>
          Prompt
        </div>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            font: "12.5px/1.6 var(--ds-font-mono)",
            color: "var(--ds-ink)",
          }}
        >
          {run.prompt || "—"}
        </pre>
      </div>

      <div className="ds-kv" style={{ marginBottom: "var(--ds-space-4)" }}>
        {facts.map(([k, v]) => (
          <div className="ds-kv__row" key={k}>
            <div className="ds-kv__key">{k}</div>
            <div className="ds-kv__val">{v}</div>
          </div>
        ))}
      </div>

      {run.archived ? (
        <>
          {run.finalText && (
            <div className="ds-panel" style={{ padding: "var(--ds-space-4)", marginBottom: "var(--ds-space-4)" }}>
              <div className="ds-eyebrow" style={{ marginBottom: "var(--ds-space-2)" }}>
                Final message
              </div>
              <div className="ds-stream" style={{ maxHeight: 320 }}>
                <p>{run.finalText}</p>
              </div>
            </div>
          )}
          <div className="ds-empty" style={{ minHeight: 120 }}>
            <p className="ds-empty__title">Transcript not retained</p>
            <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0, maxWidth: "52ch" }}>
              This run finished before the current server process started. Its outcome, cost and
              final message are archived in <code>logs/ui-runs.jsonl</code>
              {run.eventCount ? ` (${fmtNumber(run.eventCount)} events at the time)` : ""}, but the
              event-by-event stream is only kept in memory.
              {run.sessionId ? " Resume the session to continue the conversation." : ""}
            </p>
          </div>
        </>
      ) : (
        <RunStream events={events} live={live} />
      )}
    </div>
  );
}
