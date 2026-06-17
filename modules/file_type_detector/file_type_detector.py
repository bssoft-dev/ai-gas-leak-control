"""
M_FileTypeDetector: 파일 타입 감지 (원본/보충 파일 구분)
E_FileCreated → 원본/보충 파일 구분 → E_OriginalFileDetected / E_SupplementFileDetected
"""
import os
import re
from pathlib import Path
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

INDEX_FILENAME = "보충파일목록.md"
SUPPLEMENT_PATTERN = re.compile(r"^(.+)-보충-(\d+)-([a-f0-9]{8})\.md$")


class FileTypeDetectorModule(Module):
    """파일 타입 감지: 원본 .md 파일과 보충 파일 구분"""

    name = "M_FileTypeDetector"
    description = "파일 타입 감지 모듈 (원본/보충 파일 구분)"
    capabilities = ["E_FileCreated"]

    def __init__(self, target_folder: str = "", exclude_patterns: List[str] = None):
        super().__init__()
        self.target_folder = (target_folder or os.path.expanduser("~/obsidian")).rstrip("/")
        self.exclude_patterns = exclude_patterns or ["#*", INDEX_FILENAME]

    def can_handle(self, event: Event) -> float:
        if event.type != "E_FileCreated":
            return 0.0
        payload = event.payload or {}
        path = payload.get("path", "")
        if not path or not path.endswith(".md"):
            return 0.0
        # target_folder 체크
        target_folder = payload.get("target_folder") or self.target_folder
        target_abs = os.path.abspath(os.path.expanduser(str(target_folder)))
        path_abs = os.path.abspath(path)
        if not path_abs.startswith(target_abs):
            return 0.0
        # 제외 파일 체크
        filename = os.path.basename(path)
        if filename.startswith("#") or filename == INDEX_FILENAME:
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_FileCreated":
            return []
        payload = event.payload or {}
        path = payload.get("path", "")
        content = payload.get("content", "")
        if not path or not path.endswith(".md"):
            return []

        target_folder = payload.get("target_folder") or self.target_folder
        target_abs = os.path.abspath(os.path.expanduser(str(target_folder)))
        path_abs = os.path.abspath(path)
        if not path_abs.startswith(target_abs):
            return []

        filename = os.path.basename(path)
        if filename.startswith("#") or filename == INDEX_FILENAME:
            return []

        # 보충 파일 패턴 매칭
        match = SUPPLEMENT_PATTERN.match(filename)
        if match:
            # 보충 파일 감지
            base_name = match.group(1)
            index_part = match.group(2)
            hash_part = match.group(3)
            return [
                Event(
                    type="E_SupplementFileDetected",
                    payload={
                        **payload,
                        "file_type": "supplement",
                        "base_name": base_name,
                        "index": int(index_part),
                        "hash": hash_part,
                        "supplement_path": path_abs,
                    },
                    source_module=self.name,
                )
            ]
        else:
            # 원본 파일 감지
            return [
                Event(
                    type="E_OriginalFileDetected",
                    payload={
                        **payload,
                        "file_type": "original",
                        "original_path": path_abs,
                    },
                    source_module=self.name,
                )
            ]
