#!/usr/bin/env python3
"""
SagoHub - 모듈 전용 진입점
모듈만 실행. 코어는 run-core.sh, 서비스는 run-services.sh / start_pipelines.py로 별도 실행.

아키텍처:
1. 모듈: 이벤트 발생 시 버스에 발행 (버스는 run-core.sh로 이미 떠 있어야 함)
2. 버스: 등록된 서비스로 이벤트 전달 (서비스 프로세스가 파이프라인 처리)
3. 서비스: 이벤트 수신 후 파이프라인으로 모듈 호출
"""
import os
import sys
import time
import threading
from pathlib import Path

RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
sys.path.insert(0, str(SRC_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

# 설정
EVENT_BUS_HOST = os.getenv("EVENT_BUS_HOST", "0.0.0.0")
EVENT_BUS_PORT = int(os.getenv("EVENT_BUS_PORT", "8000"))
EVENT_BUS_URL = os.getenv("EVENT_BUS_URL", f"http://{EVENT_BUS_HOST}:{EVENT_BUS_PORT}")
WATCH_DIR = os.getenv("LOCAL_MOUNT_POINT", os.getenv("OUTBOX_DIR", str(PROJECT_ROOT / "obsidian")))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))


def main():
    print("=" * 60)
    print("SagoHub - 모듈만 실행")
    print("=" * 60)
    print("코어(이벤트 버스)는 run-core.sh로 먼저 실행하세요.")
    print("서비스는 run-services.sh 또는 start_pipelines.py로 별도 실행.")
    print("=" * 60)

    # 이벤트 버스 준비 대기 (코어가 이미 떠 있어야 함)
    print(f"\n⏳ 이벤트 버스 준비 대기: {EVENT_BUS_URL}")
    import requests
    for i in range(60):
        try:
            r = requests.get(f"{EVENT_BUS_URL}/health", timeout=2)
            if r.status_code == 200:
                print("✅ 이벤트 버스 준비 완료")
                break
        except Exception:
            pass
        if (i + 1) % 10 == 0:
            print(f"  ⏳ 대기 중... ({i + 1}/60)")
        time.sleep(1)
    else:
        print("❌ 이벤트 버스 연결 실패. run-core.sh를 먼저 실행하세요.")
        sys.exit(1)

    # 모듈 로드 및 스레드 시작
    print("\n📦 모듈 실행 중...")
    from SagoHub.core.module_loader import get_module_map
    _module_map = get_module_map(PROJECT_ROOT)
    module_classes = list(_module_map.values())

    module_threads = []
    for module_class in module_classes:
        try:
            if module_class.name == "M_FileWatcher":
                instance = module_class(watch_dir=WATCH_DIR, event_bus_url=EVENT_BUS_URL)
            else:
                instance = module_class()
            interval = POLL_INTERVAL if module_class.name == "M_FileWatcher" else max(POLL_INTERVAL, 3)
            t = threading.Thread(
                target=instance.run,
                args=(EVENT_BUS_URL, interval, True),
                daemon=True,
                name=f"Module-{module_class.name}",
            )
            t.start()
            module_threads.append(t)
            print(f"  ✅ {module_class.name} 시작됨")
        except Exception as e:
            print(f"  ⚠️ {module_class.name} 시작 실패: {e}")

    print(f"\n모듈 {len(module_threads)}개 실행 중. 이벤트 버스: {EVENT_BUS_URL}")
    print("Ctrl+C로 종료")
    print("=" * 60)

    try:
        while True:
            try:
                r = requests.get(f"{EVENT_BUS_URL}/health", timeout=2)
                if r.status_code != 200:
                    print("⚠️ 이벤트 버스 연결 끊김")
                    break
            except Exception:
                print("⚠️ 이벤트 버스 연결 끊김")
                break
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n[main_modules] 모듈 프로세스 종료 중...")


if __name__ == "__main__":
    main()
