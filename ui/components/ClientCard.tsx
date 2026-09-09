import Link from "next/link";
import Ring from "./Ring";
import { fmtCurrency, fmtRatio } from "../lib/format";
import type { PortfolioClient } from "../lib/metrics";

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

export default function ClientCard({ client, index = 0 }: { client: PortfolioClient; index?: number }) {
  const c = client;
  const initials = c.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <Link
      className="ds-client-card"
      href={`/clients/${c.slug}/pipeline`}
      style={{ ["--ds-i" as string]: index }}
    >
      <div className="ds-client-card__head">
        <span className="ds-client-card__avatar" aria-hidden="true">
          {initials}
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="ds-client-card__name" style={{ display: "block" }}>
            {c.name}
          </span>
          <span className="ds-client-card__slug">{c.slug}</span>
        </span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--ds-space-2)" }}>
          {c.flagCount > 0 && (
            <span className="ds-badge ds-badge--warn" title={`${c.flagCount} optimizer flags`}>
              {c.flagCount} flag{c.flagCount === 1 ? "" : "s"}
            </span>
          )}
          <span className={`ds-badge ${STAGE_TONE[c.stage] ?? "ds-badge--neutral"}`}>{c.stage}</span>
        </span>
      </div>

      <div className="ds-client-card__metrics">
        <Ring
          pct={c.completion.pct}
          size={40}
          stroke={4}
          tone={c.completion.blocked ? "warn" : c.completion.pct === 100 ? "good" : "blue"}
          label={`${c.completion.pct}`}
          title={`${c.completion.done} of ${c.completion.total} pipeline steps complete${
            c.completion.blocked ? `, ${c.completion.blocked} blocked` : ""
          }`}
        />

        {/* Paid metrics only exist once /analyze has run. Rather than showing
            zeros that look like real bad performance, say what's missing. */}
        {c.hasPerf && c.spend7d != null ? (
          <>
            <span className="ds-client-card__metric">
              <span className="ds-client-card__metric-label">Spend 7d</span>
              <span className="ds-client-card__metric-value">{fmtCurrency(c.spend7d, c.currency)}</span>
            </span>
            <span className="ds-client-card__metric">
              <span className="ds-client-card__metric-label">ROAS</span>
              <span className="ds-client-card__metric-value">{fmtRatio(c.roas7d)}</span>
            </span>
          </>
        ) : (
          <span className="ds-client-card__metric">
            <span className="ds-client-card__metric-label">Paid</span>
            <span style={{ fontSize: 12.5, color: "var(--ds-muted)" }}>
              no /analyze data yet
            </span>
          </span>
        )}
      </div>

      <div className="ds-client-card__next">
        <span className="ds-client-card__next-label">Next</span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={c.nextAction ?? undefined}
        >
          {c.nextAction ?? "All steps complete"}
        </span>
      </div>
    </Link>
  );
}
