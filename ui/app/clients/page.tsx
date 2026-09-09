import Link from "next/link";
import { AppShell } from "../../components/AppShell";
import Ring from "../../components/Ring";
import { getPortfolio } from "../../lib/metrics";
import { countPending } from "../../lib/approvals";
import { fmtCurrency, fmtRatio } from "../../lib/format";

export const dynamic = "force-dynamic";

const STAGE_TONE: Record<string, string> = {
  active: "ds-badge--good",
  won: "ds-badge--good",
  "zero-start": "ds-badge--info",
  prospect: "ds-badge--neutral",
  lead: "ds-badge--neutral",
  audited: "ds-badge--info",
  proposed: "ds-badge--info",
  negotiating: "ds-badge--warn",
  lost: "ds-badge--bad",
  churned: "ds-badge--bad",
};

export default function ClientsTable() {
  const portfolio = getPortfolio();

  return (
    <AppShell breadcrumb={[{ label: "Overview", href: "/" }, { label: "Clients" }]}>
      <div className="ds-page">
        <div className="ds-sec">
          <div>
            <h1 className="ds-page-title">All clients</h1>
            <p className="ds-sec__sub">
              {portfolio.clients.length} on file · {portfolio.activeCount} active. Pipeline state is read
              live from <code>clients/**</code> on every load.
            </p>
          </div>
        </div>

        {/* overflow-x, not overflow:hidden — hidden clipped the right-hand
            columns on a narrow viewport with no way to reach them. */}
        <div className="ds-grid-wrap">
          <table className="ds-grid">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Stage</th>
                <th scope="col">Progress</th>
                <th scope="col">Spend 7d</th>
                <th scope="col">ROAS</th>
                <th scope="col">Flags</th>
                <th scope="col">Next action</th>
                <th scope="col">Approvals</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.clients.map((c) => {
                const pending = countPending(c.slug);
                return (
                  <tr key={c.slug}>
                    <td>
                      <Link href={`/clients/${c.slug}/pipeline`}>{c.name}</Link>
                      <div style={{ fontFamily: "var(--ds-font-mono)", fontSize: 10.5, color: "var(--ds-muted)" }}>
                        {c.slug}
                      </div>
                    </td>
                    <td>
                      <span className={`ds-badge ${STAGE_TONE[c.stage] ?? "ds-badge--neutral"}`}>{c.stage}</span>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--ds-space-2)" }}>
                        <Ring
                          pct={c.completion.pct}
                          size={26}
                          stroke={3}
                          tone={c.completion.blocked ? "warn" : c.completion.pct === 100 ? "good" : "blue"}
                          title={`${c.completion.done} of ${c.completion.total} steps complete`}
                        />
                        <span className="ds-num">{c.completion.pct}%</span>
                      </span>
                    </td>
                    <td className="ds-num">
                      {c.spend7d == null ? "—" : fmtCurrency(c.spend7d, c.currency)}
                    </td>
                    <td className="ds-num">{c.roas7d == null ? "—" : fmtRatio(c.roas7d)}</td>
                    <td>
                      {c.flagCount > 0 ? (
                        <span className="ds-badge ds-badge--warn">{c.flagCount}</span>
                      ) : c.hasPerf ? (
                        <span className="ds-badge ds-badge--good">0</span>
                      ) : (
                        <span style={{ color: "var(--ds-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      {c.nextAction ?? <span style={{ color: "var(--ds-muted)" }}>all steps complete</span>}
                    </td>
                    <td className="ds-num">
                      {pending > 0 ? (
                        <Link href="/approvals" className="ds-badge ds-badge--warn">
                          {pending}
                        </Link>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                );
              })}
              {portfolio.clients.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="ds-empty">
                      <svg aria-hidden="true">
                        <use href="/icons.svg#i-client" />
                      </svg>
                      <p className="ds-empty__title">No clients yet</p>
                      <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0 }}>
                        Run <code>/intake</code> to onboard one.
                      </p>
                    </div>
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
