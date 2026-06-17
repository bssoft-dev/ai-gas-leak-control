#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

HOST="${HUB_HOST:-0.0.0.0}"
PORT="${HUB_PORT:-26100}"

exec uvicorn gateway.hub.app:app --host "$HOST" --port "$PORT" --reload

