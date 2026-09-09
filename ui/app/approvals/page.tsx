import { AppShell } from "../../components/AppShell";
import { fmtDateTime } from "../../lib/format";
import { listApprovals } from "../../lib/approvals";
import { ApprovalDecision } from "../../components/ApprovalDecision";

export const dynamic = "force-dynamic";

export default function ApprovalsInbox() {
  const approvals = listApprovals();
  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <AppShell breadcrumb={[{ label: "Overview", href: "/" }, { label: "Approvals" }]}>
      <div className="ds-page">
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {pendingCount} pending across all clients. Approve or deny directly below — decisions
        go through the fail-closed approvals state machine (role checks, TTL expiry, audit log).
      </div>
      <div className="ds-grid-demo">
        <table className="ds-grid">
          <thead>
            <tr>
              <th>Client</th>
              <th>Action</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Requested</th>
              {pendingCount > 0 && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
                <td>{a.slug ?? "—"}</td>
                <td>{a.action}</td>
                <td>{a.summary}</td>
                <td>
                  <span
                    className={`ds-badge ${
                      a.status === "approved"
                        ? "ds-badge--good"
                        : a.status === "pending"
                        ? "ds-badge--warn"
                        : "ds-badge--neutral"
                    }`}
                  >
                    {a.status}
                  </span>
                </td>
                <td>{fmtDateTime(a.requestedAt)}</td>
                {pendingCount > 0 && (
                  <td>
                    {a.status === "pending" ? (
                      <ApprovalDecision id={a.id} requiredRole={a.requiredRole} />
                    ) : null}
                  </td>
                )}
              </tr>
            ))}
            {approvals.length === 0 && (
              <tr>
                <td colSpan={pendingCount > 0 ? 6 : 5} className="ds-empty">
                  No approval records on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </div>
    </AppShell>
  );
}
