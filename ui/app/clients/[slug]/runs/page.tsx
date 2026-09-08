import { RunConsole } from "../../../runs/RunConsole";

export default async function ClientRuns({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div className="ds-panel">
      <RunConsole initialSlug={slug} />
    </div>
  );
}
