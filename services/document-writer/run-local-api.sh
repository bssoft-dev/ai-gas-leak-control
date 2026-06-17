#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
LAPI="$ROOT/local_api"
cd "$LAPI"
export PYTHONPATH="$LAPI${PYTHONPATH:+:$PYTHONPATH}"
if [[ -f "$ROOT/../../.env" ]]; then
  set -a
  set +e
  # shellcheck disable=SC1090
  source "$ROOT/../../.env"
  set -e
  set +a
fi
export OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-$HOME/obsidian}"
export SAYU_LOCAL_API_PORT="${SAYU_LOCAL_API_PORT:-27100}"
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
else
  PY="python3"
fi
exec "$PY" -m uvicorn main:app --host 0.0.0.0 --port "$SAYU_LOCAL_API_PORT"
