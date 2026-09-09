"use client";

/**
 * Topbar client switcher. Jumping between clients was previously a trip back
 * to the board and a second click; this is one keystroke from anywhere.
 * Keeps you on the same tab (pipeline/runs/reports/…) when switching, which
 * is almost always what you want mid-task.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export interface SwitcherClient {
  slug: string;
  name: string;
  stage: string;
}

const STAGE_TONE: Record<string, string> = {
  active: "ds-badge ds-badge--good",
  won: "ds-badge ds-badge--good",
  "zero-start": "ds-badge ds-badge--info",
  prospect: "ds-badge ds-badge--neutral",
  lost: "ds-badge ds-badge--bad",
  churned: "ds-badge ds-badge--bad",
};

export default function ClientSwitcher({
  clients,
  current,
}: {
  clients: SwitcherClient[];
  current?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const active = clients.find((c) => c.slug === current);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Preserve the current tab across the switch: /clients/a/reports → /clients/b/reports
  const tab = (() => {
    const m = pathname.match(/^\/clients\/[^/]+\/([^/]+)/);
    return m ? m[1] : "pipeline";
  })();

  const filtered = query
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.slug.toLowerCase().includes(query.toLowerCase())
      )
    : clients;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="ds-client-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width={16} height={16} aria-hidden="true">
          <use href="/icons.svg#i-client" />
        </svg>
        {active ? active.name : "All clients"}
        <svg width={14} height={14} aria-hidden="true" style={{ transform: "rotate(90deg)", opacity: 0.6 }}>
          <use href="/icons.svg#i-chevron" />
        </svg>
      </button>

      {open && (
        <div
          className="ds-palette ds-glass--strong"
          role="listbox"
          aria-label="Switch client"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            transform: "none",
            width: 320,
            animation: "none",
          }}
        >
          <input
            ref={inputRef}
            className="ds-palette__input"
            placeholder="Find a client…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: 13.5, padding: "var(--ds-space-3) var(--ds-space-4)" }}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="ds-palette__list">
            <div
              className="ds-palette__item"
              role="option"
              aria-selected={!current}
              onClick={() => {
                setOpen(false);
                router.push("/clients");
              }}
            >
              <svg aria-hidden="true">
                <use href="/icons.svg#i-home" />
              </svg>
              <span>All clients</span>
            </div>
            {filtered.map((c) => (
              <div
                key={c.slug}
                className={`ds-palette__item${c.slug === current ? " is-active" : ""}`}
                role="option"
                aria-selected={c.slug === current}
                onClick={() => {
                  setOpen(false);
                  router.push(`/clients/${c.slug}/${tab}`);
                }}
              >
                <svg aria-hidden="true">
                  <use href="/icons.svg#i-client" />
                </svg>
                <span>{c.name}</span>
                <span className={STAGE_TONE[c.stage] ?? "ds-badge ds-badge--neutral"} style={{ marginLeft: "auto" }}>
                  {c.stage}
                </span>
              </div>
            ))}
            {filtered.length === 0 && <div className="ds-palette__empty">No client matches “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
