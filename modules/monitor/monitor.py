"""
M_Monitor: 파일 모니터링 및 콘솔 출력 모듈
- 파일 변경 감지 → 콘솔 출력
- 로그 파일 저장 (선택)
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class MonitorLogModule(Module):
    """파일 변경 로그 기록"""

    name = "M_Monitor_Log"
    description = "파일 변경 로그 기록 모듈"
    capabilities = ["E_FileCreated", "FILE_CREATED", "FILE_MODIFIED"]

    def __init__(self, log_dir: str = "./logs"):
        super().__init__()
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def can_handle(self, event: Event) -> float:
        return 1.0 if event.type in ("FILE_CREATED", "FILE_MODIFIED", "E_FileCreated") else 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type not in ("FILE_CREATED", "FILE_MODIFIED", "E_FileCreated"):
            return []
        
        event_type = "created" if event.type in ("FILE_CREATED", "E_FileCreated") else "modified"
        path = event.payload.get("path", "")
        filename = event.payload.get("filename", "")
        content = event.payload.get("content", "")
        log_to_file = event.payload.get("log_to_file", True)
        
        # log_to_file이 false면 스킵
        if isinstance(log_to_file, str):
            log_to_file = log_to_file.lower() in ("true", "1", "yes")
        if not log_to_file:
            return []
        
        # 로그 파일에 기록
        log_file = self.log_dir / f"file-monitor-{datetime.now().strftime('%Y%m%d')}.log"
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        content_str = content if isinstance(content, str) else str(content) if content else ""
        log_entry = f"[{timestamp}] {event_type.upper()}: {filename}\n"
        log_entry += f"  Path: {path}\n"
        log_entry += f"  Size: {len(content_str)} bytes\n"
        log_entry += "\n"
        
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(log_entry)
        except Exception:
            pass
        
        return []


class MonitorConsoleModule(Module):
    """파일 변경 콘솔 출력"""

    name = "M_Monitor_Console"
    description = "파일 변경 콘솔 출력 모듈"
    capabilities = ["E_FileCreated", "FILE_CREATED", "FILE_MODIFIED"]

    def __init__(self, show_content: bool = True):
        super().__init__()
        self.show_content = show_content if isinstance(show_content, bool) else str(show_content).lower() in ("true", "1", "yes")

    def can_handle(self, event: Event) -> float:
        # 파이프라인에서 직접 호출되므로 항상 처리 가능
        return 1.0 if event.type in ("E_DraftReady", "FILE_CREATED", "FILE_MODIFIED", "E_FileCreated") else 0.0

    def process(self, event: Event) -> List[Event]:
        # event payload에서 정보 추출 (step args가 병합됨)
        print(f"EVENT: {event} \n\n")
        path = event.payload.get("path", "")
        filename = event.payload.get("filename", "")
        content = event.payload.get("content", "")
        message = event.payload.get("message", "")
        
        # filename이 없으면 path에서 추출
        if not filename and path:
            filename = os.path.basename(path)
        
        # 콘솔 출력
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        if message:
            print(f"[{timestamp}] {message}")
        else:
            event_type = "생성" if event.type in ("FILE_CREATED", "E_FileCreated") else "수정"
            icon = "📄" if event.type in ("FILE_CREATED", "E_FileCreated") else "✏️"
            print(f"[{timestamp}] {icon} 파일 {event_type}: {filename}")
        
        if path:
            print(f"  경로: {path}")
        if content:
            content_str = content if isinstance(content, str) else str(content)
            print(f"  크기: {len(content_str)} bytes")
            print(f"  내용: {self.show_content}")
            if self.show_content and content_str:
                preview = content_str[:200] + "..." if len(content_str) > 200 else content_str
                print(f"  내용 미리보기:")
                for line in preview.split("\n")[:5]:
                    print(f"    {line}")
        
        print()
        
        return []
