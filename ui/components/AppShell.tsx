/**
 * The app shell. Now a Server Component: it reads the client list, the pending
 * approval count and the skill index on the server, then hands them to the
 * client components that actually need interactivity (RailNav, ClientSwitcher,
 * ThemeToggle, CommandPalette). Previously it was one "use client" component
 * with a hard-coded 4-item nav and no data at all.
 */

import Link from "next/link";
import { listClientSlugs, getClientStatus } from "../lib/status";
import { countPending } from "../lib/approvals";
import { getSkillIndex } from "../lib/skills-manifest";
import { listRuns } from "../lib/registry";
import RailNav, { type NavGroup } from "./RailNav";
import ClientSwitcher, { type SwitcherClient } from "./ClientSwitcher";
import ThemeToggle from "./ThemeToggle";
import TopbarActions from "./TopbarActions";
import { CommandPalette } from "./CommandPalette";
import { clientDisplayName } from "../lib/client-name";

const CLIENT_TABS = [
  { seg: "pipeline", label: "Pipeline", icon: "i-overview" },
  { seg: "runs", label: "Runs", icon: "i-run" },
  { seg: "reports", label: "Reports", icon: "i-report" },
  { seg: "data", label: "Data", icon: "i-data" },
  { seg: "approvals", label: "Approvals", icon: "i-approval" },
  { seg: "profile", label: "Profile", icon: "i-client" },
];

export function AppShell({
  breadcrumb,
  /** Slug of the client being viewed, if any — drives the switcher + client nav group. */
  clientSlug,
  children,
}: {
  breadcrumb?: { label: string; href?: string }[];
  clientSlug?: string;
  children: React.ReactNode;
}) {
  const slugs = listClientSlugs();
  const clients: SwitcherClient[] = slugs.map((slug) => {
    const st = getClientStatus(slug);
    return {
      slug,
      name: clientDisplayName(slug),
      stage: st?.crm_stage || (st?.is_zero_start ? "zero-start" : st?.is_client ? "active" : "prospect"),
    };
  });

  const pending = countPending();
  let liveRuns = 0;
  try {
    liveRuns = listRuns().filter((r) => r.status === "running").length;
  } catch {
    liveRuns = 0;
  }

  const groups: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/", label: "Overview", icon: "i-overview" },
        { href: "/clients", label: "Clients", icon: "i-client" },
        { href: "/approvals", label: "Approvals", icon: "i-approval", badge: pending },
        { href: "/runs", label: "Runs", icon: "i-run", live: liveRuns > 0 },
      ],
    },
  ];

  if (clientSlug) {
    groups.push({
      label: clientDisplayName(clientSlug),
      items: CLIENT_TABS.map((t) => ({
        href: `/clients/${clientSlug}/${t.seg}`,
        label: t.label,
        icon: t.icon,
      })),
    });
  }

  groups.push({
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: "i-settings" }],
  });

  return (
    <div className="ds-app">
      {/* Ambient wash. Fixed and pointer-transparent; content in .ds-main is
          lifted above it by .ds-main > * { z-index: 1 }. */}
      <div className="ds-aurora" aria-hidden="true">
        <span className="ds-aurora__blob" />
        <span className="ds-aurora__blob" />
        <span className="ds-aurora__blob" />
      </div>

      <RailNav groups={groups} />

      <header className="ds-topbar">
        <TopbarActions />
        <div className="ds-breadcrumb">
          {(breadcrumb ?? [{ label: "Overview", href: "/" }]).map((b, i, arr) => (
            <span key={i}>
              {b.href ? <Link href={b.href}>{b.label}</Link> : <span>{b.label}</span>}
              {i < arr.length - 1 && <span className="ds-breadcrumb__sep">/</span>}
            </span>
          ))}
        </div>
        <div className="ds-topbar__spacer" />
        <ClientSwitcher clients={clients} current={clientSlug} />
        <ThemeToggle />
      </header>

      <main className="ds-main" id="main">
        {children}
      </main>

      <footer className="ds-statusbar">
        <span>
          <span className="ds-dot ds-dot--done" />
          &nbsp;smOS Console — local
        </span>
        <span>
          {clients.length} client{clients.length === 1 ? "" : "s"}
        </span>
        {pending > 0 && (
          <span style={{ color: "var(--ds-amber)" }}>
            {pending} approval{pending === 1 ? "" : "s"} pending
          </span>
        )}
        {liveRuns > 0 && (
          <span>
            <span className="ds-dot ds-dot--running" /> {liveRuns} running
          </span>
        )}
      </footer>

      <CommandPalette skills={getSkillIndex()} clients={clients} currentSlug={clientSlug} />
    </div>
  );
}
