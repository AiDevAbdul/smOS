"use client";

// Phase D headless permission-prompt bridge: while a run started with
// usePermissionBridge is active, mcp/ui-permission-bridge POSTs pending
// tool-use requests to /api/permissions. This banner polls for them and
// gives the operator Allow/Deny — additive to RunConsole, does not touch
// its stream-rendering logic.
import { useEffect, useRef, useState } from "react";

interface PendingPermission {
  id: string;
  runId: string | null;
  toolName: string;
  input: unknown;
  status: "pending" | "decided" | "timeout";
  createdAt: string;
}

export function PermissionBanner({ runId, active }: { runId: string | null; active: boolean }) {
  const [pending, setPending] = useState<PendingPermission[]>([]);
  const [deciding, setDeciding] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!runId || !active) {
      setPending([]);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/permissions?runId=${encodeURIComponent(runId!)}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setPending(json.pending ?? []);
      } catch {
        // transient — next poll will retry
      }
    }
    poll();
    timerRef.current = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [runId, active]);

  async function decide(id: string, behavior: "allow" | "deny") {
    setDeciding(id);
    try {
      await fetch(`/api/permissions/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ behavior }),
      });
      setPending((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setDeciding(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <div style={{ marginBottom: "var(--ds-space-4)" }}>
      {pending.map((p) => (
        <div className="ds-permission-toast" key={p.id}>
          <div className="ds-approval-card__head">
            <span className="ds-approval-card__action">{p.toolName}</span>
            <span className="ds-approval-card__slug">requested {new Date(p.createdAt).toLocaleTimeString()}</span>
          </div>
          <div className="ds-approval-card__summary">
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(p.input, null, 2)}</pre>
          </div>
          <div className="ds-approval-card__actions">
            <button
              className="ds-btn ds-btn--primary ds-btn--sm"
              onClick={() => decide(p.id, "allow")}
              disabled={deciding === p.id}
            >
              Allow
            </button>
            <button
              className="ds-btn ds-btn--danger ds-btn--sm"
              onClick={() => decide(p.id, "deny")}
              disabled={deciding === p.id}
            >
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
