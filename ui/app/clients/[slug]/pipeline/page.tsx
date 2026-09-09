import { notFound } from "next/navigation";
import { getClientStatus } from "../../../../lib/status";

export const dynamic = "force-dynamic";

// ds-badge variant + display label for each status.ts step status. "done"/
// "missing"/"blocked"/"partial" are the known values; anything else (a
// future status string) falls back to a neutral badge showing itself.
const STATUS_BADGE: Record<string, { variant: string; label: string }> = {
  done: { variant: "good", label: "Done" },
  partial: { variant: "warn", label: "Partial" },
  blocked: { variant: "bad", label: "Blocked" },
  missing: { variant: "neutral", label: "Not started" },
};

export default async function ClientPipeline({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const status = getClientStatus(slug);
  if (!status) notFound();

  return (
    <>
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {status.next_action
          ? `Next: ${status.next_action.section} — ${status.next_action.step}`
          : "All pipeline steps complete."}
      </div>
      {status.sections.map((section) => (
        <div key={section.key} className="ds-panel" style={{ marginBottom: "var(--ds-space-6)" }}>
          <div className="pv-h" style={{ marginBottom: "var(--ds-space-3)" }}>
            {section.label}
          </div>
          <div className="ds-sheet">
            {section.steps.map((step) => {
              const badge = STATUS_BADGE[step.status] ?? { variant: "neutral", label: step.status };
              return (
                <div key={step.id} className="ds-sheet__row">
                  <span className="ds-sheet__metric">{step.label}</span>
                  <span className="ds-sheet__read">{step.detail ?? "—"}</span>
                  <span className={`ds-badge ds-badge--${badge.variant}`}>{badge.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <a className="ds-btn ds-btn--primary" href={`/clients/${encodeURIComponent(slug)}/runs`}>
        Run a skill for {slug}
      </a>
    </>
  );
}
