"""
M_EventAdapter: 이벤트 변환 어댑터 모듈
- 특정 이벤트를 다른 이벤트 타입으로 변환
- 재활용 가능한 범용 이벤트 변환 시스템
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class EventAdapterModule(Module):
    """범용 이벤트 변환 어댑터 모듈"""

    name = "M_EventAdapter"
    description = "이벤트 타입 변환 어댑터 (재활용 가능)"
    capabilities = ["EVENT_TRANSFORM"]

    def can_handle(self, event: Event) -> float:
        if event.type == "EVENT_TRANSFORM":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "EVENT_TRANSFORM":
            return []
        
        p = event.payload or {}
        source_event = p.get("source_event")
        target_type = p.get("target_type")
        payload_mapping = p.get("payload_mapping", {})  # { "new_key": "source_key" } 또는 { "new_key": "${source_key}" }
        
        if not source_event or not target_type:
            return []

        # 소스 이벤트의 payload를 가져옴
        source_payload = source_event.get("payload", {}) if isinstance(source_event, dict) else {}
        
        # payload 매핑 적용
        new_payload = {}
        if payload_mapping:
            for new_key, source_key in payload_mapping.items():
                if isinstance(source_key, str) and source_key.startswith("${"):
                    # 변수 참조: ${order_id} → source_payload["order_id"]
                    var_name = source_key[2:-1]
                    new_payload[new_key] = source_payload.get(var_name, "")
                else:
                    new_payload[new_key] = source_payload.get(source_key, "")
        else:
            # 매핑이 없으면 전체 복사
            new_payload = source_payload.copy()

        return [
            Event(
                type=target_type,
                payload=new_payload,
                source_module=self.name,
            )
        ]
