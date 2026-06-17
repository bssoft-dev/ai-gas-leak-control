"""
서비스 매니저: 서비스 활성화/비활성화, 생명주기 관리
"""
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.orchestrator import Orchestrator
from .schema import ServiceDef
from .loader import ServiceLoader
from .adapter import ServiceAdapter


class ServiceManager:
    """서비스 생명주기 관리"""

    def __init__(self, services_dir: Path, orchestrator: Optional[Orchestrator] = None):
        self.services_dir = Path(services_dir)
        self.loader = ServiceLoader(services_dir)
        self.orchestrator = orchestrator or Orchestrator()
        self.adapter = ServiceAdapter(self.orchestrator)
        self.services: Dict[str, ServiceDef] = {}
        self.active_services: Dict[str, ServiceDef] = {}
        self.service_instances: Dict[str, List] = {}  # service_id -> [Service]

    def load_all(self) -> Dict[str, ServiceDef]:
        """모든 서비스 로드 (활성화 전)"""
        self.services = self.loader.load_all_services()
        return self.services

    def activate_service(self, service_id: str) -> bool:
        """서비스 활성화 (서비스 등록)"""
        if service_id not in self.services:
            return False
        svc = self.services[service_id]
        # 서비스 생성 및 등록
        service_instances = self.adapter.service_definition_to_service(svc)
        self.service_instances[service_id] = service_instances
        self.active_services[service_id] = svc
        return True

    def deactivate_service(self, service_id: str) -> bool:
        """서비스 비활성화"""
        if service_id not in self.active_services:
            return False
        # 서비스 구독 해제 (TODO: EventBus에서 제거)
        if service_id in self.service_instances:
            del self.service_instances[service_id]
        del self.active_services[service_id]
        return True

    def get_service(self, service_id: str) -> Optional[ServiceDef]:
        """서비스 조회"""
        return self.services.get(service_id)

    def list_active(self) -> List[str]:
        """활성화된 서비스 ID 목록"""
        return list(self.active_services.keys())

    def update_service_config(self, service_id: str, config: Dict[str, Any]) -> bool:
        """서비스 설정 업데이트"""
        if service_id not in self.services:
            return False
        svc = self.services[service_id]
        svc.config.values.update(config)
        # 활성화된 서비스이면 재활성화 필요
        if service_id in self.active_services:
            self.deactivate_service(service_id)
            self.activate_service(service_id)
        return True
