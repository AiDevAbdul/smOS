// ui/lib/health.ts — server-only "Settings / Health" data loader.
//
// Everything here is best-effort and read-only: it never executes anything
// beyond `claude --version` (to prove the CLI is on PATH and its version),
// and never queries a live MCP connection — mcpServers is inferred from what
// is present on disk. envKeysPresent NEVER reads or exposes a secret value,
// only the key name, per CLAUDE.md's own secrets discipline.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Only key *names* starting with these prefixes are ever surfaced — never values.
const ENV_PREFIX_ALLOWLIST = ["META_", "SUPABASE_", "DISCORD_", "STRIPE_", "ANTHROPIC_", "SMOS_"];

export interface ClaudeVersionInfo {
  version: string | null;
  error: string | null;
}

export interface HookMatcherSummary {
  matcher: string;
  hooks: string[]; // basenames of the hook command scripts
}

export interface HooksLoadedSummary {
  ok: boolean;
  error: string | null;
  byEvent: Record<string, HookMatcherSummary[]>;
  totalMatchers: number;
  totalHookCommands: number;
}

export interface McpServerInfo {
  name: string;
  source: string; // where it was found, e.g. ".mcp.json" or "mcp/meta-server"
}

export interface HealthReport {
  claudeVersion: ClaudeVersionInfo;
  hooksLoaded: HooksLoadedSummary;
  envKeysPresent: string[];
  mcpServers: McpServerInfo[];
}

function getClaudeVersion(): ClaudeVersionInfo {
  try {
    const out = execFileSync("claude", ["--version"], { encoding: "utf8", timeout: 5000 }).trim();
    return { version: out || null, error: out ? null : "empty output from `claude --version`" };
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function basenameOfHookCommand(command: string): string {
  // e.g. "node ${CLAUDE_PLUGIN_ROOT}/hooks/budget-guard.js" -> "budget-guard.js"
  const parts = command.trim().split(/\s+/);
  const last = parts[parts.length - 1] || command;
  const segments = last.split("/");
  return segments[segments.length - 1];
}

function getHooksLoaded(): HooksLoadedSummary {
  const hooksPath = resolve(REPO_ROOT, "hooks", "hooks.json");
  if (!existsSync(hooksPath)) {
    return { ok: false, error: "hooks/hooks.json not found", byEvent: {}, totalMatchers: 0, totalHookCommands: 0 };
  }
  try {
    const raw = readFileSync(hooksPath, "utf8");
    const parsed = JSON.parse(raw);
    const hooksNode = parsed.hooks ?? parsed;
    const byEvent: Record<string, HookMatcherSummary[]> = {};
    let totalMatchers = 0;
    let totalHookCommands = 0;
    for (const [event, matchers] of Object.entries(hooksNode)) {
      if (!Array.isArray(matchers)) continue;
      const summaries: HookMatcherSummary[] = matchers.map((m: any) => {
        const hookList = Array.isArray(m?.hooks) ? m.hooks : [];
        const names = hookList
          .map((h: any) => (typeof h?.command === "string" ? basenameOfHookCommand(h.command) : null))
          .filter((n: string | null): n is string => n !== null);
        totalHookCommands += names.length;
        return { matcher: typeof m?.matcher === "string" ? m.matcher : "", hooks: names };
      });
      totalMatchers += summaries.length;
      byEvent[event] = summaries;
    }
    return { ok: true, error: null, byEvent, totalMatchers, totalHookCommands };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      byEvent: {},
      totalMatchers: 0,
      totalHookCommands: 0,
    };
  }
}

function getEnvKeysPresent(): string[] {
  const keys = Object.keys(process.env).filter((k) => ENV_PREFIX_ALLOWLIST.some((prefix) => k.startsWith(prefix)));
  return keys.sort();
}

function getMcpServers(): McpServerInfo[] {
  const servers: McpServerInfo[] = [];

  const mcpConfigPath = resolve(REPO_ROOT, ".mcp.json");
  if (existsSync(mcpConfigPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
      const entries = parsed.mcpServers ?? parsed.servers ?? {};
      for (const name of Object.keys(entries)) {
        servers.push({ name, source: ".mcp.json" });
      }
    } catch {
      // best-effort — malformed config just yields no entries from this source
    }
  }

  const mcpDir = resolve(REPO_ROOT, "mcp");
  if (existsSync(mcpDir)) {
    try {
      const dirs = readdirSync(mcpDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const d of dirs) {
        const pkgPath = join(mcpDir, d.name, "package.json");
        let name = d.name;
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
            if (typeof pkg.name === "string" && pkg.name) name = pkg.name;
          } catch {
            // keep dir name as fallback
          }
        }
        servers.push({ name, source: `mcp/${d.name}` });
      }
    } catch {
      // best-effort
    }
  }

  return servers;
}

export function getHealth(): HealthReport {
  return {
    claudeVersion: getClaudeVersion(),
    hooksLoaded: getHooksLoaded(),
    envKeysPresent: getEnvKeysPresent(),
    mcpServers: getMcpServers(),
  };
}
