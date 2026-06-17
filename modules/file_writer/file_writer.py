"""
M_FileWriter: FILE_WRITE 이벤트로 파일 쓰기
payload: path, context(쓸 내용), method(쓰기 방식)
method: 파일 없을 때 생성 여부 + 있을 때 덮어쓰기/아래붙이기/오류 반환
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


# method 값: (파일 없을 때 생성 여부, 있을 때 동작)
# 동작: overwrite | append | error
METHODS = {
    "overwrite": (True, "overwrite"),   # 없으면 생성, 있으면 덮어쓰기
    "w": (True, "overwrite"),
    "append": (True, "append"),         # 없으면 생성, 있으면 아래붙이기
    "a": (True, "append"),
    "fail_if_exists": (True, "error"),  # 없으면 생성, 있으면 오류
    "x": (True, "error"),
    "overwrite_only": (False, "overwrite"),  # 없으면 오류, 있으면 덮어쓰기
    "append_only": (False, "append"),        # 없으면 오류, 있으면 아래붙이기
}


class FileWriterModule(Module):
    """
    FILE_WRITE 이벤트 처리: path에 context를 method 방식으로 기록.
    payload: path (str), context (str, 쓸 내용), method (str, 선택, 기본 overwrite)
    """

    name = "M_FileWriter"
    description = "FILE_WRITE 이벤트로 파일 쓰기 (덮어쓰기/추가/오류 반환)"
    capabilities = ["FILE_WRITE"]

    def __init__(self, base_dir: str = ""):
        super().__init__()
        self.base_dir = (base_dir or os.getcwd()).rstrip("/")

    def can_handle(self, event: Event) -> float:
        if event.type != "FILE_WRITE":
            return 0.0
        payload = event.payload or {}
        if not payload.get("path"):
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "FILE_WRITE":
            return []
        payload = event.payload or {}
        path = payload.get("path", "").strip()
        context = payload.get("context", "")
        method_key = (payload.get("method") or "overwrite").strip().lower()

        if not path:
            return [self._result_event(event, path, False, "path is required")]

        create_if_missing, when_exists = self._parse_method(method_key)
        if when_exists is None:
            return [
                self._result_event(
                    event, path, False,
                    f"unknown method: {method_key}. use overwrite|append|fail_if_exists|overwrite_only|append_only (or w|a|x)",
                )
            ]

        # path가 절대 경로가 아니면 base_dir 기준
        if not os.path.isabs(path):
            path = os.path.join(self.base_dir, path)
        path = os.path.normpath(path)

        success, error = self._write(path, context, create_if_missing, when_exists)
        return [self._result_event(event, path, success, error)]

    def _parse_method(self, key: str):
        """(create_if_missing: bool, when_exists: 'overwrite'|'append'|'error'|None)"""
        if key in METHODS:
            return METHODS[key]
        return None

    def _write(
        self,
        path: str,
        content: str,
        create_if_missing: bool,
        when_exists: str,
    ) -> tuple[bool, str | None]:
        """파일 쓰기. (success, error_message) 반환."""
        exists = os.path.isfile(path)
        if not exists and not create_if_missing:
            return False, "file does not exist (method does not create)"
        if exists and when_exists == "error":
            return False, "file already exists (method forbids overwrite/append)"

        try:
            parent = Path(path).parent
            if parent and not parent.exists():
                parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return False, str(e)

        mode = "w" if when_exists == "overwrite" else "a"
        if not exists:
            mode = "w" if when_exists == "overwrite" else "a"

        try:
            with open(path, mode, encoding="utf-8") as f:
                f.write(content if isinstance(content, str) else str(content))
            return True, None
        except OSError as e:
            return False, str(e)

    def _result_event(
        self,
        request: Event,
        path: str,
        success: bool,
        error: str | None,
    ) -> Event:
        return Event(
            type="FILE_WRITE_RESULT",
            payload={
                "success": success,
                "path": path,
                "error": error,
                "request_event_id": request.event_id,
            },
            source_module=self.name,
        )
