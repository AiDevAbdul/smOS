import { notFound } from "next/navigation";
import { getClientStatus } from "../../../../lib/status";

export const dynamic = "force-dynamic";

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
          <ol className="ds-track">
            {section.steps.map((step) => (
              <li key={step.id} className={`ds-step is-${step.status}`}>
                <span>{step.label}</span>
                {step.detail && <span className="ds-kv__hint"> — {step.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <a className="ds-btn ds-btn--primary" href={`/clients/${encodeURIComponent(slug)}/runs`}>
        Run a skill for {slug}
      </a>
    </>
  );
}
