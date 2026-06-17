"""
모듈 기본 인터페이스: 독립적인 기능 부품
- can_handle: 이 이벤트를 처리할 수 있는지, 얼마나 확신하는지
- process: 처리하고 새 이벤트들 반환
- negotiate: 불확실하면 협상 시작 (선택)
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, TYPE_CHECKING
import os
import time
import requests
from .http_client import EventBusHTTPClient

if TYPE_CHECKING:
    from .event import Event


class Negotiation:
    """협상 제안/결과를 나타내는 객체"""
    def __init__(self, accepted: bool = False, context: Optional[Dict[str, Any]] = None):
        self.accepted = accepted
        self.context = context or {}


class Context:
    """실행 컨텍스트 (사용자 상태, 환경 등)"""
    def __init__(self, **kwargs):
        self._data = kwargs

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._data.get(name)


class Module(ABC):
    """모든 모듈의 기본 인터페이스"""

    name: str = "BaseModule"
    description: str = ""
    capabilities: list = []
    module_id: str = ""
    _event_bus_client: EventBusHTTPClient = None
    _service_url: str = ""

    def __init__(self):
        self.module_id = f"{self.__class__.__module__.split('.')[-1]}.{self.__class__.__name__}"
        

    def can_handle(self, event: "Event") -> float:
        """
        이 이벤트를 처리할 수 있는지, 얼마나 확신하는지 (0.0 ~ 1.0).
        기본: 해당 이벤트 타입을 처리하는 모듈은 1.0 반환.
        """
        return 0.0

    @abstractmethod
    def process(self, event: "Event") -> List["Event"]:
        """처리하고 새 이벤트들 반환"""
        pass

    def negotiate(self, event: "Event", context: Optional[Context] = None) -> Optional[Negotiation]:
        """불확실하면 협상 시작. 기본은 None (협상 없음)"""
        return None

    def publish(self, event: "Event"):
        """이벤트 발행"""
        self._event_bus_client.publish(event)
    
    #서비스 주소도 받아서 모듈 서버 시작
    def run(self, event_bus_url: str = "http://localhost:8000", service_url: str = "http://localhost:8000", poll_interval: int = 5, use_push: bool = True):
        
        
        self._event_bus_client = EventBusHTTPClient(event_bus_url)
        self._service_url = service_url

        if use_push:
            # 푸시 방식: 모듈 서버 시작
            from .module_server import ModuleServer
            
            # 모듈 서버 시작 (포트 자동 할당)
            module_port = int(os.getenv(f"{self.name}_PORT", "0"))
            server = ModuleServer(self, port=module_port)
            server.start()
            
            # 서버 URL 가져오기
            module_url = server.get_url()
            if not module_url:
                # 서버가 시작될 때까지 대기
                for _ in range(50):
                    module_url = server.get_url()
                    if module_url:
                        break
                    time.sleep(0.1)
            
            if not module_url:
                print(f"[{self.name}] ❌ 모듈 서버 시작 실패")
                return
            
            print(f"[{self.name}] 모듈 서버 시작: {module_url}")
            
            # 모듈 정보 구성
            display_name = self.name.replace("M_", "").replace("_", " ")
            description = getattr(self, "description", "") or (self.__doc__ or "").strip().split("\n")[0] if self.__doc__ else ""
            capabilities = getattr(self, "capabilities", [])
            
            module_id = f"{self.__class__.__module__.split('.')[-1]}.{self.__class__.__name__}"
            module_info = {
                "module_id": module_id,
                "name": display_name,
                "description": description,
                "capabilities": capabilities,
                "endpoint": module_url,  # 필수: 푸시 방식
                "config": {}
            }
            
            # SagoHub 서버에 모듈 등록
            print(f"[{self.name}] [use_push=True] SagoHub 서버에 등록 중...")
            max_retries = 30
            retry_count = 0
            while retry_count < max_retries:
                try:
                    self._event_bus_client.register_module(module_info)
                    print(f"[{self.name}] ✅ 모듈 등록 완료 (엔드포인트: {module_url})")
                    break
                except Exception as e:
                    if "already exists" in str(e):
                        # 업데이트 시도
                        try:
                            self._event_bus_client.update_module(module_id, module_info)
                            print(f"[{self.name}] ✅ 모듈 업데이트 완료")
                            break
                        except:
                            pass
                    retry_count += 1
                    if retry_count >= max_retries:
                        print(f"[{self.name}] ❌ 모듈 등록 실패: {e}")
                        return
                    time.sleep(0.5)
            
            # 하트비트 루프 (1분마다)
            print(f"[{self.name}] 하트비트 시작...")
            abort_count = 0
            try:
                while True:
                    time.sleep(poll_interval)  # 1분마다 하트비트
                    try:
                        # 모듈 정보 업데이트 (하트비트)
                        result = self._event_bus_client.update_module(module_id, module_info)
                        abort_count = 0
                    except Exception as e:
                        if "Connection aborted" in str(e):
                            abort_count += 1
                            if abort_count > 5:
                                result = self._event_bus_client.register_module(module_info)
                                print(f"[{self.name}] ✅ 모듈 등록 완료: {result}")
                        else:
                            raise Exception(f"[{self.name}] ⚠️  하트비트 실패(주기: {poll_interval}초): {e}")
            except KeyboardInterrupt:
                print(f"[{self.name}] 종료 중...")
        else:
            # 폴링 방식 (기존 방식 - 하위 호환성)
            # 모듈 정보 구성
            display_name = self.name.replace("M_", "").replace("_", " ")
            description = getattr(self, "description", "") or (self.__doc__ or "").strip().split("\n")[0] if self.__doc__ else ""
            capabilities = getattr(self, "capabilities", [])
            
            module_id = f"{self.__class__.__module__.split('.')[-1]}.{self.__class__.__name__}"

            module_info = {
                "module_id": module_id,
                "name": display_name,
                "description": description,
                "capabilities": capabilities,
                "config": {}
            }
            
            # SagoHub 서버에 모듈 등록
            print(f"[{self.name}] [use_push=False] SagoHub 서버에 등록 중...")
            max_retries = 30
            retry_count = 0
            while retry_count < max_retries:
                try:
                    self._event_bus_client.register_module(module_info)
                    print(f"[{self.name}] ✅ 모듈 등록 완료")
                    break
                except Exception as e:
                    if "already exists" in str(e):
                        print(f"[{self.name}] ✅ 모듈 이미 등록됨")
                        break
                    retry_count += 1
                    if retry_count >= max_retries:
                        print(f"[{self.name}] ❌ 모듈 등록 실패: {e}")
                        return
                    time.sleep(0.5)
            
            # 이벤트 폴링 루프
            print(f"[{self.name}] 이벤트 처리 시작 (폴링 방식)...")
            last_event_id = None
            
            try:
                while True:
                    try:
                        # 최근 이벤트 조회 (since_event_id 파라미터 사용)
                        params = {"limit": 50}
                        if last_event_id:
                            params["since_event_id"] = last_event_id
                        
                        response = requests.get(
                            f"{event_bus_url}/api/events/recent",
                            params=params,
                            timeout=5
                        )
                        if response.status_code == 200:
                            events = response.json()
                            # 역순으로 처리 (최신 이벤트부터)
                            for event_dict in reversed(events):
                                event_id = event_dict.get("event_id")
                                
                                # 이미 처리한 이벤트는 스킵
                                if last_event_id and event_id == last_event_id:
                                    continue
                                
                                event = Event.from_dict(event_dict)
                                
                                # 이 모듈이 처리할 수 있는 이벤트인지 확인
                                if self.can_handle(event) > 0:
                                    # 이벤트 처리
                                    new_events = self.process(event)
                                    
                                    # 새로 생성된 이벤트 발행
                                    for new_event in new_events:
                                        try:
                                            self._event_bus_client.publish(new_event)
                                        except Exception as e:
                                            print(f"[{self.name}] ⚠️  이벤트 발행 실패: {e}")
                                
                                # 마지막 처리한 이벤트 ID 업데이트
                                if not last_event_id or (events and event_id):
                                    last_event_id = event_id
                        
                    except Exception as e:
                        print(f"[{self.name}] ⚠️  이벤트 폴링 오류: {e}")
                    
                    time.sleep(poll_interval)
            except KeyboardInterrupt:
                print(f"[{self.name}] 종료 중...")