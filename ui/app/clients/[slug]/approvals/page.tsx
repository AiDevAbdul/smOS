import Link from "next/link";
import ApprovalCard from "../../../../components/approvals/ApprovalCard";
import { listApprovals } from "../../../../lib/approvals";

export const dynamic = "force-dynamic";

export default async function ClientApprovals({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const approvals = listApprovals({ slug });
  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <div>
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {pending.length
          ? `${pending.length} approval${pending.length === 1 ? "" : "s"} pending for ${slug}.`
          : `Nothing pending for ${slug}.`}{" "}
        {/* One decision surface, not two: deciding lives in the global inbox so
            the role/TTL flow has a single implementation. */}
        <Link href="/approvals">Decide in the Approvals inbox →</Link>
      </div>

      {approvals.length ? (
        approvals.map((a) => (
          <ApprovalCard key={a.id} record={a} showSlug={false} decidable={false} />
        ))
      ) : (
        <div className="ds-panel ds-empty" style={{ minHeight: 180 }}>
          <svg aria-hidden="true">
            <use href="/icons.svg#i-check" />
          </svg>
          <p className="ds-empty__title">No approval records for {slug}</p>
          <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0, maxWidth: "48ch" }}>
            Guarded actions file a record here — a budget increase over $500/day, a targeting
            change, or anything destructive.
          </p>
        </div>
      )}
    </div>
  );
}
