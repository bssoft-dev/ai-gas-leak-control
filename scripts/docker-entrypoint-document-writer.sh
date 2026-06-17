#!/bin/bash
# document-writer 단일 컨테이너: Vite dev + SagoHub runner (main.py)
set -euo pipefail

FRONTEND_DIR="/app/services/document-writer/frontend"
RUNNER_DIR="/app/src/SagoHub/runner"

NPM_PID=""

cleanup() {
  if [ -n "${NPM_PID}" ]; then
    kill "$NPM_PID" 2>/dev/null || true
  fi
}
trap cleanup SIGTERM SIGINT EXIT

cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  echo "[entrypoint] node_modules 없음 — npm ci 실행 중..."
  npm ci
fi

echo "[entrypoint] Vite dev 서버 시작 (백그라운드)"
npm run dev &
NPM_PID=$!

cd "$RUNNER_DIR"
echo "[entrypoint] python main.py"
python main.py
