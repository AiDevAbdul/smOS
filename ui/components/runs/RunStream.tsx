"use client";

/**
 * Renders a `claude --output-format stream-json` event buffer.
 *
 * Extracted from RunConsole so the launcher and the run-history detail pane
 * show a transcript the same way rather than each parsing the CLI's envelope
 * shape on its own.
 */

import { useEffect, useRef, useState } from "react";
import { fmtCost, fmtDuration, fmtNumber } from "../../lib/format";

export interface StreamEvent {
  seq: number;
  data: unknown;
}

type Row =
  | { kind: "text"; seq: number; tone: "assistant" | "system" | "raw"; text: string }
  | { kind: "tool"; seq: number; name: string; body: string; failed: boolean }
  | { kind: "result"; seq: number; text: string; failed: boolean };

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Flatten a content block list to text, tolerating both shapes the CLI uses. */
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const b = obj(c);
      return typeof b?.text === "string" ? b.text : "";
    })
    .join("");
}

function toRow(e: StreamEvent): Row | null {
  const d = obj(e.data);
  if (!d) return null;
  const seq = e.seq;

  if (d.type === "system" && d.subtype === "init") {
    return {
      kind: "text",
      seq,
      tone: "system",
      text: `session ${String(d.session_id ?? "?").slice(0, 8)} · model ${String(d.model ?? "?")}`,
    };
  }

  if (d.type === "assistant") {
    const message = obj(d.message);
    const content = Array.isArray(message?.content) ? message!.content : [];
    const text = blockText(content);
    if (text.trim()) return { kind: "text", seq, tone: "assistant", text };
    const use = content.map(obj).find((c) => c?.type === "tool_use");
    if (use) {
      return {
        kind: "tool",
        seq,
        name: String(use.name ?? "tool"),
        body: JSON.stringify(use.input ?? {}, null, 2),
        failed: false,
      };
    }
    return null;
  }

  if (d.type === "user") {
    const message = obj(d.message);
    const content = Array.isArray(message?.content) ? message!.content : [];
    const res = content.map(obj).find((c) => c?.type === "tool_result");
    if (!res) return null;
    const text = blockText(res.content);
    return {
      kind: "tool",
      seq,
      name: res.is_error === true ? "tool result · error" : "tool result",
      body: text.slice(0, 4000) || "(no output)",
      failed: res.is_error === true,
    };
  }

  if (d.type === "result") {
    const bits = [
      String(d.subtype ?? "result"),
      d.num_turns == null ? null : `${fmtNumber(Number(d.num_turns))} turns`,
      d.total_cost_usd == null ? null : fmtCost(Number(d.total_cost_usd)),
      d.duration_ms == null ? null : fmtDuration(Number(d.duration_ms)),
    ].filter(Boolean);
    return { kind: "result", seq, text: bits.join(" · "), failed: d.is_error === true };
  }

  if (d.type === "registry_exit") {
    return { kind: "text", seq, tone: "system", text: `process exited (code ${String(d.code)})` };
  }
  if (d.type === "registry_error") {
    return { kind: "text", seq, tone: "system", text: `error: ${String(d.message)}` };
  }
  if (d.type === "registry_stderr") {
    return { kind: "text", seq, tone: "system", text: String(d.stderr) };
  }
  if (d.type === "registry_raw_stdout") {
    return { kind: "text", seq, tone: "raw", text: String(d.line) };
  }
  return null;
}

function ToolCall({ row }: { row: Extract<Row, { kind: "tool" }> }) {
  // Collapsed by default: a tool result can be thousands of lines, and burying
  // the assistant's reasoning under it is what made the old console unreadable.
  const [open, setOpen] = useState(false);
  return (
    <div className={`ds-tool-call${row.failed ? " ds-tool-call--failed" : ""}${open ? "" : " is-collapsed"}`}>
      <button
        type="button"
        className="ds-tool-call__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ds-tool-call__name">{row.name}</span>
        <span className="ds-tool-call__dur">{open ? "hide" : "show"}</span>
      </button>
      <div className="ds-tool-call__body">
        <pre>{row.body}</pre>
      </div>
    </div>
  );
}

export function RunStream({
  events,
  live,
  emptyHint = "No output yet.",
}: {
  events: StreamEvent[];
  live?: boolean;
  emptyHint?: string;
}) {
  const rows = events.map(toRow).filter((r): r is Row => r !== null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Follow the tail only while the operator is already at the bottom —
  // yanking the viewport back down while they read scrollback is worse than
  // not following at all.
  useEffect(() => {
    if (live && pinned) endRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, live, pinned]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }

  return (
    <div
      className="ds-stream"
      role="log"
      aria-live={live ? "polite" : "off"}
      ref={scrollRef}
      onScroll={onScroll}
    >
      {rows.map((row) => {
        if (row.kind === "tool") return <ToolCall key={row.seq} row={row} />;
        if (row.kind === "result") {
          return (
            <p key={row.seq}>
              <span className={`ds-badge ${row.failed ? "ds-badge--bad" : "ds-badge--good"}`}>
                {row.text}
              </span>
            </p>
          );
        }
        return (
          <p
            key={row.seq}
            style={
              row.tone === "assistant"
                ? undefined
                : { color: "var(--ds-muted)", font: "12px/1.6 var(--ds-font-mono)" }
            }
          >
            {row.text}
          </p>
        );
      })}
      {rows.length === 0 && <p style={{ color: "var(--ds-muted)" }}>{emptyHint}</p>}
      {live && (
        <p style={{ color: "var(--ds-muted)", font: "12px/1.6 var(--ds-font-mono)" }} aria-hidden="true">
          <span className="ds-dot ds-dot--running" /> streaming…
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}
