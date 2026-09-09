// test/skill-command.test.js — the operator UI's skill-launcher command
// composer (scripts/lib/skill_command.js). The launcher form renders a
// manifest entry's args/flags and shows the operator exactly what will run;
// these tests pin that string, and pin it against the REAL manifest so a
// manifest edit that would break the launcher fails here first.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeSkillCommand,
  missingRequiredArgs,
  ambiguousCommands,
  isBooleanFlag,
  quoteValue,
} from "../scripts/lib/skill_command.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "skills", "manifest.json"), "utf8"));

const empty = { args: {}, flags: {} };

describe("composeSkillCommand", () => {
  const skill = {
    command: "/pre-audit",
    slug: "pre-audit",
    args: [{ name: "slug", required: true }],
    flags: [
      { name: "--business", type: "string" },
      { name: "--collect", type: "boolean" },
      { name: "--days", type: "number" },
    ],
  };

  test("an untouched form composes the bare command, not a wall of empty flags", () => {
    assert.equal(composeSkillCommand(skill, empty), "/pre-audit");
  });

  test("positional args are emitted in manifest order", () => {
    const s = {
      command: "/crm",
      args: [{ name: "cmd", required: true }, { name: "slug" }],
    };
    assert.equal(
      composeSkillCommand(s, { args: { slug: "blue-rose-auto", cmd: "stage" }, flags: {} }),
      "/crm stage blue-rose-auto"
    );
  });

  test("boolean flags are emitted bare when on, and omitted when off", () => {
    assert.equal(
      composeSkillCommand(skill, { args: { slug: "acme" }, flags: { "--collect": true } }),
      "/pre-audit acme --collect"
    );
    assert.equal(
      composeSkillCommand(skill, { args: { slug: "acme" }, flags: { "--collect": false } }),
      "/pre-audit acme"
    );
  });

  test("value flags are emitted as --flag value, skipping blank and whitespace-only", () => {
    assert.equal(
      composeSkillCommand(skill, {
        args: { slug: "acme" },
        flags: { "--business": "Acme Auto", "--days": "30", "--collect": false },
      }),
      '/pre-audit acme --business "Acme Auto" --days 30'
    );
    assert.equal(
      composeSkillCommand(skill, { args: { slug: "acme" }, flags: { "--business": "   " } }),
      "/pre-audit acme"
    );
  });

  test("values are quoted only when they need it", () => {
    assert.equal(quoteValue("acme"), "acme");
    assert.equal(quoteValue("Acme Auto"), '"Acme Auto"');
    assert.equal(quoteValue('say "hi"'), '"say \\"hi\\""');
    assert.equal(quoteValue("  padded  "), "padded");
    assert.equal(quoteValue(undefined), "");
  });

  test("a shared command names the companion so the picker's choice is not silent", () => {
    const organic = {
      command: "/image-gen",
      slug: "image-gen",
      companion: "skills/image-gen/image-gen.js",
      args: [{ name: "slug", required: true }],
    };
    const paid = { ...organic, slug: "image-gen-ads", companion: "skills/image-gen/image-gen-ads.js" };
    const values = { args: { slug: "blue-rose-auto" }, flags: {} };

    // Without the ambiguity flag the two are indistinguishable — that is the
    // bug this exists to prevent, so assert it explicitly.
    assert.equal(composeSkillCommand(organic, values), composeSkillCommand(paid, values));

    assert.equal(
      composeSkillCommand(paid, values, true),
      "/image-gen blue-rose-auto (run skills/image-gen/image-gen-ads.js)"
    );
    assert.notEqual(
      composeSkillCommand(organic, values, true),
      composeSkillCommand(paid, values, true)
    );
  });

  test("ambiguity clause is skipped when the entry has no companion to name", () => {
    const s = { command: "/x", slug: "x", args: [] };
    assert.equal(composeSkillCommand(s, empty, true), "/x");
  });
});

describe("missingRequiredArgs", () => {
  const skill = {
    command: "/proposal",
    args: [{ name: "slug", required: true }, { name: "tier" }],
  };

  test("reports required args that are empty, blank, or absent", () => {
    assert.deepEqual(missingRequiredArgs(skill, empty), ["slug"]);
    assert.deepEqual(missingRequiredArgs(skill, { args: { slug: "  " }, flags: {} }), ["slug"]);
  });

  test("is satisfied by a real value, and never blocks on optional args", () => {
    assert.deepEqual(missingRequiredArgs(skill, { args: { slug: "acme" }, flags: {} }), []);
  });

  test("does not invent flag-level validation the manifest doesn't state", () => {
    // pre-audit documents --business as "(required)" in its description, but
    // only conditionally (with --collect). That belongs to the skill, not the
    // launcher — so an empty --business must never block a launch.
    const preAudit = manifest.skills.find((s) => s.slug === "pre-audit");
    assert.deepEqual(missingRequiredArgs(preAudit, { args: { slug: "acme" }, flags: {} }), []);
  });
});

describe("against the real skills/manifest.json", () => {
  test("every bundled skill composes a non-empty command from an untouched form", () => {
    for (const skill of manifest.skills) {
      const composed = composeSkillCommand(skill, empty);
      assert.equal(composed, skill.command, `${skill.slug} composed "${composed}"`);
    }
  });

  test("/image-gen is the known shared command; a NEW collision fails here", () => {
    assert.deepEqual([...ambiguousCommands(manifest.skills)], ["/image-gen"]);
  });

  test("slugs are unique, so the launcher can key its picker on them", () => {
    const slugs = manifest.skills.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.ok(slugs.every(Boolean), "every entry needs a slug");
  });

  test("every flag declares a type the form can render", () => {
    const renderable = new Set(["string", "number", "boolean"]);
    for (const skill of manifest.skills) {
      for (const flag of skill.flags ?? []) {
        assert.ok(
          renderable.has(flag.type),
          `${skill.slug} ${flag.name} has unrenderable type ${JSON.stringify(flag.type)}`
        );
        assert.match(flag.name, /^--/, `${skill.slug} ${flag.name} should start with --`);
      }
    }
  });

  test("boolean flags never carry a value in a composed command", () => {
    for (const skill of manifest.skills) {
      const booleans = (skill.flags ?? []).filter(isBooleanFlag);
      if (!booleans.length) continue;
      const flags = Object.fromEntries(booleans.map((f) => [f.name, true]));
      const composed = composeSkillCommand(skill, { args: {}, flags });
      for (const f of booleans) {
        assert.match(composed, new RegExp(`${f.name.replace(/-/g, "\\-")}(\\s|$)`));
      }
    }
  });

  test("enum args only ever offer values the composer emits verbatim", () => {
    for (const skill of manifest.skills) {
      for (const arg of skill.args ?? []) {
        for (const option of arg.enum ?? []) {
          const composed = composeSkillCommand(skill, { args: { [arg.name]: option }, flags: {} });
          assert.ok(
            composed.split(/\s+/).includes(option),
            `${skill.slug} ${arg.name}=${option} did not survive composition`
          );
        }
      }
    }
  });
});
