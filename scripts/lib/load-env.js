import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

export function resolveEnvPath() {
  if (process.env.SMOS_ENV_FILE && existsSync(process.env.SMOS_ENV_FILE)) {
    return process.env.SMOS_ENV_FILE;
  }
  const userScoped = join(homedir(), ".config", "smos", ".env");
  if (existsSync(userScoped)) return userScoped;
  const repoLocal = join(REPO_ROOT, ".env");
  if (existsSync(repoLocal)) return repoLocal;
  return null;
}

export function loadEnv({ silent = false } = {}) {
  const path = resolveEnvPath();
  if (!path) {
    if (!silent) {
      console.error(
        "[smos] No .env found. Place secrets at ~/.config/smos/.env (chmod 600) " +
          "or set SMOS_ENV_FILE to an explicit path."
      );
    }
    return null;
  }
  dotenvConfig({ path });
  return path;
}

/**
 * Fail-closed env preflight. Throws with an actionable message listing every
 * missing var, so a misconfigured plugin halts at startup instead of failing
 * deep inside an API call. Treats empty/whitespace values as missing.
 *
 * @param {string[]} names - env var names that must be present & non-empty
 * @param {string} [context] - short label for the error (e.g. "Meta MCP server")
 */
export function requireEnv(names, context = "smos") {
  const missing = names.filter((n) => !process.env[n] || !process.env[n].trim());
  if (missing.length) {
    throw new Error(
      `[${context}] Missing required env: ${missing.join(", ")}. ` +
        "Set them in ~/.config/smos/.env (see .env.example), or via SMOS_ENV_FILE."
    );
  }
}
