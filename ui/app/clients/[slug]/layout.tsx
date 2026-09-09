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
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
