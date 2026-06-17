"""
M_SayuRegister: Sa-Yu 로컬 볼트 파이프라인 예약(플레이스홀더).
현재 CHAT는 기존 doc_chat_llm 이 처리합니다.
"""
from __future__ import annotations

from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class SayuRegisterModule(Module):
    name = "M_SayuRegister"
    description = "Sa-Yu: 로컬 볼트 연동(예약)"
    capabilities: List[str] = []

    def can_handle(self, event: Event) -> float:
        return 0.0

    def process(self, event: Event) -> List[Event]:
        return []
