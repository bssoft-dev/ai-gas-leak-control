#!/usr/bin/env python3
"""
SagoHub - Service-Oriented Foldering Engine
서비스 기반 폴더링 시스템 메인 진입점

아키텍처:
- 서비스(Service): 하나의 service.yaml 파일로 정의됨
- 파이프라인(Pipeline): 서비스 내부에 여러 개의 파이프라인이 있을 수 있음
  - 각 파이프라인은 특정 이벤트를 트리거로 받아서 모듈들을 브로드캐스트함
  - 구조: Trigger(이벤트 처리 전략 포함) -> Broadcast(Modules)
    - Trigger: 파이프라인을 시작하는 이벤트 및 이벤트 처리 전략 (aggregation 포함)
      - aggregation: 여러 모듈이 각각 응답 이벤트를 발행할 때, 그 이벤트들 간의 충돌을 해결하는 전략
        (INDEPENDENT: 독립 처리, PRIORITY: 우선순위, LATEST: 최신 우선, MERGE: 합병)
    - Broadcast: 트리거 이벤트를 여러 모듈에게 동시에 전달 (병렬 처리)

SagoHub 서버를 시작하고, HTTP를 통해 통신합니다.
Docker 사용 여부는 USE_DOCKER 환경 변수로 제어됩니다.
"""
import os
import sys
import time
import subprocess
import threading
from pathlib import Path

# SagoHub/runner -> SagoHub -> src
RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
ENGINE_ROOT = RUNNER_ROOT
sys.path.insert(0, str(SRC_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env")

from SagoHub.core import Event
from SagoHub.core.http_client import EventBusHTTPClient
from SagoHub.service import ServiceManager
from SagoHub.service.schema import UIServerConfig

# 서비스 정의(dataclass) → SagoHub Pydantic 모델 변환용
from SagoHub.core.event_bus_server import (
    ServiceInfo,
    ServiceMetadata as EBServiceMetadata,
    PipelineInfo as EBPipelineInfo,
    PipelineTrigger as EBPipelineTrigger,
    AggregationInfo as EBAggregationInfo,
    ModuleCallInfo as EBModuleCallInfo,
    InterfaceInfo as EBInterfaceInfo,
    ConflictResolutionStrategy,
    run_event_bus_server,
)

# 설정
USE_DOCKER = os.getenv("USE_DOCKER", "false").lower() in ("true", "1", "yes")
SERVICES_DIR = Path(os.getenv("PIPELINES_DIR", os.getenv("SERVICES_DIR", str(PROJECT_ROOT / "services"))))
WATCH_DIR = os.getenv("LOCAL_MOUNT_POINT", os.getenv("OUTBOX_DIR", str(PROJECT_ROOT / "obsidian")))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "5"))
EVENT_BUS_HOST = os.getenv("EVENT_BUS_HOST", "0.0.0.0")
EVENT_BUS_PORT = int(os.getenv("EVENT_BUS_PORT", "8000"))
EVENT_BUS_URL = os.getenv("EVENT_BUS_URL", f"http://localhost:{EVENT_BUS_PORT}")


def run_docker():
    """Docker Compose로 엔진 실행"""
    print("=" * 60)
    print("SagoHub - Foldering Engine (Docker Mode)")
    print("=" * 60)
    print(f"Docker Compose로 엔진을 실행합니다...")
    print(f"서비스 디렉토리: {SERVICES_DIR}")
    print(f"감시 디렉토리: {WATCH_DIR}")
    print("=" * 60)
    print("⚠️  서비스는 별도 컨테이너로 실행됩니다.")
    print("   서비스 실행: start_pipelines.py를 사용하세요.")
    print("=" * 60)
    
    # docker-compose.yml 경로
    compose_file = ENGINE_ROOT / "docker-compose.yml"
    
    # 환경 변수 설정
    env = os.environ.copy()
    env["PIPELINES_DIR"] = str(SERVICES_DIR)  # 하위 호환성
    env["SERVICES_DIR"] = str(SERVICES_DIR)
    env["LOCAL_MOUNT_POINT"] = str(WATCH_DIR)
    
    try:
        # docker-compose up 실행
        subprocess.run(
            ["docker-compose", "-f", str(compose_file), "up"],
            cwd=str(ENGINE_ROOT),
            env=env,
            check=True
        )
    except subprocess.CalledProcessError as e:
        print(f"❌ Docker Compose 실행 실패: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print("❌ docker-compose 명령을 찾을 수 없습니다.")
        print("   Docker Compose가 설치되어 있는지 확인하세요.")
        sys.exit(1)


def run_direct():
    """직접 Python으로 엔진 실행"""
    print("=" * 60)
    print("SagoHub - Service-Oriented Foldering Engine")
    print("=" * 60)
    print("⚠️  서비스는 별도 프로세스로 실행됩니다.")
    print("   서비스 실행: start_pipelines.py를 사용하세요.")
    print("=" * 60)
    
    # SagoHub 서버 시작 (별도 스레드)
    print(f"🚀 SagoHub 서버 시작: {EVENT_BUS_URL}")
    event_bus_thread = threading.Thread(
        target=run_event_bus_server,
        daemon=True
    )
    event_bus_thread.start()
    
    # SagoHub 서버가 시작될 때까지 대기
    import requests
    max_retries = 30
    retry_count = 0
    while retry_count < max_retries:
        try:
            response = requests.get(f"{EVENT_BUS_URL}/health", timeout=1)
            if response.status_code == 200:
                print(f"✅ SagoHub 서버 준비 완료")
                break
        except Exception:
            pass
        retry_count += 1
        time.sleep(0.5)
    else:
        print(f"❌ SagoHub 서버 시작 실패 (타임아웃)")
        sys.exit(1)
    
    # HTTP 클라이언트 생성 (모듈 등록용)
    http_client = EventBusHTTPClient(EVENT_BUS_URL)
    
    # Orchestrator 및 PipelineManager 생성 (서비스 로드용)
    from SagoHub.core import Orchestrator
    orch = Orchestrator(event_bus_url=EVENT_BUS_URL)
    service_manager = ServiceManager(SERVICES_DIR, orchestrator=orch)
    
    # 핵심 모듈들을 별도 스레드로 실행
    print("\n📦 핵심 모듈 시작 중...")
    
    # modules/ 폴더에서 모든 모듈 클래스 동적으로 가져오기
    from SagoHub.core.module_loader import get_module_map
    _module_map = get_module_map(PROJECT_ROOT)
    module_classes = list(_module_map.values())
            
    
    # 각 모듈을 별도 스레드로 실행
    module_threads = []
    for module_class in module_classes:
        try:
            # 모듈 인스턴스 생성 (각 모듈의 __init__ 시그니처에 맞게)
            if module_class.name == "M_FileWatcher":
                module_instance = module_class(watch_dir=WATCH_DIR, event_bus_url=EVENT_BUS_URL)
            elif module_class.name == "M_Monitor_Log":
                module_instance = module_class()
            elif module_class.name == "M_Monitor_Console":
                module_instance = module_class()
            else:
                # 기본 생성자로 인스턴스 생성
                module_instance = module_class()
            
            # 모듈을 별도 스레드로 실행
            # 모든 모듈은 동일한 인터페이스 사용 (push 방식)
            if module_class.name == "M_FileWatcher":
                module_poll_interval = POLL_INTERVAL
                use_push = True  # FileWatcher도 push 방식 사용
            else:
                # 다른 모듈들은 이벤트 처리용이므로 더 긴 간격으로 폴링
                module_poll_interval = max(POLL_INTERVAL, 3)  # 최소 3초
                use_push = True  # 다른 모듈들은 푸시 방식
            
            thread = threading.Thread(
                target=module_instance.run,
                args=(EVENT_BUS_URL, module_poll_interval, use_push),
                daemon=True,
                name=f"Module-{module_class.name}"
            )
            thread.start()
            module_threads.append(thread)
            print(f"  ✅ {module_class.name} 시작됨")
        except Exception as e:
            print(f"  ⚠️  {module_class.name} 시작 실패: {e}")
    
    # 모듈들이 모두 등록될 때까지 대기 (푸시 방식 모듈만)
    print("\n⏳ 모듈 등록 완료 대기 중...")
    import requests
    max_wait = 30  # 최대 30초 대기
    wait_count = 0
    
    # 푸시 방식을 사용하는 모듈 목록 (모든 모듈)
    push_modules = {m.__module__.split('.')[-1] + "." + m.__name__ for m in module_classes}
    while wait_count < max_wait:
        try:
            response = requests.get(f"{EVENT_BUS_URL}/modules", timeout=2)
            if response.status_code == 200:
                registered_modules = response.json()
                registered_module_ids = {m.get("module_id") for m in registered_modules}
                
                # 푸시 방식 모듈들이 모두 등록되었는지 확인
                missing_modules = push_modules - registered_module_ids
                if not missing_modules:
                    print(f"✅ 모든 모듈 등록 완료 ({len(registered_modules)}개)")
                    break
                elif wait_count % 5 == 0:  # 5초마다 진행 상황 출력
                    print(f"  ⏳ [main] 대기 중... (누락: {', '.join(missing_modules)})")
        except Exception as e:
            if wait_count % 5 == 0:
                print(f"  ⏳ [main] 모듈 목록 조회 중... ({e})")
        
        wait_count += 1
        time.sleep(1)
    
    if wait_count >= max_wait:
        # 최종 상태 확인
        try:
            response = requests.get(f"{EVENT_BUS_URL}/modules", timeout=2)
            if response.status_code == 200:
                registered_modules = response.json()
                registered_module_ids = {m.get("module_id") for m in registered_modules}
                missing_modules = push_modules - registered_module_ids
                if missing_modules:
                    print(f"⚠️  다음 모듈이 아직 등록되지 않았습니다: {', '.join(missing_modules)}")
                    print(f"   등록된 모듈: {', '.join(registered_module_ids)}")
                else:
                    print(f"✅ 모든 모듈 등록 완료 ({len(registered_modules)}개)")
        except:
            print("⚠️  모듈 등록 상태를 확인할 수 없습니다. 계속 진행합니다...")
    
    # 서비스는 별도 프로세스로 실행됨
    # 직접 실행 모드에서는 별도 프로세스로 실행
    print(f"\n📋 서비스 로드 중...")
    services = service_manager.load_all()
    print(f"발견된 서비스: {len(services)}개")
    for service_id, service_def in services.items():
        pipeline_count = len(service_def.pipelines)
        print(f"  - {service_def.metadata.name} ({service_id}) - 파이프라인 {pipeline_count}개")
        for pipeline_def in service_def.pipelines:
            trigger_event = pipeline_def.trigger.event if pipeline_def.trigger else "N/A"
            print(f"    └─ {pipeline_def.name} (트리거: {trigger_event})")
    
    # 선택된 서비스만 실행 (SELECTED_PIPELINE 또는 SELECTED_SERVICE 환경 변수 확인)
    selected_service = os.getenv("SELECTED_SERVICE", os.getenv("SELECTED_PIPELINE", ""))
    print(f"  ✅ 선택된 서비스: {selected_service}")
    if selected_service:
        # 특정 서비스만 실행
        matched_service_id = None
        
        # 1. 서비스 ID로 직접 매칭
        if selected_service in services:
            matched_service_id = selected_service
        else:
            # 2. 폴더명으로 매칭 시도
            for s_id in services.keys():
                service_def = services[s_id]
                id_parts = s_id.split(".")
                if len(id_parts) > 0 and id_parts[-1] == selected_service:
                    matched_service_id = s_id
                    break
                if service_def.pipeline_dir:
                    service_folder = os.path.basename(str(service_def.pipeline_dir))
                    if service_folder == selected_service:
                        matched_service_id = s_id
                        break
        
        if matched_service_id:
            service_ids_to_run = [matched_service_id]
        else:
            print(f"❌ 서비스를 찾을 수 없습니다: {selected_service}")
            print(f"   사용 가능한 서비스: {', '.join(services.keys())}")
            sys.exit(1)
    else:
        # 모든 서비스 실행
        service_ids_to_run = list(services.keys())
    
    # 각 서비스를 별도 프로세스로 실행
    print(f"\n🚀 서비스 시작 중...")
    print(f"  ✅ 서비스 목록: {service_ids_to_run}")
    service_threads = []
    
    for service_id in service_ids_to_run:
        def run_service(s_id):
            """서비스를 별도 프로세스로 실행"""
            import subprocess
            try:
                print(f"  ✅ 서비스 실행: {s_id}")
                # 별도 프로세스로 실행 (non-blocking)
                process = subprocess.Popen(
                    [sys.executable, str(ENGINE_ROOT / "service_runner.py"), s_id],
                    cwd=str(ENGINE_ROOT),  # SagoHub/runner
                    env=dict(os.environ, **{
                        'PIPELINES_DIR': str(SERVICES_DIR),  # 하위 호환성
                        'SERVICES_DIR': str(SERVICES_DIR),
                        'EVENT_BUS_URL': EVENT_BUS_URL,
                    })
                )
                # 프로세스가 종료될 때까지 대기
                process.wait()
            except Exception as e:
                print(f"  ❌ 서비스 실행 실패 ({s_id}): {e}")

        thread = threading.Thread(
            target=run_service,
            args=(service_id,),
            daemon=True,
            name=f"Service-{service_id}"
        )
        thread.start()
        service_threads.append(thread)
        print(f"  ✅ {service_id} 시작됨")
    
    print(f"\n모듈 실행 중: {len(module_threads)}개")
    print(f"서비스 실행 중: {len(service_threads)}개")
    print(f"SagoHub: {EVENT_BUS_URL}")
    print("시스템이 실행 중입니다. Ctrl+C로 종료")
    print("=" * 60)
    
    try:
        # 메인 스레드는 모듈 및 서비스 스레드들이 실행되는 동안 대기
        while True:
            # 모든 모듈 스레드가 살아있는지 확인
            alive_module_threads = [t for t in module_threads if t.is_alive()]
            alive_service_threads = [t for t in service_threads if t.is_alive()]
            
            if len(alive_module_threads) == 0 and len(alive_service_threads) == 0:
                print("⚠️  모든 스레드가 종료되었습니다.")
                break
            time.sleep(5)
    except KeyboardInterrupt:
        print("\n시스템 종료 중...")
        print("모듈 및 서비스 종료 중...")


def _service_def_to_service_info(service_def):
    """스키마 ServiceDef(dataclass) → SagoHub ServiceInfo(Pydantic) 변환"""
    meta = service_def.metadata
    #ui_server는 없을 수도 있습니다.
    if meta.ui_server:
        ui_server = UIServerConfig(
            host=meta.ui_server.host,
            port=meta.ui_server.port,
            external_port=meta.ui_server.external_port,
            event_bus_url=meta.ui_server.event_bus_url,
        )
    else:
        ui_server = None
    eb_metadata = EBServiceMetadata(
        id=meta.id,
        version=meta.version,
        name=meta.name,
        description=getattr(meta, "description", "") or "",
        author=getattr(meta, "author", "") or "",
        icon=getattr(meta, "icon"),
        category=getattr(meta, "category", "productivity") or "productivity",
        ui_server=ui_server,
    )
    pipelines_out = []
    for pl in service_def.pipelines:
        trigger = pl.trigger
        if trigger:
            agg = trigger.aggregation
            eb_agg = None
            if agg:
                try:
                    strategy = ConflictResolutionStrategy(agg.strategy) if agg.strategy else ConflictResolutionStrategy.INDEPENDENT
                except (ValueError, TypeError):
                    strategy = ConflictResolutionStrategy.INDEPENDENT
                eb_agg = EBAggregationInfo(strategy=strategy, target=agg.target, options=agg.options or None)
            eb_trigger = EBPipelineTrigger(
                event=trigger.event or "",
                filter=getattr(trigger, "filter", None),
                debounce=getattr(trigger, "debounce", 0) or 0,
                aggregation=eb_agg,
            )
        else:
            eb_trigger = EBPipelineTrigger(event="", filter=None, debounce=0, aggregation=None)
        broadcast_out = [
            EBModuleCallInfo(module=bc.module, id=bc.id, args=bc.args or {})
            for bc in (pl.broadcast or [])
        ]
        pipelines_out.append(
            EBPipelineInfo(
                id=pl.id or pl.name or "",
                name=pl.name,
                trigger=eb_trigger,
                broadcast=broadcast_out,
            )
        )
    interfaces_out = []
    for iface in service_def.interfaces or []:
        d = getattr(iface, "events", None) or {}
        ev = []
        for v in d.values():
            if isinstance(v, list):
                ev.extend(v)
            elif isinstance(v, str):
                ev.append(v)
        interfaces_out.append(
            EBInterfaceInfo(
                type=iface.type or "react-ui",
                id=iface.id or "",
                label=getattr(iface, "label", "") or "",
                description=getattr(iface, "description", "") or "",
                binding=getattr(iface, "binding"),
                props=getattr(iface, "props", {}) or {},
                events=ev,
            )
        )
    config_dict = getattr(service_def.config, "values", None) or {}
    return ServiceInfo(
        metadata=eb_metadata,
        pipelines=pipelines_out,
        config=config_dict,
        interfaces=interfaces_out,
        active=True,
    )


def _register_service(http_client: EventBusHTTPClient, service_manager: ServiceManager, service_id: str):
    """
    서비스를 SagoHub 서버에 등록
    
    서비스와 파이프라인의 관계:
    - 서비스(Service): 하나의 service.yaml 파일로 정의됨 (PipelineDefinition)
    - 파이프라인(Pipeline): 서비스 내부에 여러 개의 파이프라인이 있을 수 있음 (PipelineDef 리스트)
      - 각 파이프라인은 특정 이벤트를 트리거로 받아서 모듈들을 브로드캐스트함
      - 구조: Trigger -> Broadcast(Modules) -> Aggregation(충돌 해결)
        * Trigger: 파이프라인을 시작하는 이벤트
        * Broadcast: 트리거 이벤트를 여러 모듈에게 동시에 전달 (병렬 처리)
        * Aggregation: 여러 모듈이 각각 응답 이벤트를 발행할 때, 그 이벤트들 간의 충돌을 해결하는 전략
          - INDEPENDENT: 각 모듈이 독립적으로 처리하므로 모든 응답을 그대로 사용
          - PRIORITY: 우선순위가 높은 모듈의 응답만 사용
          - LATEST: 가장 최근에 도착한 응답만 사용
          - MERGE: 모든 응답을 합침
    
    등록 시:
    - 서비스 레벨로 등록 (service_id 사용)
    - 서비스 내부의 모든 파이프라인의 정보를 집계하여 등록
    """
    if service_id not in service_manager.services:
        return

    service_def = service_manager.services[service_id]
    
    print(f"\n🔧 서비스 등록 중 ({service_def.metadata.name})...")
    print(f"   서비스 ID: {service_id}")
    print(f"   파이프라인 수: {len(service_def.pipelines)}개")
    
    # 서비스 UI URL 구성 (UIServerConfig: port, external_port만 있음, host는 localhost)
    ui_url = service_def.metadata.domain or None
    if not ui_url and service_def.metadata.ui_server:
        ui_server_config = service_def.metadata.ui_server
        print(f"    UI 서버 설정: {ui_server_config}")
        port = service_def.metadata.ui_server.external_port or service_def.metadata.ui_server.port
        
        host = service_def.metadata.ui_server.host or "localhost"
        if port:
            ui_url = f"http://{host}:{port}"
    
    # 서비스의 모든 파이프라인에서 정보 수집
    all_broadcast = []
    all_broadcast_targets = []
    all_steps = []  # 하위 호환성
    trigger_events = []
    # 첫 번째 파이프라인의 aggregation을 서비스 레벨 aggregation으로 사용 (하위 호환성)
    service_aggregation = None
    
    for pipeline_def in service_def.pipelines:
        # 트리거 이벤트 수집
        if pipeline_def.trigger and pipeline_def.trigger.event:
            trigger_events.append(pipeline_def.trigger.event)
            # 첫 번째 파이프라인의 aggregation을 서비스 레벨 aggregation으로 사용
            if service_aggregation is None and pipeline_def.trigger.aggregation:
                service_aggregation = pipeline_def.trigger.aggregation
        
        # 브로드캐스트 모듈 목록 수집 (새 스키마)
        if pipeline_def.broadcast:
            for bc_call in pipeline_def.broadcast:
                # 모듈 이름 매핑 (YAML의 모듈 이름 -> 실제 모듈 ID)
                # module_id_map = {
                #     "ai.llm.draft_email": "M_LLM_Drafter",
                #     "nudge.create_draft": "M_Nudge_UI",
                #     "mail.send": "M_Mailer",
                #     "monitor.log_change": "M_Monitor_Log",
                #     "monitor.console_output": "M_Monitor_Console",
                #     "file_watcher": "M_FileWatcher",
                #     "fs.read": None,  # 가상 모듈, 스킵
                # }
                # mapped_id = module_id_map.get(bc_call.module)
                # if mapped_id is None:
                #     continue  # 가상 모듈 스킵
                
                # if mapped_id not in all_broadcast_targets:
                
                #YAML의 모듈 이름을 그대로 사용
                all_broadcast_targets.append(bc_call.module)
                
                # ModuleCallInfo 형식으로 변환
                all_broadcast.append({
                    "module": bc_call.module,
                    "id": bc_call.id,
                    "priority": bc_call.priority,
                    "condition": bc_call.condition,
                    "args": bc_call.args,
                })
        
        # 하위 호환성: steps에서 모듈 정보 추출 (구 스키마)
        # (현재는 새 스키마만 사용하므로 주석 처리)
    
    # 서비스 정보 구성
    if not all_broadcast_targets and not all_steps:
        print(f"  ⚠️  서비스 스킵됨 (유효한 모듈이 없음)")
        return
   
    service_info = _service_def_to_service_info(service_def)
    
    try:
        service_info_dict = service_info.model_dump()
        http_client.register_service(service_info_dict)
        print(f"  ✅ 서비스 등록 완료: {service_def.metadata.name} ({service_id})")
        print(f"     트리거 이벤트: {', '.join(trigger_events) if trigger_events else 'N/A'}")
        print(f"     브로드캐스트 대상 모듈: {', '.join(all_broadcast_targets)}")
        if ui_url:
            print(f"     UI 접속: {ui_url}")
    except Exception as e:
        print(f"  ⚠️  서비스 등록 실패: {e}")
        # 이미 등록된 경우 업데이트 시도
        
        if "already exists" in str(e):
            try:
                http_client.update_service(service_id, service_info_dict)
                print(f"  🔄 서비스 업데이트됨: {service_def.metadata.name} ({service_id})")
            except Exception as e2:
                print(f"  ⚠️  서비스 등록/업데이트 실패: {e2}")
        else:
            # 오류 메시지에 상세 정보 포함
            error_msg = str(e)
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                try:
                    import json
                    error_detail = json.loads(e.response.text)
                    error_msg = error_detail.get('detail', error_msg)
                except:
                    pass
            print(f"  ⚠️  서비스 등록 실패: {error_msg}")


def main():
    """메인 진입점"""
    if USE_DOCKER:
        run_docker()
    else:
        run_direct()


if __name__ == "__main__":
    main()
