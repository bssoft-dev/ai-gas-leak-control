"""
서비스 어댑터: service.yaml의 서비스를 실제 Service로 변환
"""
import fnmatch
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core import Service, Pipeline
from ..core.orchestrator import Orchestrator
from .schema import ServiceDef


class ModuleRegistry:
    """모듈 등록"""
    _modules: Dict[str, type] = {}

    @classmethod
    def register(cls, name: str, module_class: type):
        cls._modules[name] = module_class

    @classmethod
    def get(cls, name: str) -> Optional[type]:
        return cls._modules.get(name)


class ServiceAdapter:
    """서비스 정의를 실제 Service로 변환"""

    def __init__(self, orchestrator: Orchestrator):
        self.orchestrator = orchestrator

    def service_definition_to_service(self, service_def: ServiceDef) -> Service:
        """서비스 정의를 실제 Service 객체로 변환"""
        http_client = getattr(self.orchestrator, 'http_client', None)
        service = Service(name=service_def.metadata.name, http_client=http_client)
        for pipeline_def in service_def.pipelines:
            pipeline = Pipeline(name=pipeline_def.name, http_client=http_client)
            service.add_pipeline(pipeline)
        return service

    def matches_filter(self, file_path: str, pattern: str) -> bool:
        """Glob 패턴 매칭"""
        return fnmatch.fnmatch(file_path, pattern)
