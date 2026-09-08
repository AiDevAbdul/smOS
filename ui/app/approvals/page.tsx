import { AppShell } from "../../components/AppShell";
import { listApprovals } from "../../lib/approvals";

export const dynamic = "force-dynamic";

export default function ApprovalsInbox() {
  const approvals = listApprovals();

  return (
    <AppShell breadcrumb={[{ label: "Approvals" }]}>
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {approvals.filter((a) => a.status === "pending").length} pending across all clients.
        Decisions ship in Phase D (permission + approvals bridge) — this is a read-only view for now.
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
                        ? "ds-badge--caution"
                        : "ds-badge--neutral"
                    }`}
                  >
                    {a.status}
                  </span>
                </td>
                <td>{new Date(a.requestedAt).toLocaleString()}</td>
              </tr>
            ))}
            {approvals.length === 0 && (
              <tr>
                <td colSpan={5} className="ds-empty">
                  No approval records on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
