#!/usr/bin/env bash
# Starts the stack with podman-compose and records the output and exit code in a log file.
# Usage: scripts/compose-run.sh            (log: ./compose-run.log)
#        COMPOSE_LOG=/tmp/x.log scripts/compose-run.sh
set -u
cd "$(dirname "$0")/.."
LOG="${COMPOSE_LOG:-compose-run.log}"
podman-compose up -d --build > "$LOG" 2>&1
echo "EXIT:$?" >> "$LOG"
