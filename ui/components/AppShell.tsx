"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette, OPEN_COMMAND_PALETTE_EVENT } from "./CommandPalette";

const NAV = [
  { href: "/", label: "Clients", icon: "i-home" },
  { href: "/approvals", label: "Approvals", icon: "i-approval" },
  { href: "/runs", label: "Runs", icon: "i-run" },
  { href: "/settings", label: "Settings", icon: "i-settings" },
];

export function AppShell({
  breadcrumb,
  children,
}: {
  breadcrumb?: { label: string; href?: string }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="ds-app">
      <nav className="ds-rail" aria-label="Primary">
        <div className="ds-client-switcher">
          <svg width={16} height={16}>
            <use href="/icons.svg#i-client" />
          </svg>
          smOS
        </div>
        <div className="ds-nav-group">Overview</div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`ds-nav-item${pathname === item.href ? " is-active" : ""}`}
          >
            <svg>
              <use href={`/icons.svg#${item.icon}`} />
            </svg>
            <span className="ds-nav-item__label">{item.label}</span>
          </Link>
        ))}
      </nav>
      <header className="ds-topbar">
        <div className="ds-breadcrumb">
          {(breadcrumb ?? [{ label: "Clients", href: "/" }]).map((b, i, arr) => (
            <span key={i}>
              {b.href ? <Link href={b.href}>{b.label}</Link> : <span>{b.label}</span>}
              {i < arr.length - 1 && <span className="ds-breadcrumb__sep">/</span>}
            </span>
          ))}
        </div>
        <div className="ds-topbar__spacer" />
        <button
          type="button"
          className="ds-client-switcher"
          style={{ height: "var(--ds-control-sm)" }}
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
        >
          <svg width={14} height={14}>
            <use href="/icons.svg#i-run" />
          </svg>
          Run a skill
          <span className="ds-palette__cmd" aria-hidden="true">
            ⌘K
          </span>
        </button>
      </header>
      <main className="ds-main">{children}</main>
      <footer className="ds-statusbar">
        <span>
          <span className="ds-dot ds-dot--done" />
          &nbsp;smOS Console — local
        </span>
      </footer>
      <CommandPalette />
    </div>
  );
}
