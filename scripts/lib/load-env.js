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
