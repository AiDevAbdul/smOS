"use client";

import { useEffect, useRef, useState } from "react";

interface StreamEvent {
  seq: number;
  data: any;
}

type RunStatus = "idle" | "starting" | "running" | "done" | "failed";

function summarizeEvent(e: any): { kind: string; text: string } | null {
  if (!e || typeof e !== "object") return null;
  if (e.type === "system" && e.subtype === "init") {
    return { kind: "system", text: `session ${e.session_id ?? "?"} · model ${e.model ?? "?"}` };
  }
  if (e.type === "assistant" && e.message?.content) {
    const text = e.message.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
    if (text) return { kind: "assistant", text };
    const toolUse = e.message.content.find((c: any) => c.type === "tool_use");
    if (toolUse) return { kind: "tool_use", text: `${toolUse.name}(${JSON.stringify(toolUse.input)})` };
    return null;
  }
  if (e.type === "user" && e.message?.content) {
    const toolResult = e.message.content.find((c: any) => c.type === "tool_result");
    if (toolResult) {
      const text = Array.isArray(toolResult.content)
        ? toolResult.content.map((c: any) => c.text ?? "").join("")
        : String(toolResult.content ?? "");
      return { kind: "tool_result", text: text.slice(0, 2000) };
    }
    return null;
  }
  if (e.type === "result") {
    return {
      kind: "result",
      text: `${e.subtype ?? "result"} · ${e.num_turns ?? "?"} turns · $${(e.total_cost_usd ?? 0).toFixed(4)} · ${e.duration_ms ?? "?"}ms`,
    };
  }
  if (e.type === "registry_exit") return { kind: "system", text: `process exited (code ${e.code})` };
  if (e.type === "registry_error") return { kind: "system", text: `error: ${e.message}` };
  if (e.type === "registry_stderr") return { kind: "system", text: e.stderr };
  return { kind: "raw", text: JSON.stringify(e) };
}

export function RunConsole({ initialSlug }: { initialSlug: string }) {
  const [slug, setSlug] = useState(initialSlug);
  const [prompt, setPrompt] = useState(initialSlug ? `/analyze ${initialSlug}` : "");
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  function attach(id: string) {
    esRef.current?.close();
    setEvents([]);
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      setEvents((prev) => [...prev, { seq: Number(msg.lastEventId), data }]);
      if (typeof data?.session_id === "string") setSessionId(data.session_id);
      if (data?.type === "registry_exit") {
        setStatus(data.code === 0 ? "done" : "failed");
        es.close();
      }
    };
    es.addEventListener("registry-status", (msg: MessageEvent) => {
      setStatus((msg.data as RunStatus) ?? "done");
      es.close();
    });
    es.onerror = () => {
      // Registry closed the stream normally on completion; EventSource
      // treats that as an error event too, so only surface it if we're
      // still supposed to be running.
      es.close();
    };
    esRef.current = es;
  }

  async function start(resume: boolean) {
    if (!prompt.trim()) return;
    setStatus("starting");
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        slug: slug || null,
        resumeSessionId: resume ? sessionId : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus("failed");
      return;
    }
    setRunId(json.runId);
    setStatus("running");
    attach(json.runId);
  }

  function cancel() {
    if (!runId) return;
    fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
  }

  return (
    <div>
      <div className="ds-run-header">
        <span className="ds-run-header__id">{runId ? runId.slice(0, 8) : "no run yet"}</span>
        <span className={`ds-badge ${status === "running" ? "ds-badge--info" : status === "done" ? "ds-badge--good" : status === "failed" ? "ds-badge--action" : "ds-badge--neutral"}`}>
          {status}
        </span>
        {sessionId && <span className="ds-run-header__id">session {sessionId.slice(0, 8)}</span>}
      </div>

      <div className="ds-field">
        <label className="ds-field__label" htmlFor="slug">
          Client slug (optional)
        </label>
        <input
          id="slug"
          className="ds-input"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="blue-rose-auto"
        />
      </div>

      <div className="ds-field">
        <label className="ds-field__label" htmlFor="prompt">
          Prompt — free text, or a skill route like <code>/analyze {"{slug}"}</code>
        </label>
        <textarea
          id="prompt"
          className="ds-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
      </div>

      <div className="ds-form-row">
        <button className="ds-btn ds-btn--primary" onClick={() => start(false)} disabled={status === "starting" || status === "running"}>
          Start run
        </button>
        <button
          className="ds-btn ds-btn--ghost"
          onClick={() => start(true)}
          disabled={!sessionId || status === "starting" || status === "running"}
        >
          Resume session
        </button>
        <button className="ds-btn ds-btn--danger" onClick={cancel} disabled={status !== "running"}>
          Cancel
        </button>
      </div>

      <div className="ds-stream" role="log" aria-live="polite" style={{ marginTop: "var(--ds-space-5)" }}>
        {events.map((e) => {
          const summary = summarizeEvent(e.data);
          if (!summary) return null;
          if (summary.kind === "tool_use" || summary.kind === "tool_result") {
            return (
              <div className="ds-tool-call" key={e.seq}>
                <div className="ds-tool-call__head">
                  <span className="ds-tool-call__name">{summary.kind}</span>
                </div>
                <div className="ds-tool-call__body">
                  <pre>{summary.text}</pre>
                </div>
              </div>
            );
          }
          return <p key={e.seq}>{summary.text}</p>;
        })}
        {events.length === 0 && <p className="ds-field__hint">No output yet.</p>}
      </div>
    </div>
  );
}
