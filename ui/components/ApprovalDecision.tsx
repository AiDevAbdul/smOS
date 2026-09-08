"use client";

// Approve/Deny controls for one pending approval row. Posts to
// /api/approvals/:id/decide (which calls scripts/lib/approvals.js's
// fail-closed decide()), then router.refresh() so the server-rendered table
// re-reads data/approvals/*.json. Kept deliberately small — no client-side
// approval state, the filesystem store stays the single source of truth.
import { useState } from "react";
import { useRouter } from "next/navigation";

// Mirrors scripts/lib/approvals.js ROLES (lowest → highest authority).
const ROLES = ["viewer", "analyst", "manager", "owner"];

export function ApprovalDecision({
  id,
  requiredRole,
}: {
  id: string;
  requiredRole?: string;
}) {
  const router = useRouter();
  const [role, setRole] = useState(requiredRole && ROLES.includes(requiredRole) ? requiredRole : "manager");
  const [decidedBy, setDecidedBy] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: "approved" | "rejected") {
    setPending(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          decidedBy: decidedBy.trim() || undefined,
          role,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `request failed (${res.status})`);
        setPending(null);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="ds-form-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <div className="ds-field" style={{ margin: 0, minWidth: 96 }}>
        <label className="ds-field__label" htmlFor={`role-${id}`}>
          Role
        </label>
        <select
          id={`role-${id}`}
          className="ds-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="ds-field" style={{ margin: 0, minWidth: 120 }}>
        <label className="ds-field__label" htmlFor={`by-${id}`}>
          Decided by
        </label>
        <input
          id={`by-${id}`}
          className="ds-input"
          value={decidedBy}
          onChange={(e) => setDecidedBy(e.target.value)}
          placeholder="you"
        />
      </div>
      <div className="ds-field" style={{ margin: 0, minWidth: 160, flex: 1 }}>
        <label className="ds-field__label" htmlFor={`note-${id}`}>
          Note (optional)
        </label>
        <input
          id={`note-${id}`}
          className="ds-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="reason"
        />
      </div>
      <button
        className="ds-btn ds-btn--primary ds-btn--sm"
        onClick={() => submit("approved")}
        disabled={pending !== null}
      >
        Approve
      </button>
      <button
        className="ds-btn ds-btn--danger ds-btn--sm"
        onClick={() => submit("rejected")}
        disabled={pending !== null}
      >
        Deny
      </button>
      {error && <div className="ds-field__error" style={{ flexBasis: "100%" }}>{error}</div>}
    </div>
  );
}
