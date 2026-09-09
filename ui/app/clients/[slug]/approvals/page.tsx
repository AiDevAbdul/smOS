import Link from "next/link";
import { fmtDateTime } from "../../../../lib/format";
import { listApprovals } from "../../../../lib/approvals";

export const dynamic = "force-dynamic";

export default async function ClientApprovals({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const approvals = listApprovals({ slug });

  return (
    <div>
      <div className="ds-verdict" style={{ marginTop: 0, fontSize: 15 }}>
        Decide from the global <Link href="/approvals">Approvals inbox →</Link>
      </div>
      <div className="ds-grid-demo">
        <table className="ds-grid">
          <thead>
            <tr>
              <th>Action</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id}>
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
                <td>{fmtDateTime(a.requestedAt)}</td>
              </tr>
            ))}
            {approvals.length === 0 && (
              <tr>
                <td colSpan={4} className="ds-empty">
                  No approval records for {slug}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
