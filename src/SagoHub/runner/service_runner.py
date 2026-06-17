#!/usr/bin/env python3
"""
서비스 실행 스크립트: 각 서비스를 독립적으로 실행
사용법: python service_runner.py <service_id>
종료 시 이벤트 버스에서 서비스 등록 해제를 수행합니다.
"""
import atexit
import os
import signal
import sys
import threading
import time
from pathlib import Path

RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
sys.path.insert(0, str(SRC_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

from SagoHub.core import Orchestrator
from SagoHub.core.http_client import EventBusHTTPClient
from SagoHub.service import ServiceManager

def _resolve_event_bus_url() -> str:
    explicit = os.getenv("EVENT_BUS_URL")
    if explicit:
        return explicit.rstrip("/")
    host = os.getenv("EVENT_BUS_HOST", "0.0.0.0")
    port = int(os.getenv("EVENT_BUS_PORT", "8000"))
    if host == "0.0.0.0":
        host = "127.0.0.1"
    elif host == "::":
        host = "[::1]"
    return f"http://{host}:{port}"


EVENT_BUS_URL = _resolve_event_bus_url()
SERVICES_DIR = Path(os.getenv("SERVICES_DIR", os.getenv("PIPELINES_DIR", str(PROJECT_ROOT / "services"))))

_cleanup_service_id = None
_cleanup_http_client = None
_cleanup_service_manager = None
_cleanup_done = False


def _unregister_service():
    global _cleanup_done
    if _cleanup_done or not _cleanup_service_id or not _cleanup_http_client:
        return
    _cleanup_done = True
    try:
        _cleanup_http_client.delete_service(_cleanup_service_id)
        print(f"✅ 서비스 등록 해제 완료: {_cleanup_service_id}")
    except Exception as e:
        print(f"⚠️  서비스 등록 해제 실패: {e}")
    if _cleanup_service_manager:
        try:
            _cleanup_service_manager.deactivate_service(_cleanup_service_id)
        except Exception:
            pass


def main():
    if len(sys.argv) < 2:
        print("사용법: python service_runner.py <service_id>")
        print("예: python service_runner.py com.SagoHub.file-monitor")
        sys.exit(1)

    service_id = sys.argv[1]
    print("=" * 60)
    print(f"🚀 서비스 실행: {service_id}")
    print("=" * 60)
    print(f"SagoHub URL: {EVENT_BUS_URL}")
    print(f"서비스 디렉토리: {SERVICES_DIR}")
    print("")

    print("⏳ SagoHub 서버 연결 중...")
    import requests
    for retry_count in range(60):
        try:
            if requests.get(f"{EVENT_BUS_URL}/health", timeout=2).status_code == 200:
                print("✅ SagoHub 서버 준비 완료")
                break
        except Exception:
            pass
        if (retry_count + 1) % 10 == 0:
            print(f"  ⏳ [service_runner] 대기 중... ({retry_count + 1}/60)")
        time.sleep(1)
    else:
        print(f"❌ SagoHub 서버 연결 실패: {EVENT_BUS_URL}")
        sys.exit(1)

    orch = Orchestrator(event_bus_url=EVENT_BUS_URL)
    service_manager = ServiceManager(SERVICES_DIR, orchestrator=orch)
    http_client = EventBusHTTPClient(EVENT_BUS_URL)

    print(f"\n📦 서비스 로드 중...")
    services = service_manager.load_all()
    if service_id not in services:
        print(f"❌ 서비스를 찾을 수 없습니다: {service_id}")
        for s_id in services.keys():
            print(f"     - {s_id}")
        sys.exit(1)

    service_def = services[service_id]
    print(f"✅ 서비스 로드 완료: {service_def.metadata.name}")

    print("\n⏳ 모듈 등록 완료 대기 중...")
    
    # 가상 모듈 이름을 실제 모듈 ID로 매핑
    VIRTUAL_MODULE_MAP = {
        "fs.read": None,  # 가상 모듈, 스킵
        "ai.llm.draft_email": "llm_drafter.LLMDrafterModule",
        "nudge.create_draft": "nudge_ui.NudgeUIModule",
        "nudge.check_approval": "nudge_ui.NudgeUIModule",
        "mail.send": "mailer.MailerModule",
        "monitor.log_change": "monitor.MonitorLogModule",
        "monitor.console_output": "monitor.MonitorConsoleModule",
    }
    
    required_modules = set()
    for pipeline_def in service_def.pipelines:
        if pipeline_def.broadcast:
            for bc_call in pipeline_def.broadcast:
                virtual_name = bc_call.module
                # 가상 모듈 매핑
                actual_module_id = VIRTUAL_MODULE_MAP.get(virtual_name)
                if actual_module_id is None:
                    # 가상 모듈이 아니거나 스킵해야 하는 경우
                    if virtual_name in VIRTUAL_MODULE_MAP:
                        continue  # fs.read 같은 가상 모듈은 스킵
                    # 이미 실제 모듈 ID인 경우 그대로 사용
                    actual_module_id = virtual_name
                required_modules.add(actual_module_id)

    wait_count = 0
    started_modules = set()  # 이미 시작한 모듈 추적
    
    while wait_count < 60:
        try:
            response = requests.get(f"{EVENT_BUS_URL}/modules", timeout=2)
            if response.status_code == 200:
                modules_list = response.json()
                registered_module_ids = {m.get("module_id") for m in modules_list}
                # 정상(healthy)인 모듈만 '등록 완료'로 간주. 비정상이면 재시작 대상.
                registered_healthy_ids = {
                    m.get("module_id") for m in modules_list
                    if m.get("health_status") != "unhealthy"
                }
                # 누락되었거나 등록돼 있으나 비정상인 모듈 → 시작(또는 재생성) 대상
                missing_or_unhealthy = required_modules - registered_healthy_ids
                modules_to_start = missing_or_unhealthy - started_modules

                if modules_to_start:
                    print(f"  필요한 모듈: {required_modules}")
                    print(f"  등록된 모듈(전체): {registered_module_ids}")
                    print(f"  정상 상태 모듈: {registered_healthy_ids}")
                    print(f"  누락/비정상 모듈: {missing_or_unhealthy}")

                    for module_id in modules_to_start:
                        # 등록돼 있으나 비정상인 경우: 삭제 후 새로 등록되도록 함
                        if module_id in registered_module_ids and module_id not in registered_healthy_ids:
                            try:
                                http_client.delete_module(module_id)
                                print(f"  🗑️  비정상 모듈 삭제 후 재등록 예정: {module_id}")
                            except Exception as e:
                                print(f"  ⚠️  모듈 삭제 실패 (재등록으로 진행): {module_id} ({e})")
                        # 모듈 실행 스레드 생성
                        try:
                            from SagoHub.runner.module_runner import main as run_module
                            module_thread = threading.Thread(
                                target=run_module,
                                args=(module_id,),
                                daemon=True,
                            )
                            module_thread.start()
                            started_modules.add(module_id)
                            print(f"  🚀 모듈 시작: {module_id}")
                            time.sleep(0.5)
                        except Exception as e:
                            print(f"  ⚠️  모듈 시작 실패 ({module_id}): {e}")
                elif not missing_or_unhealthy:
                    print(f"✅ 필요한 모듈 등록 완료 (정상 상태)")
                    break
        except Exception as e:
            if wait_count % 10 == 0:
                print(f"  ⏳ 모듈 목록 조회 중... ({e})")
        wait_count += 1
        time.sleep(1)
        

    if wait_count >= 60:
        print("⚠️  일부 모듈이 등록되지 않았거나 정상 상태가 아닙니다. 계속 진행합니다...")

    print(f"\n🔧 서비스 활성화 중...")
    if not service_manager.activate_service(service_id):
        print(f"❌ 서비스 활성화 실패: {service_id}")
        sys.exit(1)

    from service_ui_runner import main as run_ui_server
    ui_thread = threading.Thread(
        target=run_ui_server,
        args=(service_id,),
        kwargs={"services_dir": str(SERVICES_DIR), "event_bus_url": EVENT_BUS_URL},
        daemon=True,
    )
    ui_thread.start()

    from main import _register_service
    _register_service(http_client, service_manager, service_id)

    global _cleanup_service_id, _cleanup_http_client, _cleanup_service_manager
    _cleanup_service_id = service_id
    _cleanup_http_client = http_client
    _cleanup_service_manager = service_manager
    atexit.register(_unregister_service)

    def _on_signal(signum, frame):
        print("\n서비스 종료 중...")
        _unregister_service()
        sys.exit(0)

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    print(f"\n✅ 서비스 실행 완료: {service_id}")
    print("Ctrl+C로 종료 (종료 시 이벤트 버스에서 등록 해제)")
    print("=" * 60)

    try:
        while True:
            if service_id not in service_manager.list_active():
                print(f"⚠️  서비스가 비활성화되었습니다: {service_id}")
                break
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n서비스 종료 중...")
    finally:
        _unregister_service()


if __name__ == "__main__":
    main()
