"use client";

/**
 * One approval as a card rather than a table row.
 *
 * A table made every approval look alike; these decisions are not alike. The
 * card carries the action, the client, what expires when, the payload that
 * would actually be executed, and the role the store will demand — so the
 * operator can see what they are approving before they approve it.
 *
 * `destructive_op` and `go_live` get the red rail: per CLAUDE.md they are the
 * owner-level gates, and one of them archives live campaigns.
 */

import { useState } from "react";
import { ApprovalDecision } from "../ApprovalDecision";
import { fmtDateTime } from "../../lib/format";
import type { ApprovalRecord } from "../../lib/approvals";

const DESTRUCTIVE = new Set(["destructive_op", "go_live"]);

const STATUS_BADGE: Record<string, string> = {
  approved: "ds-badge--good",
  pending: "ds-badge--warn",
  rejected: "ds-badge--bad",
  expired: "ds-badge--neutral",
};

/** Human label for the store's action tokens. */
const ACTION_LABEL: Record<string, string> = {
  budget_increase_over_500: "Budget increase over $500/day",
  campaign_launch_over_200: "Campaign launch over $200/day",
  off_hours_action: "Action outside operating hours",
  audience_exclusion_removed: "Audience exclusion removed",
  targeting_change: "Targeting change",
  destructive_op: "Destructive operation",
  go_live: "Go live",
};

function prettyAction(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Expiry, stated as an absolute time and never as a live countdown: a ticking
 * "in 12m" rendered on the server disagrees with the browser a minute later,
 * and this component hydrates.
 */
function expiryNote(rec: ApprovalRecord): string | null {
  if (!rec.expiresAt) return null;
  const t = new Date(rec.expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return `${t < Date.now() ? "expired" : "expires"} ${fmtDateTime(rec.expiresAt)}`;
}

export default function ApprovalCard({
  record,
  showSlug = true,
  decidable = true,
}: {
  record: ApprovalRecord;
  showSlug?: boolean;
  /** False on the client tab, where deciding is centralised in /approvals. */
  decidable?: boolean;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const destructive = DESTRUCTIVE.has(record.action);
  const pending = record.status === "pending";
  const expiry = expiryNote(record);
  const hasPayload = record.payload !== null && record.payload !== undefined;

  return (
    <article
      className={`ds-approval-card${destructive ? " ds-approval-card--destructive" : ""}`}
      style={{ marginBottom: "var(--ds-space-3)" }}
    >
      <header className="ds-approval-card__head">
        <span className="ds-approval-card__action">{prettyAction(record.action)}</span>
        {showSlug && <span className="ds-approval-card__slug">{record.slug ?? "no client"}</span>}
        <span className={`ds-badge ${STATUS_BADGE[record.status] ?? "ds-badge--neutral"}`}>
          {record.status}
        </span>
        {destructive && <span className="ds-badge ds-badge--bad">owner only</span>}
        {expiry && <span className="ds-approval-card__ttl">{expiry}</span>}
      </header>

      <p className="ds-approval-card__summary">{record.summary || "No summary recorded."}</p>

      <div className="ds-kv">
        <div className="ds-kv__row">
          <div className="ds-kv__key">Requested</div>
          <div className="ds-kv__val">
            {fmtDateTime(record.requestedAt)}
            {record.requestedBy ? ` by ${record.requestedBy}` : ""}
          </div>
        </div>
        <div className="ds-kv__row">
          <div className="ds-kv__key">Required role</div>
          <div className="ds-kv__val">{record.requiredRole || "—"}</div>
        </div>
        {record.decidedAt && (
          <div className="ds-kv__row">
            <div className="ds-kv__key">Decided</div>
            <div className="ds-kv__val">
              {fmtDateTime(record.decidedAt)}
              {record.decidedBy ? ` by ${record.decidedBy}` : ""}
            </div>
          </div>
        )}
      </div>

      {hasPayload && (
        <>
          <button
            type="button"
            className="ds-json__toggle"
            aria-expanded={showPayload}
            style={{ marginTop: "var(--ds-space-3)" }}
            onClick={() => setShowPayload((v) => !v)}
          >
            {showPayload ? "▾" : "▸"} Payload that would execute
          </button>
          {showPayload && (
            <pre className="ds-json" style={{ marginTop: "var(--ds-space-2)" }}>
              {JSON.stringify(record.payload, null, 2)}
            </pre>
          )}
        </>
      )}

      {pending && decidable && (
        <div className="ds-approval-card__actions" style={{ display: "block" }}>
          <ApprovalDecision id={record.id} requiredRole={record.requiredRole} />
        </div>
      )}
    </article>
  );
}
