import type { NextConfig } from "next";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ui/ lives one level under the repo root; route handlers and server
// components import ../scripts/lib/*.js and ../skills/**/*.js directly, and
// spawn the repo-root `claude` CLI as a child process — outputFileTracingRoot
// must point at the repo root so those relative reads/traces resolve
// correctly in both `next dev` and a production build.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: REPO_ROOT,
  // Native / heavy deps pulled in transitively via scripts/lib/*.js — never
  // bundle these, load them at runtime like every other Node script in the repo.
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "@supabase/supabase-js", "satori"],
};

export default nextConfig;
