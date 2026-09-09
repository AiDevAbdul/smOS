// scripts/lib/skill_command.js — compose a skill invocation from a
// skills/manifest.json entry plus operator-supplied values.
//
// Lives here rather than inside the React component so it is a plain,
// testable module (see test/skill-command.test.js) and so anything else that
// needs to render a manifest entry as a command line — a future CLI helper,
// the /progress skill — reuses one implementation. The operator UI's
// launcher form (ui/components/runs/SkillForm.tsx) imports it directly, the
// same way ui/ already imports scripts/lib/approvals.js and paths.js.

/**
 * @typedef {{ name: string, required?: boolean, description?: string, enum?: string[] }} SkillArg
 * @typedef {{ name: string, type?: string, description?: string, default?: unknown }} SkillFlag
 * @typedef {{ command: string, slug?: string, companion?: string, args?: SkillArg[], flags?: SkillFlag[] }} SkillEntry
 * @typedef {{ args: Record<string, string>, flags: Record<string, string|boolean> }} SkillFormValues
 */

/** Quote a value only when it needs it, so the common case stays readable. */
export function quoteValue(value) {
  const v = String(value ?? "").trim();
  if (!v) return v;
  if (!/[\s"]/.test(v)) return v;
  return `"${v.replace(/"/g, '\\"')}"`;
}

/** A flag is a switch (no value) exactly when the manifest types it boolean. */
export function isBooleanFlag(flag) {
  return flag?.type === "boolean";
}

/**
 * Compose the invocation string for a skill and the operator's inputs.
 *
 * Positional args are emitted in manifest order; empty ones are skipped (the
 * caller is expected to block on `missingRequiredArgs` rather than emit a
 * hole). Boolean flags are emitted bare when true, value flags as
 * `--flag value`, and both only when actually set — so an untouched form
 * composes the bare command, never a wall of empty flags.
 *
 * `ambiguous` handles the one manifest entry pair that shares a command:
 * `/image-gen` is the command for both `image-gen` (organic) and
 * `image-gen-ads` (paid). Composing them identically would make a picker's
 * choice silently meaningless, so when the caller knows the command is shared
 * we name the companion script the operator actually chose. The result is a
 * prompt for Claude to route on, not a shell line, so the clause reads as the
 * clarification it is.
 *
 * @param {SkillEntry} skill
 * @param {SkillFormValues} values
 * @param {boolean} [ambiguous]
 * @returns {string}
 */
export function composeSkillCommand(skill, values, ambiguous = false) {
  const args = values?.args ?? {};
  const flags = values?.flags ?? {};
  const parts = [skill.command];

  for (const arg of skill.args ?? []) {
    const raw = String(args[arg.name] ?? "").trim();
    if (raw) parts.push(quoteValue(raw));
  }

  for (const flag of skill.flags ?? []) {
    const value = flags[flag.name];
    if (isBooleanFlag(flag)) {
      if (value === true) parts.push(flag.name);
      continue;
    }
    const raw = typeof value === "string" ? value.trim() : "";
    if (raw) parts.push(`${flag.name} ${quoteValue(raw)}`);
  }

  const line = parts.join(" ");
  return ambiguous && skill.companion ? `${line} (run ${skill.companion})` : line;
}

/**
 * Names of required positional args the operator hasn't filled in.
 *
 * Deliberately the ONLY validation here: flag-level constraints (pre-audit's
 * "--business is required with --collect") live in the skills themselves,
 * which report them far better than a guess at this layer would.
 *
 * @param {SkillEntry} skill
 * @param {SkillFormValues} values
 * @returns {string[]}
 */
export function missingRequiredArgs(skill, values) {
  const args = values?.args ?? {};
  return (skill.args ?? [])
    .filter((a) => a.required && !String(args[a.name] ?? "").trim())
    .map((a) => a.name);
}

/**
 * Commands shared by more than one entry in a manifest skill list. The
 * launcher uses this to decide when `composeSkillCommand` needs to
 * disambiguate; a test asserts it still finds /image-gen, so if the manifest
 * ever grows another collision it is caught rather than shipped.
 *
 * @param {SkillEntry[]} skills
 * @returns {Set<string>}
 */
export function ambiguousCommands(skills) {
  const counts = new Map();
  for (const s of skills ?? []) {
    counts.set(s.command, (counts.get(s.command) ?? 0) + 1);
  }
  const shared = new Set();
  for (const [command, count] of counts) {
    if (count > 1) shared.add(command);
  }
  return shared;
}
