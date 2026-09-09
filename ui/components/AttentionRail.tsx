import Link from "next/link";
import type { AttentionItem } from "../lib/metrics";
import type { ApprovalRecord } from "../lib/approvals";
import { fmtDateTime } from "../lib/format";

const ICON: Record<AttentionItem["kind"], string> = {
  approval: "i-approval",
  flag: "i-alert",
  publish: "i-report",
  inbox: "i-inbox",
  gate: "i-overview",
};

/**
 * "What needs a human today", in one place. Pending approvals first — those
 * block the optimizer — then optimizer flags, publish failures, SLA breaches
 * and blocked pipeline gates.
 */
export default function AttentionRail({
  items,
  approvals,
}: {
  items: AttentionItem[];
  approvals: ApprovalRecord[];
}) {
  const total = items.length + approvals.length;

  return (
    <aside className="ds-panel" aria-labelledby="attn-title">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--ds-space-2)",
          padding: "var(--ds-space-4) var(--ds-space-4) var(--ds-space-3)",
        }}
      >
        <h2 id="attn-title" className="ds-chart-card__title">
          Needs you
        </h2>
        <span className={`ds-badge ${total ? "ds-badge--warn" : "ds-badge--good"}`} style={{ marginLeft: "auto" }}>
          {total}
        </span>
      </div>

      {total === 0 ? (
        <div className="ds-empty" style={{ minHeight: 160 }}>
          <svg aria-hidden="true">
            <use href="/icons.svg#i-check" />
          </svg>
          <p className="ds-empty__title">Nothing waiting</p>
          <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0 }}>
            No approvals, flags, publish failures or SLA breaches across the portfolio.
          </p>
        </div>
      ) : (
        <div className="ds-attn">
          {approvals.map((a) => (
            <Link key={a.id} className="ds-attn__row ds-attn__row--bad" href="/approvals">
              <svg className="ds-attn__icon" aria-hidden="true">
                <use href="/icons.svg#i-approval" />
              </svg>
              <span style={{ minWidth: 0 }}>
                <span className="ds-attn__title" style={{ display: "block" }}>
                  Approval needed: {a.action}
                </span>
                <span className="ds-attn__meta">
                  {a.slug ?? "agency"}
                  {a.expiresAt ? ` · expires ${fmtDateTime(a.expiresAt)}` : ""}
                </span>
              </span>
            </Link>
          ))}

          {items.map((it, i) => (
            <Link key={`${it.kind}-${i}`} className={`ds-attn__row ds-attn__row--${it.severity}`} href={it.href}>
              <svg className="ds-attn__icon" aria-hidden="true">
                <use href={`/icons.svg#${ICON[it.kind]}`} />
              </svg>
              <span style={{ minWidth: 0 }}>
                <span className="ds-attn__title" style={{ display: "block" }}>
                  {it.title}
                </span>
                <span className="ds-attn__meta">{it.meta}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
