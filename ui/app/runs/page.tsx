import { AppShell } from "../../components/AppShell";
import { RunConsole } from "./RunConsole";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const { slug } = await searchParams;
  return (
    <AppShell breadcrumb={[{ label: "Runs" }]}>
      <div className="ds-panel">
        <RunConsole initialSlug={slug ?? ""} />
      </div>
    </AppShell>
  );
}
