"""
M_Nudge_UI: 사용자에게 승인/거절을 묻는 텍스트 UI 생성
E_DraftReady → 원본 옆에 회의록_날짜_메일초안.md 생성 (협상 헤더 + 본문)
"""
import os
from datetime import datetime
from pathlib import Path
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

DRAFT_SUFFIX = "_메일초안.md"

NEGOTIATION_HEADER = """---
Status: 대기중 (Waiting)
To: {to}
Action: [ ] 발송승인 (여기 체크하면 발송됩니다)
---
(아래는 AI가 작성한 메일 내용입니다. 수정하시면 수정된 대로 발송됩니다.)

"""


class NudgeUIModule(Module):
    """메일 초안을 파일로 생성하여 사용자 협상(넛지) 유도"""

    name = "M_Nudge_UI"
    description = "사용자 승인을 위한 초안 파일 생성 모듈"
    capabilities = ["E_DraftReady"]

    def __init__(self, watch_dir: str = ""):
        self.watch_dir = watch_dir  # 원본과 같은 폴더에 생성할 때 기준

    def can_handle(self, event: Event) -> float:
        return 1.0 if event.type == "E_DraftReady" else 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_DraftReady":
            return []
        source_path = event.payload.get("source_path", "")
        draft_body = event.payload.get("draft_body", "")
        to_addr = event.payload.get("to", "team@company.com")
        subject = event.payload.get("subject", "")
        if not source_path or not draft_body:
            return []
        draft_path = self._draft_file_path(source_path)
        content = NEGOTIATION_HEADER.format(to=to_addr).strip() + "\n\n"
        content += f"제목: {subject}\n\n" if subject else ""
        content += draft_body
        try:
            with open(draft_path, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            return []
        # E_UserApproved는 사용자가 파일에 [x] 발송승인 후 저장할 때 FileWatcher가 감지
        return []

    def _draft_file_path(self, source_path: str) -> str:
        p = Path(source_path)
        stem = p.stem
        parent = p.parent
        return str(parent / f"{stem}{DRAFT_SUFFIX}")
