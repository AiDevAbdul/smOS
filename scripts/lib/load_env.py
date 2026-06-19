"""Resolve and load smOS env vars.

Precedence:
  1. $SMOS_ENV_FILE if set and exists
  2. ~/.config/smos/.env
  3. <repo>/.env (dev fallback)

No external deps — parses KEY=VALUE pairs from the chosen file and sets
os.environ for any key not already present in the process environment.
"""

import os
from pathlib import Path


def _candidate_paths():
    explicit = os.environ.get("SMOS_ENV_FILE")
    if explicit:
        yield Path(explicit)
    yield Path.home() / ".config" / "smos" / ".env"
    yield Path(__file__).resolve().parent.parent.parent / ".env"


def resolve_env_path():
    for p in _candidate_paths():
        if p.is_file():
            return p
    return None


def _parse_line(line: str):
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if "=" not in line:
        return None
    key, _, value = line.partition("=")
    key = key.strip()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    return key, value


def load_env(override: bool = False) -> Path | None:
    path = resolve_env_path()
    if path is None:
        return None
    with path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            parsed = _parse_line(raw)
            if parsed is None:
                continue
            key, value = parsed
            if override or key not in os.environ:
                os.environ[key] = value
    return path
