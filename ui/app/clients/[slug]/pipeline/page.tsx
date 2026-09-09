import { notFound } from "next/navigation";
import Link from "next/link";
import { getClientStatus } from "../../../../lib/status";
import { getSkillIndex } from "../../../../lib/skills-manifest";
import PipelineSection from "../../../../components/pipeline/PipelineSection";
import Ring from "../../../../components/Ring";
import MetricCard from "../../../../components/MetricCard";
import { fmtNumber, fmtPercent, prettifyDetail } from "../../../../lib/format";

export const dynamic = "force-dynamic";

export default async function ClientPipeline({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const status = getClientStatus(slug);
  if (!status) notFound();

  const steps = status.sections.flatMap((s) => s.steps);
  const done = steps.filter((s) => s.status === "done").length;
  const blocked = steps.filter((s) => s.status === "blocked").length;
  const partial = steps.filter((s) => s.status === "partial").length;
  const pct = steps.length ? (done / steps.length) * 100 : 0;

  // Only offer to launch a step that maps to a skill actually bundled here —
  // a "Run /x" button for a skill that isn't installed is a dead end.
  const launchable = new Set(
    getSkillIndex()
      .filter((e) => e.available && e.slug)
      .map((e) => e.slug as string)
  );

  return (
    <div>
      {/* The lede states the next action; its detail goes underneath rather
          than inside the sentence, which turned into nested parentheses
          wrapped around a raw ISO timestamp. */}
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {status.next_action
          ? `Next: ${status.next_action.step}`
          : "All pipeline steps complete."}
      </div>
      {status.next_action && (
        <p
          style={{
            margin: "0 0 var(--ds-space-5)",
            fontSize: 13,
            color: "var(--ds-muted)",
            maxWidth: "80ch",
          }}
        >
          <span
            style={{
              fontFamily: "var(--ds-font-mono)",
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              marginRight: "var(--ds-space-2)",
            }}
          >
            {status.next_action.section}
          </span>
          {prettifyDetail(status.next_action.detail) ?? "No blocking detail recorded."}
        </p>
      )}

      <div className="ds-metric-grid ds-stagger" style={{ marginBottom: "var(--ds-space-6)" }}>
        <MetricCard
          index={0}
          label="Pipeline complete"
          value={fmtPercent(pct, 0)}
          note={`${fmtNumber(done)} of ${fmtNumber(steps.length)} steps`}
          hue={0}
          leading={
            <Ring
              pct={pct}
              size={64}
              stroke={6}
              tone={pct === 100 ? "good" : pct >= 50 ? "blue" : "warn"}
              title={`${Math.round(pct)}% of pipeline steps complete`}
            />
          }
        />
        <MetricCard
          index={1}
          label="Blocked"
          value={fmtNumber(blocked)}
          note={blocked ? "a prerequisite is unmet" : "nothing blocked"}
          hue={blocked ? 3 : 2}
        />
        <MetricCard
          index={2}
          label="Partial"
          value={fmtNumber(partial)}
          note={partial ? "started, not finished" : "nothing half-done"}
          hue={partial ? 2 : 4}
        />
        <MetricCard
          index={3}
          label="Engagement"
          value={status.is_zero_start ? "Zero-start" : "Established"}
          note={status.crm_stage ? `CRM stage: ${status.crm_stage}` : "no CRM deal on file"}
          hue={5}
        />
      </div>

      {status.sections.map((section, i) => (
        <PipelineSection
          key={section.key}
          section={section}
          index={i}
          slug={slug}
          nextStepLabel={status.next_action?.step ?? null}
          launchable={launchable}
        />
      ))}

      <div className="ds-sec" style={{ marginTop: "var(--ds-space-6)" }}>
        <div className="ds-sec__actions">
          <Link className="ds-btn" href={`/clients/${encodeURIComponent(slug)}/runs`}>
            Run a skill for {slug}
          </Link>
        </div>
      </div>
    </div>
  );
}
