import { AppShell } from "../../components/AppShell";
import MetricCard from "../../components/MetricCard";
import RunsWorkspace from "../../components/runs/RunsWorkspace";
import RunAnalytics from "../../components/runs/RunAnalytics";
import { RunConsole } from "./RunConsole";
import { computeRunStats, listRunSummaries } from "../../lib/runs";
import { getSkillIndex } from "../../lib/skills-manifest";
import { fmtCost, fmtDuration, fmtNumber, fmtPercent } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string; prompt?: string; skill?: string }>;
}) {
  const { slug, prompt, skill } = await searchParams;
  const runs = listRunSummaries();
  const skills = getSkillIndex();
  const stats = computeRunStats(runs);
  const failRate = stats.total ? (stats.failed / stats.total) * 100 : null;

  return (
    <AppShell breadcrumb={[{ label: "Overview", href: "/" }, { label: "Runs" }]}>
      <div className="ds-page">
        <div className="ds-sec">
          <div>
            <h1 className="ds-page-title">Runs</h1>
            <p className="ds-sec__sub">
              Every skill launched from this console. Live runs stream here; finished ones are
              archived to <code>logs/ui-runs.jsonl</code> so cost and duration survive a restart.
            </p>
          </div>
        </div>

        <div className="ds-metric-grid ds-stagger">
          <MetricCard
            index={0}
            label="Runs recorded"
            value={fmtNumber(stats.total)}
            note={stats.running ? `${stats.running} running now` : `${fmtNumber(stats.done)} completed`}
            hue={0}
          />
          <MetricCard
            index={1}
            label="Total cost"
            value={fmtCost(stats.totalCost)}
            note={
              stats.costed === stats.total
                ? "as reported by the CLI"
                : `${fmtNumber(stats.total - stats.costed)} run${
                    stats.total - stats.costed === 1 ? "" : "s"
                  } reported no cost`
            }
            hue={5}
          />
          <MetricCard
            index={2}
            label="Median duration"
            value={fmtDuration(stats.medianDurationMs)}
            note={`${fmtNumber(stats.totalTurns)} turns across all runs`}
            hue={4}
          />
          <MetricCard
            index={3}
            label="Failed"
            value={fmtNumber(stats.failed)}
            note={failRate === null ? "no runs yet" : `${fmtPercent(failRate, 0)} of all runs`}
            hue={stats.failed ? 3 : 2}
          />
        </div>

        <RunAnalytics stats={stats} />

        <div>
          <div className="ds-sec">
            <div>
              <h2 className="ds-sec__title">Console</h2>
              <p className="ds-sec__sub">
                Pick a run to replay it, or start a new one. Tool calls are collapsed by default.
              </p>
            </div>
          </div>
          <RunsWorkspace
            runs={runs}
            launcher={
              <RunConsole
                initialSlug={slug ?? ""}
                initialPrompt={prompt ?? ""}
                initialSkill={skill ?? ""}
                skills={skills}
              />
            }
          />
        </div>
      </div>
    </AppShell>
  );
}
