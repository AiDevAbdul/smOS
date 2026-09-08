import { readFileSync, existsSync } from "node:fs";
import { DATA_FILES, clientData } from "../../../../../scripts/lib/paths.js";
import { JsonViewer } from "../../../../components/JsonViewer";

export const dynamic = "force-dynamic";

interface Entry {
  file: string;
  value: unknown;
}

function loadDataFiles(slug: string): Entry[] {
  const entries: Entry[] = [];
  for (const file of DATA_FILES as string[]) {
    const path = clientData(slug, file);
    if (!existsSync(path)) continue;
    try {
      entries.push({ file, value: JSON.parse(readFileSync(path, "utf8")) });
    } catch {
      entries.push({ file, value: { error: "failed to parse JSON" } });
    }
  }
  return entries;
}

export default async function ClientData({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entries = loadDataFiles(slug);

  if (entries.length === 0) {
    return (
      <div className="ds-empty">
        <div className="ds-empty__title">No handoff data yet</div>
        <p>Nothing under clients/{slug}/data/ has been written by a skill run yet.</p>
      </div>
    );
  }

  return (
    <div>
      {entries.map((e) => (
        <JsonViewer key={e.file} label={e.file} value={e.value} />
      ))}
    </div>
  );
}
