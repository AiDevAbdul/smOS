"use client";

/**
 * ⌘K palette. Two changes from the original:
 *
 *  - The skill list now comes from skills/manifest.json (passed in by AppShell,
 *    which can read the filesystem) instead of the hand-maintained table in
 *    lib/skill-routes.ts. That closes the open Phase E item in
 *    docs/ui-plan-design-system.md §4 — the table could silently drift from
 *    CLAUDE.md; the generated manifest can't.
 *  - It navigates as well as runs: clients are searchable alongside skills, so
 *    ⌘K is the single "go anywhere / do anything" entry point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SkillEntry } from "../lib/skills-manifest";
import type { SwitcherClient } from "./ClientSwitcher";

const SLUG_LIKE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Dispatched by any topbar/nav affordance that wants to open the palette
 * without owning its state — CommandPalette is mounted once at the app root
 * (see AppShell.tsx) and listens for this instead of taking an `open` prop. */
export const OPEN_COMMAND_PALETTE_EVENT = "smos:open-command-palette";

type Row =
  | { kind: "skill"; skill: SkillEntry }
  | { kind: "client"; client: SwitcherClient };

function guessSlug(query: string): string | null {
  const candidate = query.trim().split(/\s+/)[1];
  return candidate && SLUG_LIKE.test(candidate) ? candidate : null;
}

export function CommandPalette({
  skills,
  clients,
  currentSlug,
}: {
  skills: SkillEntry[];
  clients: SwitcherClient[];
  currentSlug?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

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
    const onOpenRequest = () => openPalette();
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenRequest);
  }, [openPalette]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const { skillRows, clientRows, rows } = useMemo(() => {
    const firstToken = query.trim().split(/\s+/)[0] ?? "";
    const needle = firstToken.toLowerCase().replace(/^\//, "");

    const sk = needle
      ? skills.filter(
          (s) =>
            s.command.toLowerCase().includes(needle) || s.label.toLowerCase().includes(needle)
        )
      : skills;

    // Clients only surface on a real query — an unfiltered palette should lead
    // with skills, which is what ⌘K is mostly used for.
    const cl = needle
      ? clients.filter(
          (c) => c.name.toLowerCase().includes(needle) || c.slug.toLowerCase().includes(needle)
        )
      : [];

    const all: Row[] = [
      ...sk.map((skill) => ({ kind: "skill" as const, skill })),
      ...cl.map((client) => ({ kind: "client" as const, client })),
    ];
    return { skillRows: sk, clientRows: cl, rows: all };
  }, [query, skills, clients]);

  // Keep the highlighted row in view during keyboard traversal.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function acceptSkill(skill: SkillEntry) {
    if (!skill.available) {
      setNote(`${skill.command} — ${skill.note ?? "not installed"}`);
      return;
    }
    setNote(null);
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    tokens[0] = skill.command;
    // Pre-fill the client you're already looking at when the skill takes one.
    if (skill.takesSlug && currentSlug && !tokens[1]) tokens[1] = currentSlug;
    setQuery(`${tokens.join(" ")} `);
    inputRef.current?.focus();
  }

  function activate(row: Row) {
    if (row.kind === "client") {
      close();
      router.push(`/clients/${row.client.slug}/pipeline`);
      return;
    }
    acceptSkill(row.skill);
  }

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    const firstToken = trimmed.split(/\s+/)[0];
    const highlighted = rows[activeIndex];

    // If a highlighted row hasn't been accepted into the input yet (i.e. its
    // command isn't already the first token), Enter accepts it instead of
    // submitting — mirrors the click behavior.
    if (
      highlighted &&
      (highlighted.kind === "client" ||
        highlighted.skill.command.toLowerCase() !== firstToken.toLowerCase())
    ) {
      activate(highlighted);
      return;
    }
    if (highlighted?.kind === "skill" && !highlighted.skill.available) {
      setNote(`${highlighted.skill.command} — ${highlighted.skill.note ?? "not installed"}`);
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
      setActiveIndex((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
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

  const renderRow = (row: Row, i: number) => {
    const isActive = i === activeIndex;
    if (row.kind === "client") {
      return (
        <div
          key={`client-${row.client.slug}`}
          className={`ds-palette__item${isActive ? " is-active" : ""}`}
          data-active={isActive}
          onMouseEnter={() => setActiveIndex(i)}
          onClick={() => activate(row)}
          role="option"
          aria-selected={isActive}
        >
          <svg aria-hidden="true">
            <use href="/icons.svg#i-client" />
          </svg>
          <span>{row.client.name}</span>
          <span className="ds-palette__cmd">{row.client.slug}</span>
        </div>
      );
    }
    const s = row.skill;
    return (
      <div
        key={`skill-${s.command}-${s.label}`}
        className={`ds-palette__item${isActive ? " is-active" : ""}`}
        data-active={isActive}
        aria-disabled={!s.available}
        onMouseEnter={() => setActiveIndex(i)}
        onClick={() => activate(row)}
        role="option"
        aria-selected={isActive}
      >
        <svg aria-hidden="true">
          <use href={`/icons.svg#${s.available ? "i-run" : "i-alert"}`} />
        </svg>
        <span>
          {s.label}
          {!s.available && (
            <span className="ds-badge ds-badge--neutral" style={{ marginLeft: "var(--ds-space-2)" }}>
              external
            </span>
          )}
        </span>
        <span className="ds-palette__cmd">{s.command}</span>
      </div>
    );
  };

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
          placeholder="Run a skill or jump to a client… e.g. /analyze blue-rose-auto"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls="ds-palette-list"
        />
        {note && (
          <div
            className="ds-field__hint"
            style={{ padding: "var(--ds-space-2) var(--ds-space-5)", color: "var(--ds-amber-ink)" }}
            role="alert"
          >
            {note}
          </div>
        )}
        <div className="ds-palette__list" id="ds-palette-list" role="listbox" ref={listRef}>
          {rows.length === 0 && (
            <div className="ds-palette__empty">Nothing matches “{query.trim()}”.</div>
          )}
          {skillRows.length > 0 && <div className="ds-palette__group">Skills</div>}
          {rows.slice(0, skillRows.length).map(renderRow)}
          {clientRows.length > 0 && <div className="ds-palette__group">Clients</div>}
          {rows.slice(skillRows.length).map((row, i) => renderRow(row, skillRows.length + i))}
        </div>
        <div className="ds-palette__hint">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto" }}>{skills.length} skills</span>
        </div>
      </div>
    </>
  );
}
