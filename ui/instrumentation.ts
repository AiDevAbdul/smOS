// Runs once when the Next.js server process starts (Node runtime only — this
// UI is local-only, no edge runtime anywhere). Loads the same .env the rest of
// the repo's scripts/skills use, so route handlers and server components that
// import scripts/lib/*.js see the identical META_* / SUPABASE_* config as the
// CLI. Never expose these via NEXT_PUBLIC_ — the UI process reads them
// server-side only.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadEnv } = await import("../scripts/lib/load-env.js");
    loadEnv({ silent: true });
  }
}
