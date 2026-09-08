import { AppShell } from "../components/AppShell";
import { getAllClientStatuses } from "../lib/status";
import { countPending } from "../lib/approvals";

export const dynamic = "force-dynamic";

function badgeForStage(status: { is_client: boolean; is_zero_start: boolean; crm_stage: string | null }) {
  if (!status.is_client) return { cls: "ds-badge--neutral", label: status.crm_stage ?? "prospect" };
  if (status.is_zero_start) return { cls: "ds-badge--neutral", label: "Zero-start" };
  return { cls: "ds-badge--good", label: "Active" };
}

export default function ClientsBoard() {
  const statuses = getAllClientStatuses();

  return (
    <AppShell breadcrumb={[{ label: "Clients" }]}>
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {statuses.length} client{statuses.length === 1 ? "" : "s"} on file — pipeline state read
        live from clients/**/data on every load.
      </div>
      <div className="ds-grid-demo">
        <table className="ds-grid">
          <thead>
            <tr>
              <th>Client</th>
              <th>Stage</th>
              <th>Next action</th>
              <th>Approvals</th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((s) => {
              const badge = badgeForStage(s);
              const pending = countPending(s.slug);
              return (
                <tr key={s.slug}>
                  <td>
                    <a href={`/clients/${s.slug}`}>{s.slug}</a>
                  </td>
                  <td>
                    <span className={`ds-badge ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td>
                    {s.next_action
                      ? `${s.next_action.section} — ${s.next_action.step}`
                      : "all steps complete"}
                  </td>
                  <td>{pending}</td>
                </tr>
              );
            })}
            {statuses.length === 0 && (
              <tr>
                <td colSpan={4} className="ds-empty">
                  No clients yet — run /intake to onboard one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
