"""
M_EventRelay: 이벤트 릴레이 모듈 (이벤트 타입 변환)
- 특정 이벤트를 받아 다른 타입의 이벤트로 변환하여 발행
- 재활용 가능한 범용 이벤트 변환 시스템
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class EventRelayModule(Module):
    """범용 이벤트 릴레이 모듈 (이벤트 타입 변환)"""

    name = "M_EventRelay"
    description = "이벤트 타입 변환 릴레이 모듈 (재활용 가능)"
    capabilities = []  # 동적으로 설정

    def __init__(self, source_type: str = "", target_type: str = ""):
        super().__init__()
        self.source_type = source_type
        self.target_type = target_type
        if source_type:
            self.capabilities = [source_type]

    def can_handle(self, event: Event) -> float:
        if self.source_type and event.type == self.source_type:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if not self.source_type or event.type != self.source_type:
            return []
        if not self.target_type:
            return []

        # payload 전체 복사
        return [
            Event(
                type=self.target_type,
                payload=event.payload.copy() if event.payload else {},
                source_module=self.name,
            )
        ]
