#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULES_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$MODULES_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"
[ -f "$ENV_FILE" ] && export $(grep -v '^#' "$ENV_FILE" | xargs)
EVENT_BUS_URL="${EVENT_BUS_URL:-http://localhost:26010}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
export EVENT_BUS_URL POLL_INTERVAL
export PYTHONPATH="$PROJECT_ROOT/src"
cd "$PROJECT_ROOT"
exec python3 src/SagoHub/runner/module_runner.py gas_leak_server.GasLeakServerModule
