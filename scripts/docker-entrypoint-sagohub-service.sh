#!/bin/bash
# SagoHub 단일 서비스 컨테이너: Vite dev + SagoHub runner (main.py)
# docker-entrypoint-document-writer.sh 와 동일 패턴 — SERVICE_NAME 으로 프론트 경로 결정
set -euo pipefail

SERVICE="${SERVICE_NAME:-${SELECTED_SERVICE:-}}"
if [ -z "$SERVICE" ]; then
  echo "[entrypoint] SERVICE_NAME 또는 SELECTED_SERVICE 가 필요합니다." >&2
  exit 1
fi

FRONTEND_DIR="/app/services/${SERVICE}/frontend"
RUNNER_DIR="/app/src/SagoHub/runner"

NPM_PID=""

cleanup() {
  if [ -n "${NPM_PID}" ]; then
    kill "$NPM_PID" 2>/dev/null || true
  fi
}
trap cleanup SIGTERM SIGINT EXIT

if [ -f "${FRONTEND_DIR}/package.json" ]; then
  cd "$FRONTEND_DIR"
  if [ ! -d node_modules ]; then
    echo "[entrypoint] node_modules 없음 — npm ci 또는 npm install 실행 중..."
    if [ -f package-lock.json ]; then
      npm ci
    else
      npm install
    fi
  fi

  echo "[entrypoint] Vite dev 서버 시작 (백그라운드)"
  npm run dev &
  NPM_PID=$!
else
  echo "[entrypoint] ${FRONTEND_DIR}/package.json 없음 — Vite 생략"
fi

cd "$RUNNER_DIR"
echo "[entrypoint] python main.py"
python main.py
