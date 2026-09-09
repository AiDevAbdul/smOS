"use client";

/**
 * Per-skill launcher form.
 *
 * Closes the second half of the Phase E gap in docs/ui-plan-design-system.md
 * §4: the palette already reads `skills/manifest.json` (via
 * lib/skills-manifest.ts) but only used each entry's command + label, so the
 * launcher still shipped raw prompt text and the operator had to remember
 * every skill's positional args and flag spellings from memory.
 *
 * This renders the manifest's `args` and `flags` for one skill as a real form
 * — enum args become a <select>, boolean flags a checkbox, everything else a
 * typed input — and composes the exact invocation string the run should
 * carry. The composed command is always visible, and always editable via the
 * Free-text mode in RunConsole, so the form is an accelerator rather than a
 * wall between the operator and the prompt.
 *
 * It deliberately does NOT invent validation the manifest doesn't state: a
 * required positional arg must be non-empty, and that is the whole rule.
 * Flag-level "required with --collect"-style constraints live in the skills
 * themselves, which report them far better than a guess here would.
 */

import { useEffect, useMemo, useState } from "react";
import type { SkillEntry, SkillFlag } from "../../lib/skills-manifest";
// The composition rules live in a plain, unit-tested module (see
// test/skill-command.test.js) rather than in this component, so the string
// the operator is shown is the same string a test asserts on.
import {
  composeSkillCommand,
  isBooleanFlag,
  missingRequiredArgs,
} from "../../../scripts/lib/skill_command.js";

/** Above this many flags, the optional ones collapse behind a disclosure. */
const FLAG_DISCLOSURE_THRESHOLD = 4;

export interface SkillFormValues {
  args: Record<string, string>;
  flags: Record<string, string | boolean>;
}

function emptyValues(): SkillFormValues {
  return { args: {}, flags: {} };
}

export default function SkillForm({
  skill,
  slug,
  ambiguousCommand = false,
  onChange,
}: {
  skill: SkillEntry;
  /** The client slug in scope, pre-filled into the skill's slug arg if it takes one. */
  slug?: string;
  /** True when another bundled skill shares this one's command — see composeCommand. */
  ambiguousCommand?: boolean;
  /** Called with the composed command and whether it's ready to run. */
  onChange: (composed: string, blockedBy: string[]) => void;
}) {
  const [values, setValues] = useState<SkillFormValues>(emptyValues);
  const [showAllFlags, setShowAllFlags] = useState(false);

  const args = skill.args ?? [];
  const flags = skill.flags ?? [];
  // Identity of the selected skill, for effect deps and DOM ids. The slug is
  // unique; the command is not — `/image-gen` is the command for both
  // `image-gen` and `image-gen-ads`.
  const skillKey = skill.slug ?? skill.command;

  // Reset when the operator picks a different skill — carrying one skill's
  // flag values onto another's form would compose nonsense invocations.
  useEffect(() => {
    setValues(emptyValues());
    setShowAllFlags(false);
  }, [skillKey]);

  // Pre-fill the slug arg from the client in scope. Kept as an effect keyed on
  // both so switching client or skill re-applies it, but it never clobbers a
  // value the operator typed.
  const slugArgName = useMemo(
    () => args.find((a) => /slug/i.test(a.name))?.name ?? null,
    [args]
  );
  useEffect(() => {
    if (!slugArgName || !slug) return;
    setValues((prev) =>
      prev.args[slugArgName]
        ? prev
        : { ...prev, args: { ...prev.args, [slugArgName]: slug } }
    );
  }, [slugArgName, slug, skillKey]);

  const composed = composeSkillCommand(skill, values, ambiguousCommand);
  const blockedBy: string[] = missingRequiredArgs(skill, values);

  // Hand the composed command up on every change. `composed`/`blockedBy` are
  // derived strings, so this fires exactly when the invocation really changes.
  useEffect(() => {
    onChange(composed, blockedBy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed, blockedBy.join(",")]);

  function setArg(name: string, value: string) {
    setValues((prev) => ({ ...prev, args: { ...prev.args, [name]: value } }));
  }
  function setFlag(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, flags: { ...prev.flags, [name]: value } }));
  }

  // Long flag lists (pre-audit has 11) would bury the positional args, so
  // collapse them behind a disclosure once there are more than a handful.
  // Anything the operator has already set stays visible regardless, so a
  // collapse can never hide part of the command being composed.
  const isSet = (f: SkillFlag) => {
    const v = values.flags[f.name];
    return isBooleanFlag(f) ? v === true : typeof v === "string" && v.trim() !== "";
  };
  const collapseFlags = flags.length > FLAG_DISCLOSURE_THRESHOLD && !showAllFlags;
  const visibleFlags = collapseFlags ? flags.filter(isSet) : flags;
  const hiddenFlagCount = flags.length - visibleFlags.length;
  const booleanFlags = visibleFlags.filter(isBooleanFlag);
  const valueFlags = visibleFlags.filter((f) => !isBooleanFlag(f));

  return (
    <div>
      <p className="ds-field__hint" style={{ marginTop: 0 }}>
        {skill.label}
      </p>

      {args.length > 0 && (
        <div className="ds-form-row">
          {args.map((arg) => {
            const id = `skillarg-${skillKey}-${arg.name}`;
            const value = values.args[arg.name] ?? "";
            const isMissing = blockedBy.includes(arg.name);
            return (
              <div className="ds-field" key={arg.name}>
                <label className="ds-field__label" htmlFor={id}>
                  {arg.name}
                  {arg.required ? " *" : ""}
                </label>
                {arg.enum?.length ? (
                  <select
                    id={id}
                    className="ds-select"
                    value={value}
                    onChange={(e) => setArg(arg.name, e.target.value)}
                  >
                    <option value="">{arg.required ? "— pick one —" : "— none —"}</option>
                    {arg.enum.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    className={`ds-input${isMissing ? " is-invalid" : ""}`}
                    value={value}
                    onChange={(e) => setArg(arg.name, e.target.value)}
                    placeholder={arg.description ?? arg.name}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
                {arg.description && <span className="ds-field__hint">{arg.description}</span>}
              </div>
            );
          })}
        </div>
      )}

      {booleanFlags.length > 0 && (
        <div className="ds-field">
          <span className="ds-field__label">Flags</span>
          <div className="ds-toggle-grid">
            {booleanFlags.map((flag) => {
              const id = `skillflag-${skillKey}-${flag.name}`;
              return (
                <div className="ds-toggle" key={flag.name}>
                  <label className="ds-switch">
                    <input
                      id={id}
                      type="checkbox"
                      checked={values.flags[flag.name] === true}
                      onChange={(e) => setFlag(flag.name, e.target.checked)}
                    />
                    <span className="ds-switch__track" />
                    <span className="ds-switch__thumb" />
                  </label>
                  <span className="ds-toggle__body">
                    <label className="ds-toggle__name" htmlFor={id}>
                      {flag.name}
                    </label>
                    {flag.description && (
                      <span className="ds-field__hint">{flag.description}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {valueFlags.length > 0 && (
        <div className="ds-form-row">
          {valueFlags.map((flag) => {
            const id = `skillflag-${skillKey}-${flag.name}`;
            const value = values.flags[flag.name];
            return (
              <div className="ds-field" key={flag.name}>
                <label className="ds-field__label ds-field__label--code" htmlFor={id}>
                  {flag.name}
                </label>
                <input
                  id={id}
                  className="ds-input"
                  type={flag.type === "number" ? "number" : "text"}
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setFlag(flag.name, e.target.value)}
                  placeholder={
                    flag.default !== undefined
                      ? `default: ${String(flag.default)}`
                      : flag.type ?? "value"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                {flag.description && <span className="ds-field__hint">{flag.description}</span>}
              </div>
            );
          })}
        </div>
      )}

      {hiddenFlagCount > 0 && (
        <button
          type="button"
          className="ds-btn ds-btn--ghost ds-btn--sm"
          onClick={() => setShowAllFlags(true)}
        >
          Show {hiddenFlagCount} more optional flag{hiddenFlagCount === 1 ? "" : "s"}
        </button>
      )}
      {showAllFlags && flags.length > FLAG_DISCLOSURE_THRESHOLD && (
        <button
          type="button"
          className="ds-btn ds-btn--ghost ds-btn--sm"
          onClick={() => setShowAllFlags(false)}
        >
          Hide optional flags
        </button>
      )}

      <div className="ds-field">
        <span className="ds-field__label">Will run</span>
        <code className="ds-cmd-preview">{composed}</code>
        {blockedBy.length > 0 && (
          <span className="ds-field__error" role="alert">
            Required: {blockedBy.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}
