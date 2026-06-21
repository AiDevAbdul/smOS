#!/usr/bin/env bash
# run-agent.sh <agent_name>
#
# Invokes the Claude CLI with the specified smOS agent's instructions.
# Designed to be called by cron — logs to logs/<agent>.log.
#
# Usage:
#   bash scripts/run-agent.sh optimizer
#   bash scripts/run-agent.sh reporter
#   bash scripts/run-agent.sh auditor

set -euo pipefail

AGENT="${1:?Usage: run-agent.sh <agent_name>}"
SMOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$SMOS_DIR/logs"
AGENT_FILE="$SMOS_DIR/agents/${AGENT}.md"
ENV_FILE="$HOME/.config/smos/.env"
LOG="$LOG_DIR/${AGENT}.log"
LOCK="$LOG_DIR/${AGENT}.lock"
# Honor a per-agent timeout: arg2 > env TIMEOUT_MINUTES > default 30.
TIMEOUT_MINUTES="${2:-${TIMEOUT_MINUTES:-30}}"

mkdir -p "$LOG_DIR"

log() { echo "[$(date -u +%FT%TZ)] $*" >> "$LOG"; }

if [[ ! -f "$AGENT_FILE" ]]; then
  log "ERROR: agent file not found: $AGENT_FILE"
  exit 1
fi

# ── Single-instance lock (prevents overlapping cron runs) ───────────────────
# flock is Linux-native; absent on stock macOS — degrade to a no-op there.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  if ! flock -n 9; then
    log "SKIP: previous $AGENT run still holding lock ($LOCK) — not starting a second instance"
    exit 0
  fi
fi

# Load smOS env vars into the process environment
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$')
  set +a
fi

PROMPT="$(cat "$AGENT_FILE")"

log "Starting agent: $AGENT (timeout ${TIMEOUT_MINUTES}m)"

cd "$SMOS_DIR"

# Wrap in a timeout when available (timeout=Linux, gtimeout=brew coreutils on mac).
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"; fi

# IMPORTANT: redirect stdout to the log FIRST, then dup stderr onto it, so BOTH
# streams are captured. The old `2>&1 >> log` order sent stderr to the terminal
# and lost it under cron. Don't let a non-zero exit kill the script before we log.
set +e
if [[ -n "$TIMEOUT_BIN" ]]; then
  "$TIMEOUT_BIN" "${TIMEOUT_MINUTES}m" claude --print "$PROMPT" >> "$LOG" 2>&1
else
  claude --print "$PROMPT" >> "$LOG" 2>&1
fi
EXIT_CODE=$?
set -e

if [[ "$EXIT_CODE" -eq 124 ]]; then
  log "ERROR: agent $AGENT timed out after ${TIMEOUT_MINUTES}m"
elif [[ "$EXIT_CODE" -ne 0 ]]; then
  log "ERROR: agent $AGENT exited non-zero (code=$EXIT_CODE)"
else
  log "Finished agent: $AGENT (ok)"
fi

exit "$EXIT_CODE"
