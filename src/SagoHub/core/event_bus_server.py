"""
SagoHub HTTP 서버: FastAPI 기반 REST API
"""
import asyncio
import json
import os
import threading
import time
import uuid
import requests
import traceback
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from enum import Enum
import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from uvicorn.config import LOGGING_CONFIG

import subprocess
import signal

from .event import Event, EventBus
from .orchestrator import Orchestrator
from .service import Service, Pipeline
from ..service.schema import UIServerConfig, ServiceDef
from ..service.loader import ServiceLoader


# 순환 참조 방지를 위한 타입 체크
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    pass


# Pydantic 모델
class EventRequest(BaseModel):
    """이벤트 발행 요청"""
    event_id: Optional[str] = None
    type: str
    payload: Dict[str, Any]
    timestamp: Optional[str] = None
    source_module: str = ""
    metadata: Dict[str, Any] = {}
    service_id: Optional[str] = None  # metadata.service_id로 병합 (응답·로그에 service_id 포함)
    # SSE: 이 목록에 등록된 client_id 연결에만 전달(파이프라인 응답 유출 방지). 비우면 브로드캐스트 전용 큐만 수신.
    sse_client_ids: Optional[List[str]] = None


class ModuleInfo(BaseModel):
    """모듈 정보"""
    module_id: str
    name: str
    description: Optional[str] = None
    version: Optional[str] = None
    endpoint: Optional[str] = None  # 모듈의 HTTP 엔드포인트 (필수 - 푸시 방식)
    capabilities: List[str] = []  # 처리 가능한 이벤트 타입 목록
    config: Dict[str, Any] = {}
    last_heartbeat: Optional[str] = None  # 마지막 하트비트 시간
    health_status: str = "unknown"  # "healthy", "unhealthy", "unknown"
    failure_count: int = 0  # 연속 실패 횟수



class ConflictResolutionStrategy(str, Enum):
    """충돌 해결 전략"""
    INDEPENDENT = "INDEPENDENT"  # 독립: 각 모듈이 서로 다른 영역 처리
    PRIORITY = "PRIORITY"  # 우선순위: 높은 우선순위 모듈 우선
    LATEST = "LATEST"  # 최신: 가장 최근에 도착한 이벤트 우선
    MERGE = "MERGE"  # 합병: 모든 결과를 합침


class ModuleCallInfo(BaseModel):
    """브로드캐스트 모듈 호출 정보"""
    module: str  # 모듈 식별자
    id: Optional[str] = None  # 실행 ID
    args: Dict[str, Any] = {}  # 모듈 인자 매핑

class AggregationInfo(BaseModel):
    """집계 정보"""
    strategy: ConflictResolutionStrategy = ConflictResolutionStrategy.INDEPENDENT
    target: Optional[str] = None  # null, "event_bus", 또는 module_id
    options: Optional[Dict[str, Any]] = None  # 전략별 옵션

class PipelineTrigger(BaseModel):
    """파이프라인 트리거 정보"""
    event: str  # 트리거 이벤트 타입
    filter: Optional[str] = None  # 조건식 또는 파일 패턴
    debounce: int = 0  # 밀리초
    aggregation: Optional[AggregationInfo] = None  # 충돌 해결 설정

class PipelineInfo(BaseModel):
    """파이프라인 정보"""
    id: str
    name: str
    trigger: PipelineTrigger  # 트리거 이벤트 타입
    broadcast: List[ModuleCallInfo] = []  # 브로드캐스트 모듈 목록

class InterfaceInfo(BaseModel):
    """인터페이스 정보"""
    type: str
    id: str
    label: str
    description: Optional[str] = None
    binding: Optional[str] = None
    props: Dict[str, Any] = {}
    events: List[str] = []

class ServiceMetadata(BaseModel):
    """서비스 메타데이터"""
    id: str
    version: str
    name: str
    description: Optional[str] = None
    author: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None
    ui_server: Optional[UIServerConfig] = None

class ServiceInfo(BaseModel):
    """서비스 정보 (브로드캐스트 기반 v2.0)"""
    metadata: ServiceMetadata
    pipelines: List[PipelineInfo] = []  # 파이프라인 목록
    config: Dict[str, Any] = {}
    interfaces: List[InterfaceInfo] = []  # UI 인터페이스 정의
    active: bool = True


def _service_def_to_service_info(service_def: ServiceDef) -> ServiceInfo:
    """ServiceDef(dataclass) → ServiceInfo(Pydantic) 변환 (로드 API용)."""
    meta = service_def.metadata
    ui_server = None
    if meta.ui_server:
        ui_server = UIServerConfig(
            host=meta.ui_server.host,
            port=meta.ui_server.port,
            external_port=meta.ui_server.external_port,
            event_bus_url=meta.ui_server.event_bus_url,
        )
    eb_metadata = ServiceMetadata(
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
                eb_agg = AggregationInfo(strategy=strategy, target=agg.target, options=agg.options or None)
            eb_trigger = PipelineTrigger(
                event=trigger.event or "",
                filter=getattr(trigger, "filter", None),
                debounce=getattr(trigger, "debounce", 0) or 0,
                aggregation=eb_agg,
            )
        else:
            eb_trigger = PipelineTrigger(event="", filter=None, debounce=0, aggregation=None)
        broadcast_out = [
            ModuleCallInfo(module=bc.module, id=bc.id, args=bc.args or {})
            for bc in (pl.broadcast or [])
        ]
        pipelines_out.append(
            PipelineInfo(
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
        for v in d.values() if isinstance(d, dict) else []:
            if isinstance(v, list):
                ev.extend(v)
            elif isinstance(v, str):
                ev.append(v)
        interfaces_out.append(
            InterfaceInfo(
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


class EventBusServer:
    """SagoHub HTTP 서버"""
    
    def __init__(self, orchestrator: Optional[Orchestrator] = None, host: str = "0.0.0.0", port: int = 8000):
        self.app = FastAPI(title="SagoHub", version="1.0.0")
        self.orchestrator = orchestrator or Orchestrator()
        self.event_bus = self.orchestrator.event_bus
        self.host = host
        self.port = port
        
        # 모듈 레지스트리 (module_id -> ModuleInfo)
        self.modules: Dict[str, ModuleInfo] = {}
        
        # 파이프라인 레지스트리 (pipeline_id -> PipelineInfo)
        self.pipelines: Dict[str, PipelineInfo] = {}
        
        # 서비스 레지스트리 (service_id -> ServiceInfo)
        self.services: Dict[str, Dict[str, Any]] = {}  # service_id -> {name, ui_url, pipelines: []}
        
        # 모듈 구독 정보 (event_type -> [module_id])
        self.module_subscriptions: Dict[str, List[str]] = {}
        
        # 파이프라인 집계기 (pipeline_id -> EventAggregator)
        from .event_aggregator import EventAggregator, ConflictResolutionStrategy
        self.aggregators: Dict[str, EventAggregator] = {}
        
        # 헬스체크 스레드
        self._health_check_thread: Optional[threading.Thread] = None
        self._health_check_interval = int(os.getenv("HEALTH_CHECK_INTERVAL", "60"))  # 1분
        self._health_check_failure_threshold = 3  # 3회 실패 시 비활성화
        # 모듈로 이벤트 전송 시 타임아웃 (LLM 등 응답 지연 모듈 대비, 초 단위). 기본 5분.
        self._module_event_timeout = int(os.getenv("MODULE_EVENT_TIMEOUT", "300"))
        # SSE: 브로드캐스트(레거시·관리자) — 모든 비타깃 이벤트 + 타깃 이벤트도 수신
        self._sse_broadcast_queues: List[asyncio.Queue] = []
        # SSE: client_id -> 해당 사용자 전용 연결(타깃 이벤트 + 브로드캐스트는 안 받음 — targeted_only 모드)
        self._sse_by_client_id: Dict[str, List[asyncio.Queue]] = {}
        
        # 프로젝트 경로 (로드/시작/종료 API용)
        self._project_root = Path(__file__).resolve().parent.parent.parent.parent
        self._services_dir = Path(os.getenv("SERVICES_DIR", os.getenv("PIPELINES_DIR", str(self._project_root / "services"))))
        self._runner_root = self._project_root / "src" / "SagoHub" / "runner"
        # 서비스/모듈 프로세스 PID (시작 시 저장, 종료 시 사용)
        self._service_pids: Dict[str, int] = {}
        self._module_pids: Dict[str, int] = {}
        
        # CORS 설정
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
        self._setup_routes()
        self._setup_web_ui()
        self._start_health_check()

    def _emit_sse(self, ev_dict: Dict[str, Any]) -> None:
        """SSE 분배: metadata.sse_client_ids 가 있으면 해당 client + 브로드캐스트 큐만, 없으면 브로드캐스트만."""

        def _push(q: asyncio.Queue) -> None:
            try:
                q.put_nowait(ev_dict)
            except asyncio.QueueFull:
                pass

        meta = ev_dict.get("metadata") or {}
        if not isinstance(meta, dict):
            meta = {}
        ids = meta.get("sse_client_ids")
        has_target = isinstance(ids, list) and len(ids) > 0

        seen: Set[int] = set()

        def _push_unique(q: asyncio.Queue) -> None:
            i = id(q)
            if i in seen:
                return
            seen.add(i)
            _push(q)

        if has_target:
            for cid in ids:
                if not isinstance(cid, str):
                    continue
                for q in list(self._sse_by_client_id.get(cid, [])):
                    _push_unique(q)
            for q in list(self._sse_broadcast_queues):
                _push_unique(q)
        else:
            for q in list(self._sse_broadcast_queues):
                _push_unique(q)
    
    def _collect_broadcast_targets(self, event_type: str) -> List[str]:
        """등록된 서비스 파이프라인 중 트리거 이벤트가 event_type과 일치하는 broadcast 모듈 ID 목록(순서 유지·중복 제거)."""
        seen: Set[str] = set()
        out: List[str] = []
        for _sid, service_info in self.services.items():
            for pipeline in service_info.get("pipelines", []) or []:
                trig = pipeline.get("trigger") or {}
                if not isinstance(trig, dict):
                    continue
                if trig.get("event") != event_type:
                    continue
                for module_call in pipeline.get("broadcast") or []:
                    if not isinstance(module_call, dict):
                        continue
                    mid = module_call.get("module")
                    if mid and mid not in seen:
                        seen.add(mid)
                        out.append(str(mid))
        return out
    
    def _setup_routes(self):
        """라우트 설정"""
        
        @self.app.post("/publish", response_model=Dict[str, Any])
        async def publish_event(event_req: EventRequest):
            print(f"[EventBusServer] PUBLISH EVENT: {event_req}")
            """이벤트 발행"""
            try:
                req_d = (
                    event_req.model_dump(exclude_none=False)
                    if hasattr(event_req, "model_dump")
                    else event_req.dict()
                )
                sse_ids = req_d.pop("sse_client_ids", None)
                svc_id = req_d.pop("service_id", None)
                ed = {
                    "type": req_d["type"],
                    "payload": req_d.get("payload") or {},
                    "timestamp": req_d.get("timestamp"),
                    "source_module": req_d.get("source_module") or "",
                    "event_id": req_d.get("event_id"),
                    "metadata": dict(req_d.get("metadata") or {}),
                }
                if svc_id is not None and str(svc_id).strip() != "":
                    ed["metadata"]["service_id"] = str(svc_id).strip()
                if sse_ids and isinstance(sse_ids, list) and len(sse_ids) > 0:
                    ed["metadata"]["sse_client_ids"] = [str(x) for x in sse_ids if x]
                event = Event.from_dict(ed)
                # 브로드캐스트 대상 모듈 목록(등록된 서비스 파이프라인 기준) — 이벤트 로그·UI 표시용
                event.metadata = {
                    **dict(event.metadata),
                    "target_modules": self._collect_broadcast_targets(event.type),
                }
                # 모든 발행 이벤트를 event_log에 기록 (UI/모듈 발행 모두 /api/events/recent에서 노출)
                self.event_bus.event_log.append(event)
                # SSE: 타깃/브로드캐스트 분배
                self._emit_sse(event.to_dict())

                # # 모듈로 이벤트 푸시 (비동기)
                # await self._push_event_to_modules(event)
                
                # SagoHub에도 발행 (기존 파이프라인과의 호환성)
                # loop = asyncio.get_event_loop()
                # new_events = await loop.run_in_executor(None, self.event_bus.publish, event)

                #services에서 파이프라인 처리
                try:
                    for service_id, service_info in self.services.items():
                        for pipeline in service_info.get('pipelines', []):
                            if pipeline.get('trigger', {}).get('event') == event.type:
                                for module_call in pipeline.get('broadcast', []):
                                    module_info = self.modules.get(module_call.get('module'))
                                    if not module_info or not module_info.endpoint:
                                        continue
                                    result = await self._push_event_to_module(module_info, event)
                                    if result is None:
                                        # _push_event_to_module: HTTP 200이 아니면 None 반환
                                        print(
                                            f"MODULE CALL FAILED (non-200 or no JSON): "
                                            f"{module_call.get('module')} endpoint={module_info.endpoint}\n\n"
                                        )
                                        continue
                                    if result.get('status') == 'success':
                                        #모듈 호출 성공
                                        print(f"MODULE CALL SUCCESS: {module_call.get('module')} \n\n")
                                    else:
                                        print(f"RESULT ERROR: {result.get('message')} \n\n")
                                
                except Exception as e:
                    print(f"ERROR: {e}")
                    print(f"ERROR TRACEBACK: {traceback.format_exc()}")
                    return {
                        "status": "error",
                        "message": str(e)
                    }
                return {
                    "status": "success",
                    "event_id": event.event_id,
                }
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.get("/modules", response_model=List[Dict[str, Any]])
        async def list_modules():
            """모듈 목록 조회"""
            return [module.dict() for module in self.modules.values()]
        
        @self.app.post("/modules", response_model=Dict[str, Any])
        async def register_module(module_info: ModuleInfo):
            print(f"[EventBusServer] /modules REGISTER MODULE: {module_info} \n\n")
            """모듈 등록"""
            # endpoint가 없으면 폴링 방식으로 간주 (하위 호환성)
            # FileWatcher 같은 특수 모듈은 endpoint 없이 등록 가능
            
            # 기존 모듈이면 업데이트, 아니면 신규 등록
            is_update = module_info.module_id in self.modules
            module_info.last_heartbeat = datetime.now().isoformat()
            module_info.health_status = "healthy"
            module_info.failure_count = 0
            
            self.modules[module_info.module_id] = module_info
            
            # 모듈이 처리 가능한 이벤트 타입에 구독 등록 (endpoint가 있는 경우만)
            # endpoint가 없으면 폴링 방식이므로 구독 목록에 추가하지 않음
            if module_info.endpoint:
                for event_type in module_info.capabilities:
                    if event_type not in self.module_subscriptions:
                        self.module_subscriptions[event_type] = []
                    if module_info.module_id not in self.module_subscriptions[event_type]:
                        self.module_subscriptions[event_type].append(module_info.module_id)
            
            action = "updated" if is_update else "registered"
            return {
                "status": "success", 
                "action": action,
                "module": module_info.dict()
            }
        
        @self.app.get("/modules/{module_id}", response_model=Dict[str, Any])
        async def get_module(module_id: str):
            """모듈 정보 조회"""
            if module_id not in self.modules:
                raise HTTPException(status_code=404, detail=f"Module {module_id} not found")
            return self.modules[module_id].dict()
        
        @self.app.put("/modules/{module_id}", response_model=Dict[str, Any])
        async def update_module(module_id: str, module_info: ModuleInfo):
            """모듈 정보 수정"""
            if module_id not in self.modules:
                print(f"  ✅ 모듈 레지스트리에 없음: {module_id} \n\n")
                raise HTTPException(status_code=404, detail=f"Module {module_id} not found")
            
            # module_id는 URL에서 가져오므로 body의 module_id와 일치해야 함
            if module_info.module_id != module_id:
                print(f"  ✅ 모듈 ID 불일치: {module_info.module_id} != {module_id} \n\n")
                raise HTTPException(status_code=400, detail="Module ID mismatch")

            self.modules[module_id] = module_info
            return {"status": "success", "module": module_info.dict()}
        
        @self.app.delete("/modules/{module_id}")
        async def delete_module(module_id: str):
            """모듈 삭제"""
            if module_id not in self.modules:
                raise HTTPException(status_code=404, detail=f"Module {module_id} not found")
            
            # 해당 모듈을 사용하는 파이프라인이 있는지 확인
            for pipeline_id, pipeline_info in self.pipelines.items():
                for step in pipeline_info.steps:
                    if step.module_id == module_id:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Module {module_id} is used by pipeline {pipeline_id}"
                        )
            
            del self.modules[module_id]
            return {"status": "success"}
        
        @self.app.get("/services", response_model=List[Dict[str, Any]])
        async def list_services():
            """서비스 목록 조회"""
            print(f"  ✅ 서비스 목록 조회: {self.services.keys()}")
            print(f"  ✅ 서비스 목록: {self.services}")
            return [service for service in self.services.values()]
        
        @self.app.post("/services", response_model=Dict[str, Any])
        async def register_service(service: ServiceInfo):
            """서비스 등록 (브로드캐스트 기반). 이미 있으면 업데이트 후 성공 반환."""
            is_update = service.metadata.id in self.services
            
            if not is_update:
                # 신규 등록 시에만 모듈 존재 여부 검사
                targets_to_check = []
                for pipeline in service.pipelines:
                    for module_call in pipeline.broadcast:
                        if module_call.module not in targets_to_check:
                            targets_to_check.append(module_call.module)
                missing_modules = [m for m in targets_to_check if m not in self.modules]
                if missing_modules:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Modules not registered: {', '.join(missing_modules)}. Available modules: {', '.join(self.modules.keys())}"
                    )
            
            # 서비스 정보 저장
            self.services[service.metadata.id] = service.dict()
            
            # 트리거마다 집계(aggregation) 설정이 있으면 집계기 생성
            for pipeline in service.pipelines:
                if pipeline.trigger.aggregation:
                    from .event_aggregator import EventAggregator, ConflictResolutionStrategy
                    strategy = ConflictResolutionStrategy(pipeline.trigger.aggregation.strategy)
                    aggregator = EventAggregator(
                        strategy=strategy,
                        options=pipeline.trigger.aggregation.options or {}
                    )
                    self.aggregators[pipeline.id] = aggregator
            for pipeline in service.pipelines:
                for module_call in pipeline.broadcast:
                    self.event_bus.subscribe(pipeline.trigger.event, module_call.module)
            for pipeline in service.pipelines:
                for module_call in pipeline.broadcast:
                    if module_call.module not in self.module_subscriptions:
                        self.module_subscriptions[module_call.module] = []
                    if module_call.module not in self.module_subscriptions[module_call.module]:
                        self.module_subscriptions[module_call.module].append(module_call.module)
            
            action = "updated" if is_update else "registered"
            return {"status": "success", "action": action, "service": service.dict()}
        
        @self.app.get("/services/{service_id}", response_model=Dict[str, Any])
        async def get_service(service_id: str):
            """서비스 정보 조회"""
            if service_id not in self.services:
                raise HTTPException(status_code=404, detail=f"Service {service_id} not found")
            return self.services[service_id]
        
        @self.app.put("/services/{service_id}", response_model=Dict[str, Any])
        async def update_service(service_id: str, service: ServiceInfo):
            """서비스 정보 수정"""
            if service_id not in self.services:
                raise HTTPException(status_code=404, detail=f"Service {service_id} not found")
            
            if service.metadata.id != service_id:
                raise HTTPException(status_code=400, detail="Service ID mismatch")
            
            self.services[service_id] = service.dict()
            #register_service 와 동일한 로직    
            await self.register_service(service)
            return {"status": "success", "service": service.model_dump()}
        
        @self.app.delete("/services/{service_id}")
        async def delete_service(service_id: str):
            """서비스 삭제"""
            if service_id not in self.services:
                raise HTTPException(status_code=404, detail=f"Service {service_id} not found")
            
            del self.services[service_id]
            return {"status": "success"}
        
        # ---------- 로드/시작/종료 API (대시보드 제어용) ----------
        @self.app.get("/api/available/services", response_model=List[Dict[str, Any]])
        async def get_available_services():
            """디스크에서 사용 가능한 서비스 목록 (로드 여부 포함)."""
            loader = ServiceLoader(self._services_dir)
            all_defs = loader.load_all_services()
            result = []
            for sid, sdef in all_defs.items():
                result.append({
                    "id": sid,
                    "name": sdef.metadata.name,
                    "description": getattr(sdef.metadata, "description", "") or "",
                    "loaded": sid in self.services,
                    "running": sid in self._service_pids,
                })
            return result
        
        @self.app.get("/api/available/modules", response_model=List[Dict[str, Any]])
        async def get_available_modules():
            """프로젝트에서 사용 가능한 모듈 목록 (등록/실행 여부 포함)."""
            from .module_loader import get_module_map
            module_map = get_module_map(self._project_root)
            result = []
            for runner_key, cls in module_map.items():
                module_id = f"{cls.__module__.split('.')[-1]}.{cls.__name__}"
                registered = any(
                    mid == module_id or mid.endswith(runner_key) or mid.split(".")[-1] == cls.__name__
                    for mid in self.modules
                )
                result.append({
                    "id": runner_key,
                    "module_id": module_id,
                    "name": getattr(cls, "name", cls.__name__),
                    "loaded": registered,
                    "running": runner_key in self._module_pids,
                })
            return result
        
        @self.app.post("/api/load", response_model=Dict[str, Any])
        async def load_all():
            """모든 서비스 정의를 디스크에서 읽어 이벤트 버스에 등록."""
            loader = ServiceLoader(self._services_dir)
            all_defs = loader.load_all_services()
            registered = 0
            errors = []
            for sid, sdef in all_defs.items():
                try:
                    service_info = _service_def_to_service_info(sdef)
                    await register_service(service_info)
                    registered += 1
                except HTTPException as e:
                    errors.append(f"{sid}: {e.detail}")
                except Exception as e:
                    errors.append(f"{sid}: {e}")
            return {
                "status": "success",
                "registered": registered,
                "total": len(all_defs),
                "errors": errors[:20],
            }
        
        @self.app.post("/api/services/{service_id}/start", response_model=Dict[str, Any])
        async def start_service(service_id: str):
            """서비스 프로세스 시작 (service_runner.py)."""
            loader = ServiceLoader(self._services_dir)
            all_defs = loader.load_all_services()
            if service_id not in all_defs:
                raise HTTPException(status_code=404, detail=f"Service {service_id} not found")
            if service_id in self._service_pids:
                return {"status": "success", "message": "already_running", "pid": self._service_pids[service_id]}
            env = dict(os.environ)
            env.setdefault("SERVICES_DIR", str(self._services_dir))
            env.setdefault("PIPELINES_DIR", str(self._services_dir))
            env.setdefault("EVENT_BUS_URL", f"http://localhost:{self.port}")
            try:
                proc = subprocess.Popen(
                    [sys.executable, str(self._runner_root / "service_runner.py"), service_id],
                    cwd=str(self._runner_root),
                    env=env,
                )
                self._service_pids[service_id] = proc.pid
                return {"status": "success", "pid": proc.pid}
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.post("/api/services/{service_id}/stop", response_model=Dict[str, Any])
        async def stop_service(service_id: str):
            """서비스 프로세스 종료."""
            pid = self._service_pids.get(service_id)
            if not pid:
                return {"status": "success", "message": "not_running"}
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
            finally:
                self._service_pids.pop(service_id, None)
            return {"status": "success", "pid": pid}
        
        @self.app.post("/api/modules/{module_key}/start", response_model=Dict[str, Any])
        async def start_module(module_key: str):
            """모듈 프로세스 시작 (module_runner.py). module_key 예: sago_writer.SagoWriterModule"""
            from .module_loader import get_module_map
            module_map = get_module_map(self._project_root)
            if module_key not in module_map:
                raise HTTPException(status_code=404, detail=f"Module {module_key} not found")
            if module_key in self._module_pids:
                return {"status": "success", "message": "already_running", "pid": self._module_pids[module_key]}
            env = dict(os.environ)
            env.setdefault("EVENT_BUS_URL", f"http://localhost:{self.port}")
            try:
                proc = subprocess.Popen(
                    [sys.executable, str(self._runner_root / "module_runner.py"), module_key],
                    cwd=str(self._runner_root),
                    env=env,
                )
                self._module_pids[module_key] = proc.pid
                return {"status": "success", "pid": proc.pid}
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.post("/api/modules/{module_key}/stop", response_model=Dict[str, Any])
        async def stop_module(module_key: str):
            """모듈 프로세스 종료."""
            pid = self._module_pids.get(module_key)
            if not pid:
                return {"status": "success", "message": "not_running"}
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
            finally:
                self._module_pids.pop(module_key, None)
            return {"status": "success", "pid": pid}
        
        @self.app.post("/api/stop-all", response_model=Dict[str, Any])
        async def stop_all():
            """전체 종료: 서비스 등록 해제 + 실행 중인 서비스·모듈 프로세스 모두 종료."""
            # 1) 서비스 등록 해제 (이벤트 버스에서 제거)
            service_ids = list(self.services.keys())
            for sid in service_ids:
                del self.services[sid]
            # 해당 서비스의 파이프라인 집계기 제거
            pipeline_ids = list(self.aggregators.keys())
            for pid in pipeline_ids:
                del self.aggregators[pid]
            # 2) 모든 서비스 프로세스 종료
            service_pid_count = len(self._service_pids)
            for sid, pid in list(self._service_pids.items()):
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                except Exception:
                    pass
                self._service_pids.pop(sid, None)
            # 3) 모든 모듈 프로세스 종료
            module_count = len(self._module_pids)
            for mkey, pid in list(self._module_pids.items()):
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                except Exception:
                    pass
                self._module_pids.pop(mkey, None)
            return {
                "status": "success",
                "services_unregistered": len(service_ids),
                "services_stopped": service_pid_count,
                "modules_stopped": module_count,
            }
        
        @self.app.post("/api/services/stop-all", response_model=Dict[str, Any])
        async def stop_all_services():
            """서비스만 종료: 실행 중인 서비스 프로세스만 종료 (모듈·등록 상태 유지)."""
            stopped = 0
            for sid, pid in list(self._service_pids.items()):
                try:
                    os.kill(pid, signal.SIGTERM)
                    stopped += 1
                except ProcessLookupError:
                    pass
                except Exception:
                    pass
                self._service_pids.pop(sid, None)
            return {"status": "success", "stopped": stopped}
        
        @self.app.post("/api/modules/stop-all", response_model=Dict[str, Any])
        async def stop_all_modules():
            """모듈만 종료: 실행 중인 모듈 프로세스만 종료 (서비스·등록 상태 유지)."""
            stopped = 0
            for mkey, pid in list(self._module_pids.items()):
                try:
                    os.kill(pid, signal.SIGTERM)
                    stopped += 1
                except ProcessLookupError:
                    pass
                except Exception:
                    pass
                self._module_pids.pop(mkey, None)
            return {"status": "success", "stopped": stopped}
        
        @self.app.post("/api/services/{service_id}/restart", response_model=Dict[str, Any])
        async def restart_service(service_id: str):
            """서비스 재시작: 해당 서비스 프로세스 종료 후 다시 시작."""
            pid = self._service_pids.get(service_id)
            if pid:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"종료 실패: {e}")
                self._service_pids.pop(service_id, None)
                await asyncio.sleep(0.5)
            return await start_service(service_id)
        
        @self.app.get("/health")
        async def health_check():
            """헬스 체크"""
            return {
                "status": "healthy",
                "modules": len(self.modules),
                "services": len(self.services),
                "event_log_size": len(self.event_bus.event_log)
            }
        
        @self.app.get("/api/status", response_model=Dict[str, Any])
        async def get_status():
            """상태 정보 조회 (웹 UI용)"""
            # 파이프라인 정보를 구독자 정보로 변환
            pipeline_subscriber_details = []
            for pipeline_id, pipeline_info in self.pipelines.items():
                # pipeline_info가 dict인 경우와 객체인 경우 모두 처리
                if isinstance(pipeline_info, dict):
                    pipeline_name = pipeline_info.get('name', pipeline_id)
                    trigger = pipeline_info.get('trigger', {})
                    broadcast = pipeline_info.get('broadcast', [])
                    if isinstance(trigger, dict):
                        event_type = trigger.get('event')
                    else:
                        event_type = getattr(trigger, 'event', None) if trigger else None
                else:
                    pipeline_name = pipeline_info.name if hasattr(pipeline_info, 'name') else pipeline_id
                    trigger = pipeline_info.trigger if hasattr(pipeline_info, 'trigger') else None
                    broadcast = pipeline_info.broadcast if hasattr(pipeline_info, 'broadcast') else []
                    if isinstance(trigger, dict):
                        event_type = trigger.get('event')
                    elif trigger and hasattr(trigger, 'event'):
                        event_type = trigger.event
                    else:
                        event_type = None
                
                if not event_type:
                    # event_type이 없어도 파이프라인 정보는 표시 (트리거 정보 없음으로 표시)
                    event_type = "N/A"
                
                # 파이프라인이 속한 서비스 찾기
                service_id = None
                service_name = None
                service_ui_url = None
                for sid, service_info in self.services.items():
                    pipelines = service_info.get("pipelines", [])
                    for p in pipelines:
                        pid = p.get("id", p) if isinstance(p, dict) else p
                        if (isinstance(pid, str) and pid == pipeline_id) or (isinstance(p, dict) and p.get("id") == pipeline_id):
                            service_id = sid
                            service_name = service_info.get("metadata", {}).get("name", sid)
                            ui_server = service_info.get("metadata", {}).get("ui_server")
                            if ui_server and isinstance(ui_server, dict):
                                service_ui_url = f"http://{ui_server.get('host', 'localhost')}:{ui_server.get('external_port', '')}"
                            break
                    if service_id:
                        break
                
                # 파이프라인의 브로드캐스트 모듈 목록
                modules = []
                if broadcast:
                    for broadcast_info in broadcast:
                        # ModuleCallInfo는 BaseModel이므로 속성으로 접근
                        if isinstance(broadcast_info, dict):
                            module_id = broadcast_info.get('module')
                        else:
                            module_id = getattr(broadcast_info, 'module', None)
                        if module_id:
                            modules.append(module_id)
                
                # 각 모듈별로 파이프라인 구독 정보 생성
                if modules:
                    for module_id in modules:
                        # 모듈 정보 가져오기
                        module_info = None
                        module_endpoint = None
                        for mid, minfo in self.modules.items():
                            if mid == module_id or mid.endswith(module_id) or mid.split('.')[-1] == module_id:
                                module_info = minfo
                                module_endpoint = minfo.endpoint
                                break
                        
                        pipeline_subscriber_details.append({
                            "event_type": event_type,
                            "pipeline_id": pipeline_id,
                            "pipeline_name": pipeline_name,
                            "service_id": service_id,
                            "service_name": service_name,
                            "service_ui_url": service_ui_url,
                            "module_id": module_id,
                            "module_name": module_info.name if module_info else module_id,
                            "module_endpoint": module_endpoint
                        })
                else:
                    # 모듈이 없는 경우에도 파이프라인 정보는 표시
                    pipeline_subscriber_details.append({
                        "event_type": event_type,
                        "pipeline_id": pipeline_id,
                        "pipeline_name": pipeline_name,
                        "service_id": service_id,
                        "service_name": service_name,
                        "service_ui_url": service_ui_url,
                        "module_id": None,
                        "module_name": None,
                        "module_endpoint": None
                    })
            
            # 기존 구독자 정보 (하위 호환성)
            subscriber_details = []
            for event_type, subscribers in self.event_bus.subscribers.items():
                for subscriber in subscribers:
                    subscriber_type = "Unknown"
                    subscriber_name = "Unknown"
                    
                    if hasattr(subscriber, "__class__"):
                        subscriber_type = subscriber.__class__.__name__
                        if hasattr(subscriber, "name"):
                            subscriber_name = subscriber.name
                        elif hasattr(subscriber, "__name__"):
                            subscriber_name = subscriber.__name__
                        else:
                            subscriber_name = subscriber_type
                    
                    subscriber_details.append({
                        "event_type": event_type,
                        "subscriber_type": subscriber_type,
                        "subscriber_name": subscriber_name,
                        "subscriber_id": str(id(subscriber))
                    })
            
            # 서비스별 파이프라인 그룹화
            services_list = []
            for service_id, service_info in self.services.items():
                # 서비스에 속한 파이프라인 상세 정보 수집 (pipelines 항목은 id 문자열 또는 전체 dict일 수 있음)
                pipeline_details = []
                for p in service_info.get("pipelines", []):
                    pid = p.get("id", p) if isinstance(p, dict) else p
                    if isinstance(pid, str) and pid in self.pipelines:
                        pipeline_details.append(self.pipelines[pid].dict())
                    elif isinstance(p, dict):
                        pipeline_details.append(p)
                
                services_list.append({
                    "service_id": service_id,
                    "name": service_info.get("metadata", {}).get("name", service_id),
                    "metadata": service_info.get("metadata", {}),   
                    "pipelines": service_info.get("pipelines", []),
                    "config": service_info.get("config", {}),
                    "interfaces": service_info.get("interfaces", []),
                    "active": service_info.get("active", True)
                })
            
            return {
                "modules": {
                    "count": len(self.modules),
                    "list": [m.dict() for m in self.modules.values()]
                },
                "services": {
                    "count": len(self.services),
                    "list": services_list
                },
                "pipelines": {
                    "count": len(self.pipelines),
                    "list": [p.dict() for p in self.pipelines.values()]
                },
                "events": {
                    "total": len(self.event_bus.event_log),
                    "recent": [e.to_dict() for e in self.event_bus.event_log[-50:]]  # 최근 50개
                },
                "subscribers": {
                    "summary": {
                        event_type: len(subscribers) 
                        for event_type, subscribers in self.event_bus.subscribers.items()
                    },
                    "details": subscriber_details,
                    "pipeline_details": pipeline_subscriber_details  # 파이프라인 기반 구독 정보
                }
            }
        
        @self.app.get("/api/events/recent", response_model=List[Dict[str, Any]])
        async def get_recent_events(limit: int = 50, since_event_id: Optional[str] = None):
            """최근 이벤트 조회 (since_event_id 이후의 이벤트만 반환)"""
            events = self.event_bus.event_log[-limit:]
            if since_event_id:
                # 특정 이벤트 ID 이후의 이벤트만 반환
                found = False
                filtered_events = []
                for event in reversed(events):
                    if event.event_id == since_event_id:
                        found = True
                        break
                    if found:
                        filtered_events.append(event)
                events = list(reversed(filtered_events)) if found else []
            # print(f"EVENTS: {events} \n\n")
            return [e.to_dict() for e in events]

        @self.app.get("/api/events/stream")
        async def sse_stream(
            request: Request,
            client_id: Optional[str] = None,
        ):
            """SSE: 연결별 매핑 + 타깃 전송.
            - 파라미터 없음: 브로드캐스트(기존 동작, 모든 공개 이벤트).
            - client_id + targeted_only=1: 해당 ID로 타깃되는 이벤트만(다른 사용자 응답 미수신).
            - subscribe_all=1: 브로드캐스트와 동일(문서용 명시).
            """
            to_only = (request.query_params.get("targeted_only") or "").lower() in (
                "1",
                "true",
                "yes",
            )
            cid = (client_id or request.headers.get("X-SSE-Client-Id") or "").strip()

            queue: asyncio.Queue = asyncio.Queue(maxsize=500)
            assigned_client_id: Optional[str] = None

            if to_only:
                if not cid:
                    cid = str(uuid.uuid4())
                    assigned_client_id = cid
                if cid not in self._sse_by_client_id:
                    self._sse_by_client_id[cid] = []
                self._sse_by_client_id[cid].append(queue)
                mode = "targeted"
            else:
                self._sse_broadcast_queues.append(queue)
                mode = "broadcast"

            async def event_generator():
                try:
                    if assigned_client_id:
                        hello = {
                            "type": "SSE_CONNECTED",
                            "payload": {"client_id": assigned_client_id, "mode": mode},
                            "event_id": str(uuid.uuid4()),
                            "metadata": {},
                        }
                        yield f"event: sagohub.connected\ndata: {json.dumps(hello, ensure_ascii=False)}\n\n"
                    while True:
                        try:
                            ev = await asyncio.wait_for(queue.get(), timeout=15.0)
                            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                        except asyncio.TimeoutError:
                            yield ": heartbeat\n\n"
                finally:
                    if mode == "targeted":
                        lst = self._sse_by_client_id.get(cid, [])
                        if queue in lst:
                            lst.remove(queue)
                        if not lst:
                            self._sse_by_client_id.pop(cid, None)
                    else:
                        if queue in self._sse_broadcast_queues:
                            self._sse_broadcast_queues.remove(queue)

            return StreamingResponse(
                event_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        # -------------------------------------------------------
        # FastAPI 리버스 프록시 (API Gateway)
        # /module/{module_id}/... 또는 /proxy/{module_id}/... -> 해당 모듈 엔드포인트로 토스
        # -------------------------------------------------------
        def _resolve_module_info(module_id: str) -> Optional[ModuleInfo]:
            """module_id로 모듈 정보 조회 (정확 일치 또는 짧은 이름: FileWatcher, file_watcher.FileWatcherModule 등)"""
            if module_id in self.modules:
                return self.modules[module_id]
            for mid, info in self.modules.items():
                if mid.endswith(module_id) or mid.split(".")[-1] == module_id:
                    return info
            return None

        async def _reverse_proxy_handler(module_id: str, path: str, request: Request):
            """특정 모듈로 요청을 바이패스하는 리버스 프록시 (httpx 비동기 스트리밍)"""
            module_info = _resolve_module_info(module_id)
            if not module_info:
                raise HTTPException(status_code=404, detail=f"Module '{module_id}' not found")
            if not module_info.endpoint:
                raise HTTPException(status_code=400, detail=f"Module '{module_id}' has no endpoint (Polling mode)")

            target_base = module_info.endpoint.rstrip("/")
            target_url = f"{target_base}/{path}" if path else target_base
            if request.url.query:
                target_url += f"?{request.url.query}"

            client = httpx.AsyncClient(timeout=60.0)
            try:
                body = await request.body()
                headers = dict(request.headers)
                headers.pop("host", None)
                headers.pop("content-length", None)

                req = client.build_request(
                    request.method,
                    target_url,
                    headers=headers,
                    content=body,
                )
                r = await client.send(req, stream=True)

                async def stream_then_close():
                    try:
                        async for chunk in r.aiter_raw():
                            yield chunk
                    finally:
                        await client.aclose()

                return StreamingResponse(
                    stream_then_close(),
                    status_code=r.status_code,
                    headers=dict(r.headers),
                )
            except httpx.ConnectError:
                await client.aclose()
                raise HTTPException(status_code=502, detail="Bad Gateway: Could not connect to module")
            except Exception as e:
                await client.aclose()
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.api_route("/module/{module_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
        async def module_proxy(module_id: str, path: str, request: Request):
            return await _reverse_proxy_handler(module_id, path or "", request)

        @self.app.api_route("/proxy/{module_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
        async def proxy_route(module_id: str, path: str, request: Request):
            return await _reverse_proxy_handler(module_id, path or "", request)

        # -------------------------------------------------------
        # 서비스 프록시 (Service UI Server Proxy)
        # /service/{service_id}/... -> 해당 서비스의 UI 서버로 프록시
        # -------------------------------------------------------
        def _resolve_service_info(service_id: str) -> Optional[Dict[str, Any]]:
            """service_id로 서비스 정보 조회"""
            if service_id in self.services:
                return self.services[service_id]
            # 짧은 이름으로도 찾기 (예: file-monitor -> com.SagoHub.file-monitor)
            for sid, service_info in self.services.items():
                if sid.endswith(service_id) or sid.split(".")[-1] == service_id:
                    return service_info
            return None

        def _get_service_ui_url(service_info: Dict[str, Any]) -> Optional[str]:
            """서비스 정보에서 UI 서버 URL 추출"""
            if not service_info:
                return None
            
            metadata = service_info.get("metadata", {})
            ui_server = metadata.get("ui_server")
            
            if not ui_server:
                return None
            
            # ui_server가 dict인 경우
            if isinstance(ui_server, dict):
                host = ui_server.get("host", "localhost")
                # 0.0.0.0은 localhost로 변환 (외부 접근용)
                if host == "0.0.0.0":
                    host = "localhost"
                # external_port가 있으면 사용, 없으면 port 사용
                port = ui_server.get("external_port") or ui_server.get("port")
                if port:
                    return f"http://{host}:{port}"
            
            return None

        async def _service_proxy_handler(service_id: str, path: str, request: Request):
            """특정 서비스의 UI 서버로 요청을 프록시하는 핸들러"""
            service_info = _resolve_service_info(service_id)
            if not service_info:
                raise HTTPException(status_code=404, detail=f"Service '{service_id}' not found")
            
            service_ui_url = _get_service_ui_url(service_info)
            if not service_ui_url:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Service '{service_id}' has no UI server configured"
                )

            target_base = service_ui_url.rstrip("/")
            target_url = f"{target_base}/{path}" if path else target_base
            if request.url.query:
                target_url += f"?{request.url.query}"

            client = httpx.AsyncClient(timeout=60.0)
            try:
                body = await request.body()
                headers = dict(request.headers)
                headers.pop("host", None)
                headers.pop("content-length", None)

                req = client.build_request(
                    request.method,
                    target_url,
                    headers=headers,
                    content=body,
                )
                r = await client.send(req, stream=True)

                async def stream_then_close():
                    try:
                        async for chunk in r.aiter_raw():
                            yield chunk
                    finally:
                        await client.aclose()

                return StreamingResponse(
                    stream_then_close(),
                    status_code=r.status_code,
                    headers=dict(r.headers),
                )
            except httpx.ConnectError:
                await client.aclose()
                raise HTTPException(
                    status_code=502, 
                    detail=f"Bad Gateway: Could not connect to service UI server at {service_ui_url}"
                )
            except Exception as e:
                await client.aclose()
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.api_route("/service/{service_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
        async def service_proxy(service_id: str, path: str, request: Request):
            """서비스 UI 서버 프록시"""
            return await _service_proxy_handler(service_id, path or "", request)

    async def _push_event_to_module(self, module_info: ModuleInfo, event: Event):
        """모듈 엔드포인트로 이벤트 전송"""
        import aiohttp
        # 비동기 HTTP 요청 (event_log 기록은 /publish 핸들러에서 이미 수행됨)
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{module_info.endpoint}/event",
                json=event.to_dict(),
                timeout=aiohttp.ClientTimeout(total=self._module_event_timeout)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    return result
                return None

    async def _send_event_to_module_with_aggregation(self, endpoint: str, event: Event, 
                                                     module_id: str, pipeline_id: Optional[str] = None,
                                                     module_call: Optional[ModuleCallInfo] = None):
        """모듈 엔드포인트로 이벤트 전송 (집계 지원, 새 스키마: args 매핑)"""
        import aiohttp
        
        # 새 스키마: module_call의 args로 이벤트 데이터 매핑
        event_data = event.to_dict()
        if module_call and module_call.args:
            # args의 동적 변수를 해석하여 이벤트 데이터에 추가
            # 실제 구현에서는 더 복잡한 변수 해석이 필요하지만, 여기서는 기본 구조만 제공
            enriched_payload = event_data.get("payload", {}).copy()
            for key, value in module_call.args.items():
                # 간단한 변수 치환 (실제로는 더 정교한 파서 필요)
                if isinstance(value, str) and "${" in value:
                    # TODO: 동적 변수 해석 구현
                    enriched_payload[key] = value
                else:
                    enriched_payload[key] = value
            event_data["payload"] = enriched_payload
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{endpoint}/event",
                    json=event_data,
                    timeout=aiohttp.ClientTimeout(total=self._module_event_timeout)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        
                        # 집계가 필요한 경우 응답 저장
                        if pipeline_id and pipeline_id in self.aggregators:
                            if result.get("status") == "success" and result.get("new_events"):
                                for evt_dict in result["new_events"]:
                                    new_event = Event.from_dict(evt_dict)
                                    aggregator = self.aggregators[pipeline_id]
                                    # 새 스키마: ModuleCallInfo의 priority 사용
                                    priority = 0
                                    if module_call:
                                        priority = module_call.priority
                                    else:
                                        # 하위 호환성: options에서 우선순위 가져오기
                                        priority = self.pipelines[pipeline_id].aggregation.options.get(
                                            "priority_order", {}
                                        ).get(module_id, 0)
                                    aggregator.add_response(event.event_id, module_id, new_event, priority)
                        else:
                            # 집계가 없으면 즉시 발행
                            if result.get("status") == "success" and result.get("new_events"):
                                for evt_dict in result["new_events"]:
                                    new_event = Event.from_dict(evt_dict)
                                    loop = asyncio.get_event_loop()
                                    await loop.run_in_executor(
                                        None, 
                                        self.event_bus.publish, 
                                        new_event
                                    )
        except Exception as e:
            print(f"⚠️  모듈 {endpoint}로 이벤트 전송 실패: {e}")
    
    async def _process_aggregations(self, original_event: Event):
        """집계 처리 및 최종 이벤트 발행"""
        import asyncio
        
        for pipeline_id, aggregator in self.aggregators.items():
            pipeline_info = self.pipelines.get(pipeline_id)
            if not pipeline_info or not pipeline_info.aggregation:
                continue
            
            # 새 스키마: broadcast에서 입력 모듈 목록 추출
            input_modules = set()
            if pipeline_info.broadcast:
                module_id_map = {
                    "ai.llm.draft_email": "M_LLM_Drafter",
                    "nudge.create_draft": "M_Nudge_UI",
                    "nudge.check_approval": "M_Nudge_UI",
                    "mail.send": "M_Mailer",
                    "monitor.log_change": "M_Monitor_Log",
                    "monitor.console_output": "M_Monitor_Console",
                }
                for bc_call in pipeline_info.broadcast:
                    module_id = module_id_map.get(bc_call.module)
                    if module_id:
                        input_modules.add(module_id)
            else:
                # 하위 호환성: aggregation.inputs 사용
                input_modules = set(pipeline_info.aggregation.inputs if hasattr(pipeline_info.aggregation, 'inputs') else [])
            
            responses = aggregator.pending_events.get(original_event.event_id, [])
            responded_modules = {r["module_id"] for r in responses}
            
            # 모든 입력 모듈이 응답했는지 확인 (또는 대기 시간 경과)
            # 현재는 즉시 처리 (향후 wait_window_ms 구현 가능)
            if input_modules.issubset(responded_modules) or len(responses) > 0:
                # 집계 해결
                resolved_events = aggregator.resolve(original_event.event_id)
                
                if resolved_events:
                    # 새 스키마: aggregation.target 사용
                    target = pipeline_info.aggregation.target
                    if target == "event_bus":
                        # SagoHub로 발행
                        for resolved_event in resolved_events:
                            loop = asyncio.get_event_loop()
                            await loop.run_in_executor(
                                None,
                                self.event_bus.publish,
                                resolved_event
                            )
                    elif target and target != "null" and target is not None:
                        # 특정 모듈로 전송
                        target_module_id = target
                        target_module_info = self.modules.get(target_module_id)
                        if target_module_info and target_module_info.endpoint:
                            for resolved_event in resolved_events:
                                await self._send_event_to_module_with_aggregation(
                                    target_module_info.endpoint,
                                    resolved_event,
                                    target_module_id,
                                    pipeline_id,
                                    None  # module_call은 집계 결과이므로 None
                                )
                    # target이 null이거나 None이면 아무것도 하지 않음 (INDEPENDENT 전략)
                    
                    # 집계 완료 후 정리
                    aggregator.clear(original_event.event_id                                )
                    
                    # 집계 완료 후 정리
                    aggregator.clear(original_event.event_id)
    
    def _start_health_check(self):
        """헬스체크 스레드 시작"""
        def health_check_loop():
            while True:
                try:
                    time.sleep(self._health_check_interval)
                    self._check_module_health()
                except Exception as e:
                    print(f"⚠️  헬스체크 오류: {e}")
        
        self._health_check_thread = threading.Thread(
            target=health_check_loop,
            daemon=True,
            name="HealthCheck"
        )
        self._health_check_thread.start()
    
    def _check_module_health(self):
        """모든 모듈의 헬스 상태 확인"""
        for module_id, module_info in list(self.modules.items()):
            if not module_info.endpoint:
                continue
            
            try:
                response = requests.get(
                    f"{module_info.endpoint}/health",
                    timeout=3
                )
                if response.status_code == 200:
                    # 성공: 상태 초기화
                    module_info.health_status = "healthy"
                    module_info.failure_count = 0
                    module_info.last_heartbeat = datetime.now().isoformat()
                else:
                    # 실패 카운트 증가
                    print(f"⚠️  모듈 {module_id} 헬스 체크 실패: {response.status_code}")
                    module_info.failure_count += 1
                    # module_info.health_status = "checking"
                    if module_info.failure_count >= self._health_check_failure_threshold:
                        module_info.health_status = "unhealthy"
                        # print(f"⚠️  모듈 {module_id} 비활성화 (연속 {module_info.failure_count}회 실패)")
            except Exception as e:
                # 네트워크 오류 등
                module_info.failure_count += 1
                if module_info.failure_count >= self._health_check_failure_threshold:
                    module_info.health_status = "unhealthy"
                    # print(f"⚠️  모듈 {module_id} 비활성화: {e}")
    
    def _setup_web_ui(self):
        """웹 UI 설정"""
        @self.app.get("/", response_class=HTMLResponse)
        async def root():
            """메인 페이지"""
            return self._get_html_template()
        
        @self.app.get("/dashboard", response_class=HTMLResponse)
        async def dashboard():
            """대시보드 페이지"""
            return self._get_html_template()
    
    def _get_html_template(self) -> str:
        """HTML 템플릿 반환"""
        # 템플릿 파일 경로
        template_path = Path(__file__).parent / "templates" / "dashboard.html"
        
        try:
            with open(template_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            # 템플릿 파일이 없으면 에러 메시지 반환
            return f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>SagoHub - Error</title>
</head>
<body>
    <h1>템플릿 파일을 찾을 수 없습니다</h1>
    <p>템플릿 파일 경로: {template_path}</p>
    <p>파일이 존재하는지 확인하세요.</p>
</body>
</html>"""
    def run(self):
        # 1. 기본 설정 복사
        config = LOGGING_CONFIG.copy()
        
        # 2. 로그 디렉터리: 프로젝트 루트/logs (core -> SagoHub -> src -> project root)
        _base = Path(__file__).resolve().parent.parent.parent.parent
        _logs_dir = _base / "logs"
        _logs_dir.mkdir(parents=True, exist_ok=True)
        _log_file = _logs_dir / "event_bus_server_output.log"
        config["handlers"]["file"] = {
            "class": "logging.FileHandler",
            "filename": str(_log_file),
            "mode": "a",
            "encoding": "utf-8",
            "formatter": "default",
        }
        
        # 3. Access 로그가 '콘솔(default)' 대신 '파일'을 쓰도록 변경
        # 원래 ["access"] 였던 것을 ["file"]로 교체
        config["loggers"]["uvicorn.access"]["handlers"] = ["file"]
        config["loggers"]["uvicorn.access"]["propagate"] = False # 상위로 전파 금지 (중요)
        
        """서버 실행"""        
        uvicorn.run(self.app, host=self.host, port=self.port, 
        log_config=config,
        log_level="warning")


def run_event_bus_server(host: Optional[str] = None, port: Optional[int] = None):
    """이벤트 버스 서버 실행 (main_core.py, main.py, 직접 실행용). host/port 미지정 시 환경변수 사용."""
    host = host or os.getenv("EVENT_BUS_HOST", "0.0.0.0")
    port = port or int(os.getenv("EVENT_BUS_PORT", "8000"))
    orchestrator = Orchestrator()
    server = EventBusServer(orchestrator=orchestrator, host=host, port=port)
    server.run()


if __name__ == "__main__":
    run_event_bus_server()
