"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PermissionBanner } from "../../components/PermissionBanner";
import { RunStream, type StreamEvent } from "../../components/runs/RunStream";
import SkillForm from "../../components/runs/SkillForm";
import Segmented from "../../components/Segmented";
import type { SkillEntry } from "../../lib/skills-manifest";

type RunStatus = "idle" | "starting" | "running" | "done" | "failed";
type LaunchMode = "skill" | "free";

export function RunConsole({
  initialSlug,
  initialPrompt,
  initialSkill,
  skills = [],
}: {
  initialSlug: string;
  initialPrompt?: string;
  /** Skill command (e.g. "/analyze") the palette handed off, if any. */
  initialSkill?: string;
  /** Bundled skills from skills/manifest.json, for the launcher form. */
  skills?: SkillEntry[];
}) {
  const [slug, setSlug] = useState(initialSlug);
  const [prompt, setPrompt] = useState(initialPrompt || (initialSlug ? `/analyze ${initialSlug}` : ""));
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [usePermissionBridge, setUsePermissionBridge] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const router = useRouter();

  // Only bundled skills get a form — an external/not-installed skill has no
  // manifest entry, so it carries no slug, args or flags to render.
  const formSkills = useMemo(
    () =>
      skills.filter(
        (s): s is SkillEntry & { slug: string } =>
          s.available && !!s.slug && !!(s.args?.length || s.flags?.length)
      ),
    [skills]
  );

  // Skills are keyed by slug, not command: /image-gen is the command for BOTH
  // `image-gen` (organic) and `image-gen-ads` (paid), so a command-keyed
  // <select> would collapse them and make the ads variant unreachable.
  const resolveSlug = (handoff: string | undefined): string | null => {
    if (!handoff) return null;
    const match =
      formSkills.find((s) => s.slug === handoff) ??
      formSkills.find((s) => s.command === handoff);
    return match?.slug ?? null;
  };
  const handoffSlug = resolveSlug(initialSkill);

  // Default to the skill the palette handed off; otherwise the first one, so
  // the form is never rendered without a selection.
  const [mode, setMode] = useState<LaunchMode>(handoffSlug ? "skill" : "free");
  const [skillSlug, setSkillSlug] = useState(handoffSlug ?? formSkills[0]?.slug ?? "");
  // The command the form composed, and the required args still missing.
  const [composed, setComposed] = useState("");
  const [blockedBy, setBlockedBy] = useState<string[]>([]);

  const selectedSkill = formSkills.find((s) => s.slug === skillSlug) ?? null;

  // What Start actually sends: the form's composed command in skill mode, the
  // textarea in free mode. One source of truth, so the button and the preview
  // can never disagree.
  const effectivePrompt = mode === "skill" ? composed : prompt;
  const cannotStart =
    !effectivePrompt.trim() ||
    (mode === "skill" && (!selectedSkill || blockedBy.length > 0)) ||
    status === "starting" ||
    status === "running";

  useEffect(() => () => esRef.current?.close(), []);

  function attach(id: string) {
    esRef.current?.close();
    setEvents([]);
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      setEvents((prev) => [...prev, { seq: Number(msg.lastEventId), data }]);
      if (typeof data?.session_id === "string") setSessionId(data.session_id);
      if (data?.type === "registry_exit") {
        setStatus(data.code === 0 ? "done" : "failed");
        es.close();
        // The run is now in the registry's history; re-render the server
        // component so it shows up in the run list and the cost charts
        // without the operator having to reload.
        router.refresh();
      }
    };
    es.addEventListener("registry-status", (msg: MessageEvent) => {
      setStatus((msg.data as RunStatus) ?? "done");
      es.close();
      router.refresh();
    });
    es.onerror = () => {
      // Registry closed the stream normally on completion; EventSource
      // treats that as an error event too, so only surface it if we're
      // still supposed to be running.
      es.close();
    };
    esRef.current = es;
  }

  async function start(resume: boolean) {
    const toRun = effectivePrompt.trim();
    if (!toRun) return;
    if (mode === "skill" && blockedBy.length > 0) return;
    setStatus("starting");
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: toRun,
        slug: slug || null,
        resumeSessionId: resume ? sessionId : null,
        usePermissionBridge,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus("failed");
      return;
    }
    setRunId(json.runId);
    setStatus("running");
    attach(json.runId);
  }

  function cancel() {
    if (!runId) return;
    fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
  }

  return (
    <div>
      <div className="ds-run-header">
        <span className="ds-run-header__id">{runId ? runId.slice(0, 8) : "no run yet"}</span>
        <span className={`ds-badge ${status === "running" ? "ds-badge--info" : status === "done" ? "ds-badge--good" : status === "failed" ? "ds-badge--bad" : "ds-badge--neutral"}`}>
          {status}
        </span>
        {sessionId && <span className="ds-run-header__id">session {sessionId.slice(0, 8)}</span>}
      </div>

      <div className="ds-field">
        <label className="ds-field__label" htmlFor="slug">
          Client slug (optional)
        </label>
        <input
          id="slug"
          className="ds-input"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="blue-rose-auto"
        />
      </div>

      {formSkills.length > 0 && (
        <div className="ds-field">
          <span className="ds-field__label">Launch as</span>
          <Segmented<LaunchMode>
            ariaLabel="How to launch this run"
            value={mode}
            onChange={setMode}
            options={[
              { value: "skill", label: "Skill" },
              { value: "free", label: "Free text" },
            ]}
          />
        </div>
      )}

      {mode === "skill" && formSkills.length > 0 ? (
        <>
          <div className="ds-field">
            <label className="ds-field__label" htmlFor="skill">
              Skill
            </label>
            <select
              id="skill"
              className="ds-select"
              value={skillSlug}
              onChange={(e) => setSkillSlug(e.target.value)}
            >
              {formSkills.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.command} — {s.label}
                </option>
              ))}
            </select>
          </div>
          {selectedSkill && (
            <SkillForm
              key={selectedSkill.slug ?? selectedSkill.command}
              skill={selectedSkill}
              slug={slug || undefined}
              ambiguousCommand={
                formSkills.filter((s) => s.command === selectedSkill.command).length > 1
              }
              onChange={(next, blocked) => {
                setComposed(next);
                setBlockedBy(blocked);
              }}
            />
          )}
        </>
      ) : (
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="prompt">
            Prompt — free text, or a skill route like <code>/analyze {"{slug}"}</code>
          </label>
          <textarea
            id="prompt"
            className="ds-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </div>
      )}

      <div className="ds-form-row" style={{ alignItems: "center" }}>
        <button className="ds-btn ds-btn--primary" onClick={() => start(false)} disabled={cannotStart}>
          Start run
        </button>
        <button
          className="ds-btn ds-btn--ghost"
          onClick={() => start(true)}
          disabled={!sessionId || status === "starting" || status === "running"}
        >
          Resume session
        </button>
        <button className="ds-btn ds-btn--danger" onClick={cancel} disabled={status !== "running"}>
          Cancel
        </button>
        <label className="ds-field__hint" style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-1)" }}>
          <input
            type="checkbox"
            checked={usePermissionBridge}
            onChange={(e) => setUsePermissionBridge(e.target.checked)}
            disabled={status === "starting" || status === "running"}
          />
          Route tool permissions through this UI (Phase D bridge)
        </label>
      </div>

      <PermissionBanner runId={runId} active={status === "running"} />

      <div style={{ marginTop: "var(--ds-space-5)" }}>
        <RunStream
          events={events}
          live={status === "running"}
          emptyHint={
            status === "starting" ? "Starting the run…" : "No output yet — start a run above."
          }
        />
      </div>
    </div>
  );
}
