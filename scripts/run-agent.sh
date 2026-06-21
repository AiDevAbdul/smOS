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

mkdir -p "$LOG_DIR"

if [[ ! -f "$AGENT_FILE" ]]; then
  echo "[$(date -u +%FT%TZ)] ERROR: agent file not found: $AGENT_FILE" >> "$LOG_DIR/${AGENT}.log"
  exit 1
fi

# Load smOS env vars into the process environment
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$')
  set +a
fi

PROMPT="$(cat "$AGENT_FILE")"
TIMESTAMP="$(date -u +%FT%TZ)"

echo "[$TIMESTAMP] Starting agent: $AGENT" >> "$LOG_DIR/${AGENT}.log"

cd "$SMOS_DIR"
claude --print "$PROMPT" 2>&1 >> "$LOG_DIR/${AGENT}.log"

echo "[$(date -u +%FT%TZ)] Finished agent: $AGENT" >> "$LOG_DIR/${AGENT}.log"
