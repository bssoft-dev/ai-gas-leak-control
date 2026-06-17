"""
M_QuestionExtractor: 보충 파일에서 질문 추출
E_SupplementFileDetected → [ask] 질문 추출 → E_QuestionDetected
"""
import re
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

QUESTION_PATTERN = re.compile(r"(?:^>\s*!\[ask\]|^\[ask\])\s*(.+)$", re.MULTILINE | re.IGNORECASE)


class QuestionExtractorModule(Module):
    """보충 파일에서 질문 추출 모듈"""

    name = "M_QuestionExtractor"
    description = "보충 파일에서 질문을 추출하는 모듈"
    capabilities = ["E_SupplementFileDetected"]

    def can_handle(self, event: Event) -> float:
        if event.type != "E_SupplementFileDetected":
            return 0.0
        payload = event.payload or {}
        content = payload.get("content", "")
        if not content:
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_SupplementFileDetected":
            return []
        payload = event.payload or {}
        content = payload.get("content", "")
        if not content:
            return []

        questions = QUESTION_PATTERN.findall(content)
        if not questions:
            return []

        events = []
        for q in questions:
            q = q.strip()
            if q:
                events.append(
                    Event(
                        type="E_QuestionDetected",
                        payload={
                            **payload,
                            "question": q,
                        },
                        source_module=self.name,
                    )
                )
        return events
