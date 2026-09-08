"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_SKILL_ROUTES, type SkillRoute } from "../lib/skill-routes";

// A lowercase-alnum-dash token that looks like a client slug (e.g.
// "blue-rose-auto"), as opposed to a flag or free-text argument.
const SLUG_LIKE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Dispatched by any topbar/nav affordance that wants to open the palette
 * without owning its state — CommandPalette is mounted once at the app root
 * (see AppShell.tsx) and listens for this instead of taking an `open` prop. */
export const OPEN_COMMAND_PALETTE_EVENT = "smos:open-command-palette";

function filterRoutes(query: string): SkillRoute[] {
  const firstToken = query.trim().split(/\s+/)[0] ?? "";
  if (!firstToken) return ALL_SKILL_ROUTES;
  const needle = firstToken.toLowerCase();
  return ALL_SKILL_ROUTES.filter(
    (r) => r.command.toLowerCase().includes(needle) || r.label.toLowerCase().includes(needle)
  );
}

function guessSlug(query: string): string | null {
  const tokens = query.trim().split(/\s+/);
  const candidate = tokens[1];
  if (candidate && SLUG_LIKE.test(candidate)) return candidate;
  return null;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setNote(null);
  }, []);

  const openPalette = useCallback(() => {
    setOpen(true);
    setActiveIndex(0);
    setNote(null);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) return prev; // already open — let Escape close it
          setActiveIndex(0);
          setNote(null);
          return true;
        });
      } else if (e.key === "Escape" && open) {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    function onOpenRequest() {
      openPalette();
    }
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
  }, [openPalette]);

  useEffect(() => {
    if (open) {
      // Focus on open — after the palette mounts.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const filtered = filterRoutes(query);

  function acceptSuggestion(route: SkillRoute) {
    if (!route.available) {
      setNote(`${route.command} — ${route.note ?? "not installed"}`);
      return;
    }
    setNote(null);
    const tokens = query.trim().split(/\s+/);
    tokens[0] = route.command;
    setQuery(`${tokens.filter(Boolean).join(" ")} `.replace(/^ /, ""));
    inputRef.current?.focus();
  }

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    const firstToken = trimmed.split(/\s+/)[0];
    const highlighted = filtered[activeIndex];

    // If a highlighted suggestion hasn't been accepted into the input yet
    // (i.e. its command isn't already the first token), Enter autocompletes
    // instead of submitting — mirrors the click behavior.
    if (highlighted && highlighted.command.toLowerCase() !== firstToken.toLowerCase()) {
      acceptSuggestion(highlighted);
      return;
    }
    if (highlighted && !highlighted.available) {
      setNote(`${highlighted.command} — ${highlighted.note ?? "not installed"}`);
      return;
    }

    const slug = guessSlug(trimmed);
    const params = new URLSearchParams();
    if (slug) params.set("slug", slug);
    params.set("prompt", trimmed);
    router.push(`/runs?${params.toString()}`);
    close();
  }

  function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="ds-palette__overlay" onClick={close} />
      <div className="ds-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="ds-palette__input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setNote(null);
          }}
          onKeyDown={onKeyDownInput}
          placeholder="Type a skill or client… e.g. /analyze blue-rose-auto"
          autoComplete="off"
          spellCheck={false}
        />
        {note && (
          <div className="ds-field__hint" style={{ padding: "0 var(--ds-space-5)", color: "var(--ds-amber-ink)" }}>
            {note}
          </div>
        )}
        <div className="ds-palette__list">
          {filtered.length === 0 && <div className="ds-field__hint" style={{ padding: "var(--ds-space-3)" }}>No matching skill.</div>}
          {filtered.map((route, i) => (
            <div
              key={`${route.command}-${route.label}`}
              className={`ds-palette__item${i === activeIndex ? " is-active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => acceptSuggestion(route)}
              role="option"
              aria-selected={i === activeIndex}
              style={route.available ? undefined : { opacity: 0.6 }}
            >
              <svg width={16} height={16}>
                <use href={`/icons.svg#${route.available ? "i-run" : "i-approval"}`} />
              </svg>
              <span>
                {route.label}
                {!route.available && (
                  <span className="ds-badge ds-badge--neutral" style={{ marginLeft: "var(--ds-space-2)" }}>
                    external
                  </span>
                )}
              </span>
              <span className="ds-palette__cmd">{route.command}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
