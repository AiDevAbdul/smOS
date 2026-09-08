import { AppShell } from "../../../components/AppShell";
import { ClientTabs } from "../../../components/ClientTabs";

export default async function ClientLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;

  return (
    <AppShell breadcrumb={[{ label: "Clients", href: "/" }, { label: slug }]}>
      <ClientTabs slug={slug} />
      <div style={{ marginTop: "var(--ds-space-5)" }}>{children}</div>
    </AppShell>
  );
}
