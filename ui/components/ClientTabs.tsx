"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "pipeline", label: "Pipeline" },
  { key: "runs", label: "Runs" },
  { key: "reports", label: "Reports" },
  { key: "data", label: "Data" },
  { key: "approvals", label: "Approvals" },
  { key: "profile", label: "Profile" },
];

export function ClientTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/clients/${encodeURIComponent(slug)}`;

  return (
    <nav className="ds-tabs" aria-label="Client sections">
      {TABS.map((tab) => {
        const href = `${base}/${tab.key}`;
        const isActive = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link key={tab.key} href={href} className={`ds-tab${isActive ? " is-active" : ""}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
