"""
M_SupplementIndexManager: 보충파일목록.md 관리
E_SupplementFileCreated → 인덱스 추가
E_SupplementFileDeleted → 인덱스에서 제거
"""
import os
import re
import time
from pathlib import Path
from typing import List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

INDEX_FILENAME = "#보충파일목록.md"
WRITE_RETRY_MAX = 3
WRITE_RETRY_INTERVAL = 1.0


def _read_file_safe(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _write_with_retry(path: str, content: str) -> Tuple[bool, Optional[str]]:
    """PermissionError 시 최대 3회, 1초 간격 재시도"""
    parent = Path(path).parent
    if parent and not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(WRITE_RETRY_MAX):
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return True, None
        except PermissionError as e:
            if attempt < WRITE_RETRY_MAX - 1:
                time.sleep(WRITE_RETRY_INTERVAL)
            else:
                return False, str(e)
        except OSError as e:
            return False, str(e)
    return False, "write failed"


class SupplementIndexManagerModule(Module):
    """보충파일목록.md 관리 모듈"""

    name = "M_SupplementIndexManager"
    description = "보충파일목록.md 생성/갱신/삭제 관리 모듈"
    capabilities = ["E_SupplementFileCreated", "E_SupplementFileDeleted"]

    def can_handle(self, event: Event) -> float:
        if event.type == "E_SupplementFileCreated":
            return 0.9
        if event.type == "E_SupplementFileDeleted":
            return 0.9
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "E_SupplementFileCreated":
            return self._handle_file_created(event)
        if event.type == "E_SupplementFileDeleted":
            return self._handle_file_deleted(event)
        return []

    def _handle_file_created(self, event: Event) -> List[Event]:
        """보충 파일 생성 시 인덱스에 추가"""
        payload = event.payload or {}
        created_files = payload.get("created_files", [])
        supplement_dir = payload.get("supplement_dir", "")
        if not created_files or not supplement_dir:
            return []

        index_path = os.path.join(supplement_dir, INDEX_FILENAME)
        existing = _read_file_safe(index_path)
        new_names = {Path(f["path"]).stem for f in created_files}
        existing_items = []
        if existing and "- [[" in existing:
            for m in re.finditer(r"-\s*\[\[([^\]]+)\]\]\s*(-\s*[^\n]*)?", existing):
                name, rest = m.group(1), (m.group(2) or "").strip()
                if name not in new_names:
                    existing_items.append((name, rest))

        header = "# 보충 파일 목록\n\n## 보충 파일 목록\n"
        body_lines = []
        for name, rest in existing_items:
            body_lines.append(f"- [[{name}]] {rest}\n" if rest else f"- [[{name}]]\n")
        for file_info in created_files:
            name = Path(file_info["path"]).stem
            summary = file_info.get("request_summary", "")
            body_lines.append(f"- [[{name}]] - {summary}\n")
        footer = "\n---\n\n*이 목록은 ThinkingOS 시스템에 의해 자동 관리됩니다.*\n"
        content = header + "".join(body_lines) + footer

        ok, err = _write_with_retry(index_path, content)
        if ok:
            return [
                Event(
                    type="E_SupplementIndexUpdated",
                    payload={
                        **payload,
                        "index_path": index_path,
                        "action": "added",
                    },
                    source_module=self.name,
                )
            ]
        return []

    def _handle_file_deleted(self, event: Event) -> List[Event]:
        """보충 파일 삭제 시 인덱스에서 제거"""
        payload = event.payload or {}
        deleted_path = payload.get("deleted_path", "")
        supplement_dir = payload.get("supplement_dir", "")
        if not deleted_path:
            return []

        if not supplement_dir:
            supplement_dir = str(Path(deleted_path).parent)

        index_path = os.path.join(supplement_dir, INDEX_FILENAME)
        content = _read_file_safe(index_path)
        stem = Path(deleted_path).stem
        new_lines = []
        for line in content.split("\n"):
            if f"[[{stem}]]" in line:
                continue
            new_lines.append(line)

        if new_lines != content.split("\n"):
            ok, err = _write_with_retry(index_path, "\n".join(new_lines))
            if ok:
                return [
                    Event(
                        type="E_SupplementIndexUpdated",
                        payload={
                            **payload,
                            "index_path": index_path,
                            "action": "removed",
                        },
                        source_module=self.name,
                    )
                ]
        return []
