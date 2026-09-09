"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionBanner } from "../../components/PermissionBanner";
import { RunStream, type StreamEvent } from "../../components/runs/RunStream";

type RunStatus = "idle" | "starting" | "running" | "done" | "failed";

export function RunConsole({
  initialSlug,
  initialPrompt,
}: {
  initialSlug: string;
  initialPrompt?: string;
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [prompt, setPrompt] = useState(initialPrompt || (initialSlug ? `/analyze ${initialSlug}` : ""));
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [usePermissionBridge, setUsePermissionBridge] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const router = useRouter();

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
        // The run is now in the registry's history; re-render the server
        // component so it shows up in the run list and the cost charts
        // without the operator having to reload.
        router.refresh();
      }
    };
    es.addEventListener("registry-status", (msg: MessageEvent) => {
      setStatus((msg.data as RunStatus) ?? "done");
      es.close();
      router.refresh();
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
        usePermissionBridge,
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
        <span className={`ds-badge ${status === "running" ? "ds-badge--info" : status === "done" ? "ds-badge--good" : status === "failed" ? "ds-badge--bad" : "ds-badge--neutral"}`}>
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

      <div className="ds-form-row" style={{ alignItems: "center" }}>
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
        <label className="ds-field__hint" style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-1)" }}>
          <input
            type="checkbox"
            checked={usePermissionBridge}
            onChange={(e) => setUsePermissionBridge(e.target.checked)}
            disabled={status === "starting" || status === "running"}
          />
          Route tool permissions through this UI (Phase D bridge)
        </label>
      </div>

      <PermissionBanner runId={runId} active={status === "running"} />

      <div style={{ marginTop: "var(--ds-space-5)" }}>
        <RunStream
          events={events}
          live={status === "running"}
          emptyHint={
            status === "starting" ? "Starting the run…" : "No output yet — start a run above."
          }
        />
      </div>
    </div>
  );
}
