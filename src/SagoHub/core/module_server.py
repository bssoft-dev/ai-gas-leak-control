"""
모듈 HTTP 서버: 각 모듈이 FastAPI 서버를 올려서 이벤트를 받을 수 있도록
"""
import os
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
import uvicorn
from uvicorn.config import LOGGING_CONFIG

from .module import Module
from .event import Event


class EventRequest(BaseModel):
    """이벤트 요청 모델"""
    type: str
    payload: dict
    timestamp: Optional[str] = None
    source_module: Optional[str] = None
    event_id: Optional[str] = None
    metadata: Optional[dict] = None
    service_id: Optional[str] = None


class ModuleServer:
    """모듈용 FastAPI 서버"""
    
    def __init__(self, module: Module, port: int = 0, host: str = "0.0.0.0"):
        """
        모듈 서버 초기화
        
        Args:
            module: 모듈 인스턴스
            port: 포트 번호 (0이면 자동 할당)
            host: 호스트 주소
        """
        self.module = module
        self.port = port
        self.host = host
        self.app = FastAPI(title=f"{module.name} Module Server")
        
        # 이벤트 처리 로그
        self.event_log: List[Dict[str, Any]] = []
        self.stats = {
            "total_events": 0,
            "processed_events": 0,
            "ignored_events": 0,
            "errors": 0,
            "last_event_time": None
        }
        
        # CORS 설정
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        
        self._setup_routes()
        self._server_thread: Optional[threading.Thread] = None
        self._actual_port: Optional[int] = None
    
    def _setup_routes(self):
        """라우트 설정"""
        
        @self.app.get("/", response_class=HTMLResponse)
        async def dashboard():
            """모듈 대시보드"""
            return self._get_dashboard_html()
        
        @self.app.post("/event", response_model=dict)
        async def handle_event(event_req: EventRequest):
            """이벤트 처리 엔드포인트"""
            try:
                # Event 객체 생성
                event = Event.from_dict(event_req.dict())
                
                # 통계 업데이트
                self.stats["total_events"] += 1
                self.stats["last_event_time"] = datetime.now().isoformat()
                
                # 모듈이 처리할 수 있는 이벤트인지 확인
                can_handle_score = self.module.can_handle(event)
                print(f"[{self.module.name}] EVENT: {event} \n")
                print(f"[{self.module.name}] CAN HANDLE SCORE: {can_handle_score} \n")
                if can_handle_score <= 0:
                    self.stats["ignored_events"] += 1
                    log_entry = {
                        "timestamp": datetime.now().isoformat(),
                        "event_type": event.type,
                        "event_id": event.event_id or "N/A",
                        "status": "ignored",
                        "reason": "Module cannot handle this event type",
                        "can_handle_score": can_handle_score,
                        "payload": event.payload
                    }
                    self.event_log.append(log_entry)
                    # 최근 100개만 유지
                    if len(self.event_log) > 100:
                        self.event_log.pop(0)
                    
                    return {
                        "status": "ignored",
                        "reason": "Module cannot handle this event type"
                    }
                
                # 이벤트 처리 (동기적으로)
                import asyncio
                loop = asyncio.get_event_loop()
                
                new_events = await loop.run_in_executor(None, self.module.process, event)
                #모듈정보 출력
                print(f"MODULE_ID: {self.module.module_id} \n\n")
                print(f"NEW EVENTS: {new_events} \n\n")
                
                # 통계 업데이트
                self.stats["processed_events"] += 1
                
                # 로그 기록
                # new_events를 직렬화 가능한 형태로 변환
                new_events_data = []
                if new_events:
                    for new_event in new_events:
                        if hasattr(new_event, 'to_dict'):
                            new_events_data.append(new_event.to_dict())
                        elif isinstance(new_event, dict):
                            new_events_data.append(new_event)
                        else:
                            # Event 객체인 경우
                            new_events_data.append({
                                "type": getattr(new_event, 'type', 'unknown'),
                                "event_id": getattr(new_event, 'event_id', ''),
                                "payload": getattr(new_event, 'payload', {}),
                                "timestamp": getattr(new_event, 'timestamp', datetime.now()).isoformat() if hasattr(getattr(new_event, 'timestamp', None), 'isoformat') else str(getattr(new_event, 'timestamp', '')),
                                "source_module": getattr(new_event, 'source_module', '')
                            })
                
                log_entry = {
                    "timestamp": datetime.now().isoformat(),
                    "event_type": event.type,
                    "event_id": event.event_id,
                    "status": "processed",
                    "new_events_count": len(new_events or []),
                    "new_events": new_events_data,
                    "can_handle_score": can_handle_score,
                    "payload": event.payload
                }
                self.event_log.append(log_entry)
                # 최근 100개만 유지
                if len(self.event_log) > 100:
                    self.event_log.pop(0)
                if len(new_events) > 0:
                    parent_sse = (event.metadata or {}).get("sse_client_ids")
                    for new_event in new_events:
                        if (
                            parent_sse
                            and isinstance(parent_sse, list)
                            and len(parent_sse) > 0
                        ):
                            new_event.metadata = dict(new_event.metadata or {})
                            if "sse_client_ids" not in new_event.metadata:
                                new_event.metadata["sse_client_ids"] = list(parent_sse)
                        await loop.run_in_executor(None, self.module.publish, new_event)
                    print(f"NEW EVENTS PUBLISHED: {new_events} \n\n")
                else:
                    print(f"NO NEW EVENTS PUBLISHED \n\n")
                # 결과 반환
                return {
                    "status": "success"
                }
            except Exception as e:
                self.stats["errors"] += 1
                log_entry = {
                    "timestamp": datetime.now().isoformat(),
                    "event_type": event_req.type if hasattr(event_req, 'type') else "unknown",
                    "status": "error",
                    "error": str(e),
                    "payload": event_req.payload if hasattr(event_req, 'payload') else {}
                }
                self.event_log.append(log_entry)
                if len(self.event_log) > 100:
                    self.event_log.pop(0)
                raise HTTPException(status_code=500, detail=str(e))
        
        @self.app.get("/health", response_model=dict)
        async def health_check():
            """헬스체크 엔드포인트"""
            return {
                "status": "healthy",
                "module": self.module.name,
                "description": getattr(self.module, "description", ""),
                "capabilities": getattr(self.module, "capabilities", [])
            }
        
        @self.app.get("/info", response_model=dict)
        async def module_info():
            """모듈 정보 조회"""
            return {
                "module_id": self.module.name,
                "name": self.module.name.replace("M_", "").replace("_", " "),
                "description": getattr(self.module, "description", ""),
                "capabilities": getattr(self.module, "capabilities", []),
                "port": self._actual_port or self.port,
                "stats": self.stats
            }
        
        @self.app.get("/stats", response_model=dict)
        async def get_stats():
            """통계 정보 조회"""
            return {
                "stats": self.stats,
                "recent_events": self.event_log[-20:]  # 최근 20개
            }
    
    def start(self, daemon: bool = True):
        """서버 시작 (별도 스레드)"""
        if self._server_thread and self._server_thread.is_alive():
            return
        
        def run_server():
            # 포트가 0이면 사용 가능한 포트 자동 할당
            if self.port == 0:
                import socket
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(('', 0))
                    self._actual_port = s.getsockname()[1]
            else:
                self._actual_port = self.port
            
            config = LOGGING_CONFIG.copy()
            _base = Path(__file__).resolve().parent.parent.parent.parent
            _logs_dir = _base / "logs"
            _logs_dir.mkdir(parents=True, exist_ok=True)
            filename = str(_logs_dir / f"module_server_output_{self.module.name}.log")
            config["handlers"]["file"] = {
                "class": "logging.FileHandler",
                "filename": filename,
                "mode": "a",
                "encoding": "utf-8",
                "formatter": "default",
            }
            config["loggers"]["uvicorn.access"]["handlers"] = ["file"]
            config["loggers"]["uvicorn.access"]["propagate"] = False # 상위로 전파 금지 (중요)

            uvicorn.run(
                self.app,
                host=self.host,
                port=self._actual_port,
                # log_level="info" if os.getenv("DEBUG") else "warning",
                log_config=config
            )

            print(f"Module server started on {self.host}:{self._actual_port}")
            print(f"Module server log file: {filename}")
        
        self._server_thread = threading.Thread(
            target=run_server,
            daemon=daemon,
            name=f"ModuleServer-{self.module.name}"
        )
        self._server_thread.start()
        
        # 서버가 시작될 때까지 대기
        import time
        max_wait = 5
        for _ in range(max_wait * 10):
            if self._actual_port:
                break
            time.sleep(0.1)
    
    def stop(self):
        """서버 중지"""
        # uvicorn 서버는 스레드에서 실행되므로 프로세스 종료 시 자동 종료됨
        pass
    
    def get_url(self) -> Optional[str]:
        """모듈 서버 URL 반환"""
        if not self._actual_port:
            return None
        return f"http://{self.host}:{self._actual_port}"
    
    def _get_dashboard_html(self) -> str:
        """모듈 대시보드 HTML 생성"""
        module_name = self.module.name.replace("M_", "").replace("_", " ")
        description = getattr(self.module, "description", "") or (self.module.__doc__ or "").strip().split("\n")[0] if self.module.__doc__ else ""
        capabilities = getattr(self.module, "capabilities", [])
        
        # Capabilities HTML 생성
        capabilities_html = ''.join([f'<span class="capability-badge">{cap}</span>' for cap in capabilities]) if capabilities else '<span style="color: #999;">없음</span>'
        
        # 이벤트 로그를 JSON으로 직렬화 (HTML 이스케이프)
        import json
        events_json = json.dumps(self.event_log, ensure_ascii=False, default=str)
        capabilities_json = json.dumps(capabilities, ensure_ascii=False)
        
        # 템플릿 파일 읽기
        template_path = Path(__file__).parent / "templates" / "module_dashboard.html"
        with open(template_path, "r", encoding="utf-8") as f:
            template = f.read()
        
        # 템플릿 변수 치환
        html = template.format(
            module_name=self.module.name,
            description=description or '모듈 대시보드',
            total_events=self.stats['total_events'],
            processed_events=self.stats['processed_events'],
            ignored_events=self.stats['ignored_events'],
            errors=self.stats['errors'],
            module_id=self.module.name,
            display_name=module_name,
            port=self._actual_port or self.port,
            last_event_time=self.stats['last_event_time'][:19].replace('T', ' ') if self.stats['last_event_time'] else '없음',
            capabilities_html=capabilities_html,
            capabilities_json=capabilities_json,
            events_json=events_json
        )
        
        return html
