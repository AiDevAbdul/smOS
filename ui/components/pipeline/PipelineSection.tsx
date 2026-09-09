"use client";

/**
 * One pipeline section as a numbered work-order step: a `ds-track` spine
 * summarising the section at a glance, then a row per step with its verdict,
 * detail and — where the step maps to a real bundled skill — a launch action.
 *
 * The three Phase 0 human gates (positioning, name, logo) are called out
 * explicitly. CLAUDE.md makes them load-bearing and never auto-clearable, so a
 * screen that renders them identically to an ordinary "not started" step
 * misleads the operator into thinking a run will clear them. It won't; a person
 * has to.
 */

import { useState } from "react";
import Link from "next/link";
import type { StatusSection, StatusStep } from "../../lib/status";
import { prettifyDetail } from "../../lib/format";

/** The gates schemas/brand_profile.js enforces fail-closed. */
const HUMAN_GATES = new Set(["brand-strategy", "brand-name", "brand-visual"]);

const VERDICT: Record<string, { badge: string; label: string; node: string }> = {
  done: { badge: "ds-badge--good", label: "Done", node: "is-done" },
  partial: { badge: "ds-badge--warn", label: "Partial", node: "is-partial" },
  blocked: { badge: "ds-badge--bad", label: "Blocked", node: "" },
  missing: { badge: "ds-badge--neutral", label: "Not started", node: "" },
};

function verdictOf(step: StatusStep) {
  return VERDICT[step.status] ?? { badge: "ds-badge--neutral", label: step.status, node: "" };
}

export default function PipelineSection({
  section,
  index,
  slug,
  nextStepLabel,
  launchable,
}: {
  section: StatusSection;
  index: number;
  slug: string;
  /** Label of the single next action across the whole pipeline, if in here. */
  nextStepLabel: string | null;
  /** Step ids that correspond to a bundled skill we can actually launch. */
  launchable: Set<string>;
}) {
  const done = section.steps.filter((s) => s.status === "done").length;
  const total = section.steps.length;
  const complete = total > 0 && done === total;
  // Collapse a finished section by default — the operator's attention belongs
  // on what is left, not on 9 green rows.
  const [open, setOpen] = useState(!complete);

  return (
    <div className={`ds-step${complete ? "" : " is-partial"}`}>
      <div className="ds-step-num">{index + 1}</div>
      <div className="ds-step-body">
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--ds-space-3)", flexWrap: "wrap" }}>
          {/* h2: the client layout owns the h1, so a section sits one below
              it. The visual size comes from ds-step-title either way. */}
          <h2 className="ds-step-title" style={{ margin: 0 }}>
            {section.label}
          </h2>
          <span className={`ds-badge ${complete ? "ds-badge--good" : "ds-badge--neutral"}`}>
            {done}/{total}
          </span>
          <button
            type="button"
            className="ds-btn ds-btn--ghost ds-btn--sm"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{ marginLeft: "auto" }}
          >
            {open ? "Collapse" : "Expand"}
          </button>
        </div>

        {/* Section spine: one node per step, segments filled up to the last
            completed one. Reads as progress without needing the rows open. */}
        <div
          className="ds-track"
          style={{ margin: "var(--ds-space-3) 0" }}
          role="img"
          aria-label={`${done} of ${total} steps complete`}
        >
          {section.steps.map((step, i) => {
            const v = verdictOf(step);
            const isNext = nextStepLabel !== null && step.label === nextStepLabel;
            return (
              <span key={step.id} style={{ display: "contents" }}>
                {i > 0 && <span className={`ds-track__seg${step.status === "done" ? " is-done" : ""}`} />}
                <span
                  className={`ds-track__node ${isNext ? "is-current" : v.node}`}
                  title={`${step.label} — ${v.label}`}
                />
              </span>
            );
          })}
        </div>

        {open && (
          <div className="ds-sheet">
            {section.steps.map((step) => {
              const v = verdictOf(step);
              const isGate = HUMAN_GATES.has(step.id);
              const isNext = nextStepLabel !== null && step.label === nextStepLabel;
              const canLaunch = step.status !== "done" && launchable.has(step.id) && !isGate;
              return (
                <div key={step.id} className="ds-sheet__row">
                  <span className="ds-sheet__metric">
                    {step.label}
                    {isGate && (
                      <span
                        className="ds-badge ds-badge--warn"
                        style={{ marginLeft: "var(--ds-space-2)" }}
                        title="A person must approve this; no run can clear it."
                      >
                        human gate
                      </span>
                    )}
                    {isNext && (
                      <span className="ds-badge ds-badge--info" style={{ marginLeft: "var(--ds-space-2)" }}>
                        next
                      </span>
                    )}
                  </span>
                  <span className="ds-sheet__read">{prettifyDetail(step.detail) ?? "—"}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-2)" }}>
                    <span className={`ds-badge ${v.badge}`}>{v.label}</span>
                    {canLaunch && (
                      <Link
                        className="ds-btn ds-btn--ghost ds-btn--sm"
                        href={`/clients/${encodeURIComponent(slug)}/runs?prompt=${encodeURIComponent(
                          `/${step.id} ${slug}`
                        )}`}
                      >
                        Run /{step.id}
                      </Link>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
