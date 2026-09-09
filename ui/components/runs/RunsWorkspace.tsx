"use client";

/**
 * The Runs screen's list/detail split.
 *
 * `ds-split` (with its col-resize handle) has been in the stylesheet since
 * Phase A with nothing using it; this is the screen it was drawn for. The
 * handle is a real `role="separator"` so the pane can be resized by keyboard
 * as well as by pointer — a drag-only affordance would be unusable without a
 * mouse.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import RunList from "./RunList";
import RunDetail from "./RunDetail";
import type { RunSummary } from "../../lib/runs";

const MIN = 220;
const MAX = 560;
const DEFAULT = 320;

export default function RunsWorkspace({
  runs,
  launcher,
}: {
  runs: RunSummary[];
  /** The RunConsole, rendered by the server and shown when no run is selected. */
  launcher: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState(DEFAULT);
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = selectedId ? runs.find((r) => r.runId === selectedId) ?? null : null;

  // A run that vanished (server restarted, history trimmed) must not leave the
  // pane blank — fall back to the launcher.
  useEffect(() => {
    if (selectedId && !runs.some((r) => r.runId === selectedId)) setSelectedId(null);
  }, [runs, selectedId]);

  const onMove = useCallback((e: PointerEvent) => {
    if (!dragging.current || !rootRef.current) return;
    const left = rootRef.current.getBoundingClientRect().left;
    setWidth(Math.min(MAX, Math.max(MIN, e.clientX - left)));
  }, []);

  const onUp = useCallback(() => {
    dragging.current = false;
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onMove, onUp]);

  return (
    <div className="ds-split ds-panel" ref={rootRef} style={{ overflow: "hidden", minHeight: 520 }}>
      <div className="ds-split__a" style={{ width, flexBasis: width }}>
        <RunList runs={runs} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <div
        className="ds-split__handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize run list"
        aria-valuenow={width}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        tabIndex={0}
        onPointerDown={() => {
          dragging.current = true;
          document.body.style.userSelect = "none";
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth((w) => Math.max(MIN, w - 24));
          if (e.key === "ArrowRight") setWidth((w) => Math.min(MAX, w + 24));
        }}
      />

      <div className="ds-split__b">
        {selected ? (
          <RunDetail run={selected} />
        ) : (
          <div style={{ padding: "var(--ds-space-5)" }}>{launcher}</div>
        )}
      </div>
    </div>
  );
}
