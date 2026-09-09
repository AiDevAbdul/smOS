import { AppShell } from "../../../components/AppShell";
import { ClientTabs } from "../../../components/ClientTabs";
import { clientDisplayName } from "../../../lib/client-name";

export default async function ClientLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;

  return (
    <AppShell
      clientSlug={slug}
      breadcrumb={[
        { label: "Overview", href: "/" },
        { label: "Clients", href: "/clients" },
        { label: clientDisplayName(slug) },
      ]}
    >
      <div className="ds-page">
        <ClientTabs slug={slug} />
        {/* Every client tab needs a document heading it can nest under.
            Without it the tab bodies started at h2/h3, so each page was a
            heading hierarchy with no top — and the tab content's own sections
            read as top-level. */}
        <h1 className="ds-page-title">
          {clientDisplayName(slug)}
        </h1>
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
