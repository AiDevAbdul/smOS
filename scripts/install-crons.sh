#!/usr/bin/env bash
# install-crons.sh
#
# Reads the SCHEDULES from scheduler.js and installs them as native crontab
# entries. Safe to re-run — removes any existing smOS entries first.
#
# Usage:
#   bash scripts/install-crons.sh          # install / update
#   bash scripts/install-crons.sh --remove # remove all smOS cron entries
#   bash scripts/install-crons.sh --list   # print what would be installed

set -euo pipefail

SMOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="# smOS-managed"
RUNNER="$SMOS_DIR/scripts/run-agent.sh"

# Read schedule definitions from scheduler.js
SCHEDULES_JSON="$(node "$SMOS_DIR/scripts/scheduler.js")"

if [[ "${1:-}" == "--remove" ]]; then
  echo "Removing all smOS cron entries..."
  (crontab -l 2>/dev/null || true) | grep -v "$MARKER" | crontab -
  echo "Done."
  exit 0
fi

# Build new cron lines from the schedule definitions
NEW_ENTRIES=""
while IFS= read -r entry; do
  name="$(echo "$entry" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8').trim(); const o=JSON.parse(d); process.stdout.write(o.name)")"
  agent="$(echo "$entry" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8').trim(); const o=JSON.parse(d); process.stdout.write(o.agent)")"
  cron_expr="$(echo "$entry" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8').trim(); const o=JSON.parse(d); process.stdout.write(o.cron)")"
  desc="$(echo "$entry" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8').trim(); const o=JSON.parse(d); process.stdout.write(o.description)")"

  line="${cron_expr} bash ${RUNNER} ${agent} $MARKER (${name}: ${desc})"
  NEW_ENTRIES="${NEW_ENTRIES}${line}\n"
done < <(echo "$SCHEDULES_JSON" | node -e "
  const data = require('fs').readFileSync('/dev/stdin','utf8');
  const schedules = JSON.parse(data);
  schedules.forEach(s => console.log(JSON.stringify(s)));
")

if [[ "${1:-}" == "--list" ]]; then
  echo "Would install these cron entries:"
  echo -e "$NEW_ENTRIES"
  exit 0
fi

# Strip existing smOS entries then append fresh ones
CURRENT="$(crontab -l 2>/dev/null || true)"
CLEANED="$(echo "$CURRENT" | grep -v "$MARKER" || true)"

{
  [[ -n "$CLEANED" ]] && echo "$CLEANED"
  echo -e "$NEW_ENTRIES"
} | crontab -

echo "smOS cron entries installed:"
crontab -l | grep "$MARKER"
