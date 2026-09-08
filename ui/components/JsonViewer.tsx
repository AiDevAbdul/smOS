"use client";

import { useState } from "react";

export function JsonViewer({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ds-panel" style={{ padding: "var(--ds-space-4)", marginBottom: "var(--ds-space-3)" }}>
      <button className="ds-json__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="ds-json" style={{ marginTop: "var(--ds-space-3)" }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
