#!/usr/bin/env python3
"""
모듈 실행 스크립트: 각 모듈을 독립적으로 실행
사용법: python module_runner.py <module_name>
"""
import os
import sys
from pathlib import Path

RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
sys.path.insert(0, str(SRC_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

from SagoHub.core.module_loader import get_module_map
from SagoHub.core.http_client import EventBusHTTPClient

MODULE_MAP = get_module_map(PROJECT_ROOT)


def _resolve_event_bus_url() -> str:
    """이벤트 버스 HTTP 클라이언트용 URL. 0.0.0.0 은 바인드 전용이므로 루프백으로 치환."""
    explicit = os.getenv("EVENT_BUS_URL")
    if explicit:
        return explicit.rstrip("/")
    host = os.getenv("EVENT_BUS_HOST", "0.0.0.0")
    port = int(os.getenv("EVENT_BUS_PORT", "26010"))
    if host == "0.0.0.0":
        host = "127.0.0.1"
    elif host == "::":
        host = "[::1]"
    return f"http://{host}:{port}"


EVENT_BUS_URL = _resolve_event_bus_url()
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))

# print(f"EVENT_BUS_HOST: {EVENT_BUS_HOST}")
# print(f"EVENT_BUS_PORT: {EVENT_BUS_PORT}")
# print(f"EVENT_BUS_URL: {EVENT_BUS_URL}")
# print(f"POLL_INTERVAL: {POLL_INTERVAL}")


def main(module_name):

    module_class = MODULE_MAP[module_name]
    module_id = f"{module_class.__module__.split('.')[-1]}.{module_class.__name__}"

    try:
        client = EventBusHTTPClient(EVENT_BUS_URL)
        registered_module = client.get_module(module_id)
        if registered_module and registered_module.get("health_status") != "unhealthy":
            print(f"🚀 {module_class.name} 모듈 이미 실행 중...")
            sys.exit(1)
        else:
            print(f"🚀 {module_class.name} 모듈 시작 중...")
            print(f"SagoHub URL: {EVENT_BUS_URL}")
            module_instance = module_class()
            module_instance.run(event_bus_url=EVENT_BUS_URL, poll_interval=POLL_INTERVAL)
    except Exception as e:
        print(f"⚠️  이벤트 버스 확인 실패 ({e}), 모듈 시작을 계속합니다.")

    print(f"🚀 {module_class.name} 모듈 시작 중...")
    print(f"SagoHub URL: {EVENT_BUS_URL}")

    module_instance = module_class()

    try:
        module_instance.run(event_bus_url=EVENT_BUS_URL, poll_interval=POLL_INTERVAL)
    except KeyboardInterrupt:
        print(f"\n[{module_class.name}] 종료됨")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python module_runner.py <module_name>")
        print(f"사용 가능한 모듈: {', '.join(MODULE_MAP.keys())}")
        sys.exit(1)

    module_name = sys.argv[1]
    if module_name not in MODULE_MAP:
        print(f"❌ 알 수 없는 모듈: {module_name}")
        print(f"사용 가능한 모듈: {', '.join(MODULE_MAP.keys())}")
        sys.exit(1)
    main(module_name)
