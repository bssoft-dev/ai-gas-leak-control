"""
오케스트레이션: 파이프라인을 수정·관리하는 메타 시스템
- 파이프라인 로드/등록
- SagoHub에 파이프라인 연결
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .event import Event, EventBus
from .module import Module
from .service import Service, Pipeline
from .http_client import EventBusHTTPClient

if TYPE_CHECKING:
    pass


class ServiceSpec:
    """서비스 명세 (JSON에서 로드)"""
    name: str
    pipelines: List[PipelineSpec]

class PipelineSpec:
    """파이프라인 명세"""
    name: str
    trigger_event: str
    steps: List[Dict[str, str]]
    subscribe_to: Optional[List[str]] = None

class Orchestrator:
    """서비스 동적 관리"""
    #event_bus_url : SagoHub URL
    def __init__(self, event_bus_url: Optional[str] = None, http_client: Optional[EventBusHTTPClient] = None, event_bus: Optional[EventBus] = None):
        self.event_bus = event_bus or EventBus()
        self.event_bus_url = event_bus_url
        self.http_client = http_client or (EventBusHTTPClient(event_bus_url) if event_bus_url else None)
        self.services: Dict[str, Service] = {}

    def publish(self, event: Event):
        """이벤트 발행 (HTTP 또는 직접 버스로 전달)"""
        if self.http_client:
            # HTTP를 통해 발행
            try:
                new_events = self.http_client.publish(event)
                # 새로 생성된 이벤트도 재귀적으로 발행
                for new_event in new_events:
                    self.publish(new_event)
            except Exception as e:
                print(f"❌ HTTP 이벤트 발행 실패: {e}")
                # 폴백: 직접 SagoHub에 발행
                self.event_bus.publish(event)
        else:
            # 직접 SagoHub에 발행
            print(f"[Orchestrator] PUBLISH: {event}")
            self.event_bus.publish(event)

    def run_once_file_watcher(self, watch_dir: str):
        """FileWatcher 모듈이 한 번 스캔하도록 이벤트 발생 (폴링 연동용)"""
        fw = self.load_module("M_FileWatcher", watch_dir=watch_dir)
        events = fw.process(Event(type="SYSTEM_POLL", payload={"watch_dir": watch_dir}, source_module="Orchestrator"))
        for e in events or []:
            self.publish(e)
