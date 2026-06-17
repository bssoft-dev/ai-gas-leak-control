#!/usr/bin/env bash
# M_EventRelay 모듈 실행 (이벤트 타입 변환용)
# 주의: 이 모듈은 동적으로 source_type과 target_type을 설정해야 하므로
# 직접 실행하기보다는 서비스 파이프라인에서 사용하는 것이 좋습니다.
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
# 주의: 이 모듈은 동적 설정이 필요하므로 직접 실행하지 않습니다.
# exec python3 src/SagoHub/runner/module_runner.py event_relay.EventRelayModule
