"""
M_EventTransformer: 이벤트 타입 변환 모듈
- 특정 이벤트를 받아 다른 타입의 이벤트로 변환하여 발행
- 재활용 가능한 범용 이벤트 변환 시스템
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class EventTransformerModule(Module):
    """범용 이벤트 변환 모듈 (특정 이벤트를 다른 타입으로 변환)"""

    name = "M_EventTransformer"
    description = "이벤트 타입 변환 모듈 (재활용 가능)"
    capabilities = []  # 동적으로 설정 가능

    def __init__(self, source_event: str = "", target_event: str = "", payload_map: Dict[str, str] = None):
        super().__init__()
        self.source_event = source_event
        self.target_event = target_event
        self.payload_map = payload_map or {}  # { "new_key": "source_key" } 또는 { "new_key": "${source_key}" }
        if source_event:
            self.capabilities = [source_event]

    def can_handle(self, event: Event) -> float:
        if self.source_event and event.type == self.source_event:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if not self.source_event or event.type != self.source_event:
            return []
        if not self.target_event:
            return []

        p = event.payload or {}
        
        # payload 매핑 적용
        new_payload = {}
        if self.payload_map:
            for new_key, source_key in self.payload_map.items():
                if isinstance(source_key, str) and source_key.startswith("${"):
                    # 변수 참조: ${order_id} → p["order_id"]
                    var_name = source_key[2:-1]
                    new_payload[new_key] = p.get(var_name, "")
                elif source_key == "*":
                    # 전체 복사
                    new_payload[new_key] = p
                else:
                    new_payload[new_key] = p.get(source_key, "")
        else:
            # 매핑이 없으면 전체 복사
            new_payload = p.copy()

        return [
            Event(
                type=self.target_event,
                payload=new_payload,
                source_module=self.name,
            )
        ]
