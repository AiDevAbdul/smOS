import { RunConsole } from "../../../runs/RunConsole";
import RunsWorkspace from "../../../../components/runs/RunsWorkspace";
import RunAnalytics from "../../../../components/runs/RunAnalytics";
import { computeRunStats, listRunSummaries } from "../../../../lib/runs";
import { fmtCost, fmtDuration, fmtNumber } from "../../../../lib/format";

export const dynamic = "force-dynamic";

export default async function ClientRuns({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // `?prompt=` is how the Pipeline screen's "Run /x" gate cards hand a
  // pre-filled command to the launcher.
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { slug } = await params;
  const { prompt } = await searchParams;
  const runs = listRunSummaries(slug);
  const stats = computeRunStats(runs);

  return (
    <div>
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        {stats.total
          ? `${fmtNumber(stats.total)} run${stats.total === 1 ? "" : "s"} for ${slug} · ${fmtCost(
              stats.totalCost
            )} · median ${fmtDuration(stats.medianDurationMs)}.`
          : `No runs recorded for ${slug} yet — launch one below.`}
      </div>

      {stats.total > 0 && (
        <div style={{ marginBottom: "var(--ds-space-6)" }}>
          <RunAnalytics stats={stats} />
        </div>
      )}

      <RunsWorkspace
        runs={runs}
        launcher={<RunConsole initialSlug={slug} initialPrompt={prompt ?? ""} />}
      />
    </div>
  );
}
