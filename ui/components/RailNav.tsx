"use client";

/**
 * The rail. Three things the old version got wrong and this fixes:
 *
 *  1. Active state used `pathname === href`, so every /clients/<slug>/… route
 *     highlighted nothing at all. Now it's a segment-boundary prefix match.
 *  2. Nav was one flat list. Now it's grouped (Overview / Client / System) and
 *     the client group only appears when you're inside a client.
 *  3. Collapse and approval badges were styled in CSS but never wired.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Count shown as a badge; 0 or undefined hides it. */
  badge?: number;
  /** Renders a live pulse instead of a count. */
  live?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Exact for "/", segment-boundary prefix otherwise, so /clients/foo/runs
 *  lights up "Clients" without /runs also matching /runsomething. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function RailNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("smos-rail") === "collapsed");
    } catch {
      /* blocked storage — stay expanded */
    }
  }, []);

  // Route change closes the mobile drawer; on desktop it's a no-op.
  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("smos:open-rail", open);
    return () => window.removeEventListener("smos:open-rail", open);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("smos-rail", next ? "collapsed" : "expanded");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <>
      {/* Tap-outside dismiss for the mobile drawer. Rendered only when open,
          so it never intercepts clicks on desktop. */}
      {mobileOpen && (
        <div
          className="ds-rail__scrim"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    <nav
      className="ds-rail"
      aria-label="Primary"
      data-collapsed={collapsed ? "true" : "false"}
      data-mobile-open={mobileOpen ? "true" : "false"}
    >
      <div className="ds-rail__brand">
        <span className="ds-rail__brand-mark" aria-hidden="true" />
        <span className="ds-rail__brand-name">smOS</span>
        <button
          type="button"
          className="ds-rail__collapse"
          onClick={toggle}
          aria-pressed={collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          <svg aria-hidden="true">
            <use href="/icons.svg#i-panel-left" />
          </svg>
        </button>
      </div>

      {groups.map((group) => (
        <div key={group.label}>
          <div className="ds-nav-group">{group.label}</div>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`ds-nav-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                // Collapsed rail hides labels, so the accessible name and the
                // hover tooltip both have to carry them.
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
              >
                <svg aria-hidden="true">
                  <use href={`/icons.svg#${item.icon}`} />
                </svg>
                <span className="ds-nav-item__label">{item.label}</span>
                {item.live && (
                  <span className="ds-dot ds-dot--running" style={{ marginLeft: "auto" }} aria-hidden="true" />
                )}
                {!item.live && item.badge ? (
                  <span className="ds-nav-item__badge">
                    {item.badge}
                    <span className="ds-sr-only"> pending</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
    </>
  );
}
