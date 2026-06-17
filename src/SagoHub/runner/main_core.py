#!/usr/bin/env python3
"""
SagoHub - 코어 전용 진입점
이벤트 버스 + 모듈만 실행. 서비스는 run-services.sh / start_pipelines.py로 별도 실행.
"""
import os
import sys
import time
import threading
from pathlib import Path

import requests
from requests.exceptions import RequestException

RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
sys.path.insert(0, str(SRC_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

from SagoHub.core.event_bus_server import run_event_bus_server

# 설정
EVENT_BUS_HOST = os.getenv("EVENT_BUS_HOST", "0.0.0.0")
EVENT_BUS_PORT = int(os.getenv("EVENT_BUS_PORT", "8000"))
EVENT_BUS_URL = os.getenv("EVENT_BUS_URL", f"http://localhost:{EVENT_BUS_PORT}")
# 헬스체크는 부하 시 1초로는 자주 타임아웃됨
EVENT_BUS_HEALTH_TIMEOUT = float(os.getenv("EVENT_BUS_HEALTH_TIMEOUT", "5"))
# 이 프로세스가 직접 기동한 이벤트 버스 헬스체크용.
# EVENT_BUS_URL은 서비스/모듈이 원격 버스에 붙을 때 쓰일 수 있어(예: sagohub.bs-soft.co.kr),
# 여기서는 로컬 리슨 포트로만 검사해야 함.
_health = os.getenv("EVENT_BUS_HEALTH_URL", "").strip()
EVENT_BUS_HEALTH_URL = _health if _health else f"http://127.0.0.1:{EVENT_BUS_PORT}"
WATCH_DIR = os.getenv("LOCAL_MOUNT_POINT", os.getenv("OUTBOX_DIR", str(PROJECT_ROOT / "obsidian")))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))


def main():
    print("=" * 60)
    print("SagoHub - 코어 (이벤트 버스 + 모듈)")
    print("=" * 60)
    print("서비스는 별도로 실행하세요: ./run-services.sh 또는 python3 start_pipelines.py")
    print("=" * 60)

    print(f"\n🚀 이벤트 버스 서버 시작: {EVENT_BUS_HOST}:{EVENT_BUS_PORT} (헬스: {EVENT_BUS_HEALTH_URL})")
    event_bus_thread = threading.Thread(target=run_event_bus_server, daemon=True, name="EventBusServer")
    event_bus_thread.start()

    for i in range(30):
        try:
            r = requests.get(
                f"{EVENT_BUS_HEALTH_URL}/health",
                timeout=EVENT_BUS_HEALTH_TIMEOUT,
            )
            if r.status_code == 200:
                print("✅ 이벤트 버스 서버 준비 완료")
                break
        except Exception:
            pass
        time.sleep(0.5)
    else:
        print("❌ 이벤트 버스 서버 시작 실패 (타임아웃)")
        sys.exit(1)

    print("이벤트 버스:", EVENT_BUS_URL)
    print("코어만 실행 중입니다. 서비스는 run-services.sh로 별도 실행하세요.")
    print("Ctrl+C로 종료")
    print("=" * 60)

    try:
        while True:
            try:
                r = requests.get(
                    f"{EVENT_BUS_HEALTH_URL}/health",
                    timeout=EVENT_BUS_HEALTH_TIMEOUT,
                )
                if r.status_code != 200:
                    print("⚠️ 이벤트 버스 서버 준비 실패")
                    break
            except RequestException as e:
                # ReadTimeout 등 — 코어 프로세스가 예외로 죽지 않도록 재시도
                print(f"⚠️ 이벤트 버스 헬스체크 실패(재시도): {e}")
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n[main_core] 코어 종료 중...")


if __name__ == "__main__":
    main()
