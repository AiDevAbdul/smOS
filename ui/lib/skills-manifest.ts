// ui/lib/skills-manifest.ts — server-side reader for skills/manifest.json.
//
// Closes the last open item in docs/ui-plan-design-system.md §4 Phase E: the
// palette was driven by the hand-maintained table in skill-routes.ts, which
// had to be kept in sync with CLAUDE.md by hand. manifest.json is generated
// from the skills themselves, so it can't drift — and it carries the args and
// flags each skill accepts, which the hand table never did.
//
// skill-routes.ts is kept as the fallback for the not-bundled external skills,
// which by definition have no local manifest entry.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STRATEGIC_INTELLIGENCE_ROUTES, CONTENT_PRODUCTION_ROUTES } from "./skill-routes";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SkillArg {
  name: string;
  required?: boolean;
  description?: string;
  enum?: string[];
}

export interface SkillFlag {
  name: string;
  type?: string;
  description?: string;
  default?: unknown;
}

export interface SkillEntry {
  command: string;
  label: string;
  available: boolean;
  note?: string;
  slug?: string;
  /** The skill's companion script, per the manifest. Used to disambiguate the
   *  two entries that share a command (`/image-gen` → image-gen.js for
   *  organic, image-gen-ads.js for paid). */
  companion?: string;
  args?: SkillArg[];
  flags?: SkillFlag[];
  /** True when the skill's first positional arg is a client slug — lets the
   *  palette pre-fill the client you're currently looking at. */
  takesSlug?: boolean;
}

interface RawManifest {
  skills?: Array<{
    slug: string;
    command: string;
    description?: string;
    companion?: string;
    args?: SkillArg[];
    flags?: SkillFlag[];
  }>;
}

/**
 * Manifest descriptions are full sentences written for a CLI (`"Issue retainer
 * invoices (Stripe) for a won/active client and track them in a per-client
 * ledger."`). A palette row needs a label, so take the first clause and cap it
 * — the full description still lives in the manifest for the launcher form.
 */
function toLabel(description: string | undefined, slug: string): string {
  if (!description) return slug;
  const first = description.split(/ — | – |\. /)[0].trim().replace(/\.$/, "");
  return first.length > 68 ? `${first.slice(0, 65).trimEnd()}…` : first;
}

let cache: SkillEntry[] | null = null;

export function getSkillIndex(): SkillEntry[] {
  if (cache) return cache;

  const bundled: SkillEntry[] = [];
  try {
    const p = resolve(REPO_ROOT, "skills", "manifest.json");
    if (existsSync(p)) {
      const m = JSON.parse(readFileSync(p, "utf8")) as RawManifest;
      for (const s of m.skills ?? []) {
        const first = s.args?.[0];
        bundled.push({
          command: s.command,
          label: toLabel(s.description, s.slug),
          available: true,
          slug: s.slug,
          companion: s.companion,
          args: s.args ?? [],
          flags: s.flags ?? [],
          takesSlug: /slug/i.test(first?.name ?? ""),
        });
      }
    }
  } catch {
    // Manifest unreadable — the external routes below still give a usable
    // palette, and the caller can fall back to skill-routes.ts.
  }

  const external: SkillEntry[] = [...STRATEGIC_INTELLIGENCE_ROUTES, ...CONTENT_PRODUCTION_ROUTES].map(
    (r) => ({ command: r.command, label: r.label, available: r.available, note: r.note })
  );

  // De-dupe: `social` appears in both external tables.
  const seen = new Set<string>();
  cache = [...bundled, ...external].filter((e) => {
    const k = `${e.command}|${e.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return cache;
}
