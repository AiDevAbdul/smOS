import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { clientReportsRoot, publicHub } from "../../../../../scripts/lib/paths.js";
import ReportGallery, { type ReportItem } from "../../../../components/reports/ReportGallery";

export const dynamic = "force-dynamic";

function mtime(path: string): string | null {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}

/** clients/<slug>/reports/<date>/<type>.html, with its PDF sibling if rendered. */
function listDatedReports(slug: string): ReportItem[] {
  const root = clientReportsRoot(slug);
  if (!existsSync(root)) return [];
  const items: ReportItem[] = [];
  for (const dateEntry of readdirSync(root, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) continue;
    const date = dateEntry.name;
    const dateDir = resolve(root, date);
    for (const file of readdirSync(dateDir)) {
      if (!file.endsWith(".html")) continue;
      const type = file.replace(/\.html$/, "");
      const base = `/api/reports/${encodeURIComponent(slug)}/${encodeURIComponent(date)}`;
      // PDFs are gitignored but present on disk when render_pdf.py has run;
      // don't advertise a link to one that isn't there.
      const pdfOnDisk = existsSync(resolve(dateDir, `${type}.pdf`));
      items.push({
        label: `${date} / ${type}`,
        type,
        group: date,
        url: `${base}/${encodeURIComponent(file)}`,
        pdfUrl: pdfOnDisk ? `${base}/${encodeURIComponent(`${type}.pdf`)}` : null,
        modifiedAt: mtime(resolve(dateDir, file)),
      });
    }
  }
  return items;
}

/** The /bundle hub renders to public/reports/<slug>/*.html. */
function listPublicHubReports(slug: string): ReportItem[] {
  // The /api/reports/_public/<...> route resolves publicHub(...segments)
  // verbatim, so the URL must include the "reports" segment explicitly —
  // publicHub(slug) alone (public/<slug>) does not exist.
  const dir = publicHub("reports", slug);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const items: ReportItem[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    const type = file.replace(/\.html$/, "");
    const base = `/api/reports/_public/reports/${encodeURIComponent(slug)}`;
    items.push({
      label: `hub / ${type}`,
      type,
      group: "hub",
      url: `${base}/${encodeURIComponent(file)}`,
      pdfUrl: existsSync(resolve(dir, `${type}.pdf`))
        ? `${base}/${encodeURIComponent(`${type}.pdf`)}`
        : null,
      modifiedAt: mtime(resolve(dir, file)),
    });
  }
  return items;
}

export default async function ClientReports({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dated = listDatedReports(slug).sort((a, b) =>
    a.group === b.group ? a.type.localeCompare(b.type) : b.group.localeCompare(a.group)
  );
  // The hub is a rollup of everything above, so it belongs last, not
  // interleaved by date.
  const reports = [...dated, ...listPublicHubReports(slug)];

  return <ReportGallery reports={reports} />;
}
