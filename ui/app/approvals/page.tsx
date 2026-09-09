import { AppShell } from "../../components/AppShell";
import MetricCard from "../../components/MetricCard";
import ApprovalCard from "../../components/approvals/ApprovalCard";
import { listApprovals } from "../../lib/approvals";
import { fmtNumber } from "../../lib/format";

export const dynamic = "force-dynamic";

export default function ApprovalsInbox() {
  const approvals = listApprovals();
  const pending = approvals.filter((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");
  const owner = pending.filter((a) => a.requiredRole === "owner");
  // An expired-but-still-pending record can never be approved — the store's
  // decide() is fail-closed on TTL — so it is surfaced separately rather than
  // sitting in the queue looking actionable.
  const now = Date.now();
  const stale = pending.filter((a) => a.expiresAt && new Date(a.expiresAt).getTime() < now);
  const live = pending.filter((a) => !stale.includes(a));

  return (
    <AppShell breadcrumb={[{ label: "Overview", href: "/" }, { label: "Approvals" }]}>
      <div className="ds-page">
        <div className="ds-sec">
          <div>
            <h1 className="ds-page-title">Approvals</h1>
            <p className="ds-sec__sub">
              Decisions go through the fail-closed approvals state machine — role checks, TTL expiry
              and an audit log. Nothing here is executed by this screen; approving unblocks the run
              that asked.
            </p>
          </div>
        </div>

        <div className="ds-metric-grid ds-stagger">
          <MetricCard
            index={0}
            label="Awaiting decision"
            value={fmtNumber(live.length)}
            note={live.length ? "across all clients" : "queue is clear"}
            hue={live.length ? 2 : 1}
          />
          <MetricCard
            index={1}
            label="Owner-level"
            value={fmtNumber(owner.length)}
            note={owner.length ? "destructive or go-live" : "none pending"}
            hue={owner.length ? 3 : 4}
          />
          <MetricCard
            index={2}
            label="Expired unactioned"
            value={fmtNumber(stale.length)}
            note={stale.length ? "past TTL — must be re-requested" : "none lapsed"}
            hue={stale.length ? 3 : 6}
          />
          <MetricCard
            index={3}
            label="Decided"
            value={fmtNumber(decided.length)}
            note="on file"
            hue={5}
          />
        </div>

        <section>
          <div className="ds-sec">
            <div>
              <h2 className="ds-sec__title">Waiting on you</h2>
              <p className="ds-sec__sub">
                {live.length
                  ? "Expand a card's payload to see exactly what would execute."
                  : "Nothing is waiting."}
              </p>
            </div>
          </div>
          {live.length ? (
            live.map((a) => <ApprovalCard key={a.id} record={a} />)
          ) : (
            <div className="ds-panel ds-empty" style={{ minHeight: 160 }}>
              <svg aria-hidden="true">
                <use href="/icons.svg#i-check" />
              </svg>
              <p className="ds-empty__title">No pending approvals</p>
              <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0 }}>
                A guarded action (budget over $500/day, targeting change, destructive op) files a
                record here when a run hits it.
              </p>
            </div>
          )}
        </section>

        {stale.length > 0 && (
          <section>
            <div className="ds-sec">
              <div>
                <h2 className="ds-sec__title">Lapsed</h2>
                <p className="ds-sec__sub">
                  Past their TTL. The store refuses these even if approved now — the run has to ask
                  again.
                </p>
              </div>
            </div>
            {stale.map((a) => (
              <ApprovalCard key={a.id} record={a} decidable={false} />
            ))}
          </section>
        )}

        {decided.length > 0 && (
          <section>
            <div className="ds-sec">
              <div>
                <h2 className="ds-sec__title">History</h2>
                <p className="ds-sec__sub">{decided.length} decided records.</p>
              </div>
            </div>
            {decided.map((a) => (
              <ApprovalCard key={a.id} record={a} decidable={false} />
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
