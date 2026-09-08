import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { clientReportsRoot, publicHub } from "../../../../../scripts/lib/paths.js";
import { ReportViewer, type ReportEntry } from "../../../../components/ReportViewer";

export const dynamic = "force-dynamic";

function listDatedReports(slug: string): ReportEntry[] {
  const root = clientReportsRoot(slug);
  if (!existsSync(root)) return [];
  const entries: ReportEntry[] = [];
  for (const dateEntry of readdirSync(root, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) continue;
    const date = dateEntry.name;
    const dateDir = resolve(root, date);
    for (const file of readdirSync(dateDir)) {
      if (!file.endsWith(".html")) continue;
      entries.push({
        label: `${date} / ${file.replace(/\.html$/, "")}`,
        url: `/api/reports/${encodeURIComponent(slug)}/${encodeURIComponent(date)}/${encodeURIComponent(file)}`,
      });
    }
  }
  return entries.sort((a, b) => (a.label < b.label ? 1 : -1));
}

function listPublicHubReports(slug: string): ReportEntry[] {
  // Public hub renders live at public/reports/<slug>/*.html on disk. The
  // /api/reports/_public/<...> route serves publicHub(...segments) verbatim
  // (see app/api/reports/[...path]/route.ts), so the URL must include the
  // "reports" segment explicitly — publicHub(slug) alone (public/<slug>)
  // does not exist.
  const dir = publicHub("reports", slug);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const entries: ReportEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    entries.push({
      label: `hub / ${file.replace(/\.html$/, "")}`,
      url: `/api/reports/_public/reports/${encodeURIComponent(slug)}/${encodeURIComponent(file)}`,
    });
  }
  return entries.sort((a, b) => (a.label < b.label ? 1 : -1));
}

export default async function ClientReports({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const reports = [...listDatedReports(slug), ...listPublicHubReports(slug)];

  return (
    <div className="ds-panel" style={{ padding: "var(--ds-space-5)" }}>
      <ReportViewer reports={reports} />
    </div>
  );
}
