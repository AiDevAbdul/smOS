"use client";

/**
 * The two topbar controls that need the browser: the mobile rail trigger and
 * the palette opener. Split out so AppShell can stay a Server Component.
 */

import { OPEN_COMMAND_PALETTE_EVENT } from "./CommandPalette";

export default function TopbarActions() {
  return (
    <>
      {/* Only reachable below 900px, where .ds-rail is hidden. */}
      <button
        type="button"
        className="ds-btn ds-btn--ghost ds-btn--icon ds-btn--on-shell ds-topbar__menu"
        onClick={() => window.dispatchEvent(new Event("smos:open-rail"))}
        aria-label="Open navigation"
      >
        <svg aria-hidden="true">
          <use href="/icons.svg#i-menu" />
        </svg>
      </button>

      <button
        type="button"
        className="ds-topbar__search"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
        title="Run a skill or jump to a client (Command K)"
      >
        <svg width={14} height={14} aria-hidden="true">
          <use href="/icons.svg#i-search" />
        </svg>
        <span>Run a skill or jump to…</span>
        <kbd className="ds-topbar__kbd" aria-hidden="true">
          ⌘K
        </kbd>
      </button>
    </>
  );
}
