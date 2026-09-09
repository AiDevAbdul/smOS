// Human name for a client slug. Breadcrumbs and switchers showed the raw slug
// ("blue-rose-auto"); the profile already carries the real business name.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const titleCase = (slug: string) =>
  slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function clientDisplayName(slug: string): string {
  try {
    const p = resolve(REPO_ROOT, "clients", slug, "profile.json");
    if (!existsSync(p)) return titleCase(slug);
    const profile = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const name =
      (profile.business_name as string) ||
      (profile.client_name as string) ||
      (profile.name as string);
    return name || titleCase(slug);
  } catch {
    return titleCase(slug);
  }
}
