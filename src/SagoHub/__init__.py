"""
SagoHub - Pipeline-Based Foldering Engine
파이프라인 기반 폴더링 시스템

thinkingos의 개념을 SagoHub로 발전시킨 통합 아키텍처
"""
__version__ = "0.4.0"

# Core components
from .core import Event, EventBus, Module, Service, Pipeline, Orchestrator

# Pipeline layer
from .service import ServiceDef, ServiceLoader, ServiceManager

__all__ = [
    # Core
    "Event",
    "EventBus",
    "Module",
    "Service",
    "Pipeline",
    "Orchestrator",
    # Service
    "Service",
    "ServiceDef",
    "ServiceLoader",
    "ServiceManager",
]
