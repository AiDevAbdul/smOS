import { listDataFileSummaries, readDataFile } from "../../../../lib/data-files";
import DataExplorer from "../../../../components/data/DataExplorer";

export const dynamic = "force-dynamic";

/** Above this, the raw JSON pane links to the file instead of inlining it —
 *  a 2 MB inbox.json would otherwise be serialized into the RSC payload. */
const INLINE_LIMIT = 256 * 1024;

export default async function ClientData({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { slug } = await params;
  const { file } = await searchParams;
  const files = listDataFileSummaries(slug);

  // Trust `?file=` only if it exists; otherwise land on the most informative
  // file rather than whichever happens to be first in DATA_FILES — the list
  // starts with baseline_snapshot.json, which has no record array, so the
  // default view was "nothing to chart" even for a client with a full
  // calendar and inbox.
  const best =
    files.find((f) => f.facets.length > 0) ??
    files.find((f) => f.recordCount > 0) ??
    files[0];
  const selected = files.find((f) => f.file === file)?.file ?? best?.file ?? "";
  const current = files.find((f) => f.file === selected) ?? null;
  const inline = current !== null && current.bytes <= INLINE_LIMIT;

  return (
    <DataExplorer
      files={files}
      selected={selected}
      content={inline ? readDataFile(slug, selected) : null}
      contentBytes={current?.bytes ?? 0}
    />
  );
}
