"""
M_SupplementActionDetector: 보충 파일에서 반영/삭제 액션 감지
E_SupplementFileDetected → 반영/삭제 체크 → E_SupplementApplyRequest / E_SupplementDeleteRequest
"""
import os
import re
from pathlib import Path
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

CHECK_APPLY = re.compile(r"^-\s*\[x\]\s*\*\*반영\*\*", re.MULTILINE | re.IGNORECASE)
CHECK_DELETE = re.compile(r"^-\s*\[x\]\s*\*\*삭제\*\*", re.MULTILINE | re.IGNORECASE)


class SupplementActionDetectorModule(Module):
    """보충 파일에서 반영/삭제 액션 감지 모듈"""

    name = "M_SupplementActionDetector"
    description = "보충 파일에서 반영/삭제 액션을 감지하는 모듈"
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
        supplement_path = payload.get("supplement_path", "")
        if not content or not supplement_path:
            return []

        events = []
        # 반영 체크
        if CHECK_APPLY.search(content):
            # 원본 파일 경로 찾기
            original_path = self._find_original_path(supplement_path, payload)
            if original_path:
                events.append(
                    Event(
                        type="E_SupplementApplyRequest",
                        payload={
                            **payload,
                            "supplement_path": supplement_path,
                            "original_path": original_path,
                        },
                        source_module=self.name,
                    )
                )
        # 삭제 체크
        if CHECK_DELETE.search(content):
            events.append(
                Event(
                    type="E_SupplementDeleteRequest",
                    payload={
                        **payload,
                        "supplement_path": supplement_path,
                        "supplement_dir": str(Path(supplement_path).parent),
                    },
                    source_module=self.name,
                )
            )
        return events

    def _find_original_path(self, supplement_path: str, payload: dict) -> str:
        """원본 파일 경로 찾기"""
        base_name = payload.get("base_name", "")
        dir_abs = str(Path(supplement_path).parent)
        parent_dir = Path(supplement_path).parent.parent
        original_stem = Path(dir_abs).name
        original_path = os.path.join(parent_dir, f"{original_stem}.md")
        if os.path.isfile(original_path):
            return original_path
        if base_name:
            original_path = os.path.join(dir_abs, f"{base_name}.md")
            if os.path.isfile(original_path):
                return original_path
            original_path = os.path.join(parent_dir, f"{base_name}.md")
            if os.path.isfile(original_path):
                return original_path
        return ""
