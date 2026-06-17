"""
M_FileWatcher: 특정 폴더 감시
- 새/수정된 파일 감지 → E_FileCreated
- 메일초안.md 파일에서 [x] 발송승인 감지 → E_UserApproved
"""
import os
import re
import time
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 기본 설정 (환경변수로 오버라이드 가능)
SETTLE_TIME = int(os.getenv("FILE_WATCHER_SETTLE_TIME", "5"))
DRAFT_SUFFIX = "_메일초안.md"
APPROVAL_PATTERN = re.compile(r"\[x\]\s*발송승인", re.IGNORECASE)


class FileWatcherModule(Module):
    """특정 폴더 감시 → E_FileCreated / E_UserApproved"""
    name = "M_FileWatcher"
    description = "파일 시스템 변경 감지 모듈"
    capabilities = ["SET_PATH", "E_FileCreated", "E_FileDeleted", "E_UserApproved"]

    def __init__(self, watch_dir: str = "", settle_seconds: int = SETTLE_TIME, outbox_suffix: str = "", event_bus_url: str = ""):
        super().__init__()
        self.settle_seconds = settle_seconds
        self.outbox_suffix = outbox_suffix or ""  # e.g. "Outbox" for Documents/Outbox
        self._snapshot: Dict[str, Dict[str, float]] = {}  # watch_dir -> {path -> mtime}
        self._pending: Dict[str, Dict[str, Dict[str, Any]]] = {}  # watch_dir -> {path -> { mtime, first_detected }}
        self._watch_threads: Dict[str, threading.Thread] = {}  # watch_dir -> thread
        self._watch_stop_flags: Dict[str, threading.Event] = {}  # watch_dir -> stop_event
        self.poll_interval = int(os.getenv("POLL_INTERVAL", "5"))
        
    def handle_event(self, event: Event) -> List[Event]:
        """
        이벤트를 받아서 watch_dir을 추출하고 모니터링 시작
        payload에 watch_dir 또는 path가 있어야 함
        """
        payload = event.payload or {}
        if(event.type == "PATH_SET"):
            print(f"[{self.name}] SET PATH: {payload}")
            watch_dir = payload.get("watch_dir") or payload.get("path")
        
            if not watch_dir:
                print(f"[{self.name}] ⚠️  watch_dir 또는 path가 이벤트에 없습니다: {event.payload}")
                return []
            
            watch_dir = os.path.abspath(str(watch_dir))
            
            # 이미 감시 중이면 스킵
            if watch_dir in self._watch_threads and self._watch_threads[watch_dir].is_alive():
                print(f"[{self.name}] 이미 감시 중인 디렉토리: {watch_dir}")
                return []
            
            # 디렉토리 초기화
            if not os.path.isdir(watch_dir):
                os.makedirs(watch_dir, exist_ok=True)
                print(f"[{self.name}] 감시 디렉토리 생성: {watch_dir}")
            
            # 스냅샷 초기화
            if watch_dir not in self._snapshot:
                self._snapshot[watch_dir] = {}
                self._pending[watch_dir] = {}
                self._init_snapshot(watch_dir)
            
            # 감시 스레드 시작
            stop_event = threading.Event()
            self._watch_stop_flags[watch_dir] = stop_event
            
            def watch_loop():
                print(f"[{self.name}] 파일 감시 시작: {watch_dir} (폴링 간격 {self.poll_interval}초)")
                while not stop_event.is_set():
                    try:
                        events = self._detect_changes(watch_dir)
                        # 생성된 이벤트 발행
                        for ev in events:
                            try:
                                print(f"[{self.name}] 파일 감시 중(publish): {ev}")
                                self.publish(ev)
                            except Exception as e:
                                print(f"[{self.name}] ⚠️  이벤트 발행 실패: {e}")
                    except Exception as e:
                        print(f"[{self.name}] ⚠️  감시 중 오류: {e}")
                    
                    stop_event.wait(timeout=self.poll_interval)
                print(f"[{self.name}] 파일 감시 종료: {watch_dir}")
            
            thread = threading.Thread(target=watch_loop, daemon=True, name=f"FileWatcher-{watch_dir}")
            self._watch_threads[watch_dir] = thread
            thread.start()
            return [Event(type="SET_PATH", payload={"watch_dir": watch_dir}, source_module=self.name)]
        
        return []

    def _init_snapshot(self, watch_dir: str):
        self._snapshot[watch_dir] = self._scan(watch_dir)

    def _scan(self, watch_dir: str) -> Dict[str, float]:
        out = {}
        for root, dirs, files in os.walk(watch_dir):
            dirs[:] = [d for d in dirs if d != "@eaDir" and not d.startswith(".")]
            for f in files:
                if f.startswith("#"):
                    continue
                full = os.path.join(root, f)
                try:
                    out[full] = os.path.getmtime(full)
                except (FileNotFoundError, PermissionError, OSError):
                    pass
        return out

    def can_handle(self, event: Event) -> float:
        # 모든 이벤트를 받아서 watch_dir 추출
        payload = event.payload or {}
        if payload.get("watch_dir") or payload.get("path"):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        return self.handle_event(event)

    def _detect_changes(self, watch_dir: str) -> List[Event]:
        now = time.time()
        new_snapshot = self._scan(watch_dir)
        snapshot = self._snapshot.get(watch_dir, {})
        pending = self._pending.get(watch_dir, {})
        events: List[Event] = []
        
        # 새로 생성/수정된 파일
        for path, mtime in new_snapshot.items():
            if path not in snapshot or snapshot[path] != mtime:
                pending[path] = {"mtime": mtime, "first_detected": now}
                print(f"FILE_WATCHER _detect_changes: {path} {mtime}")

        # settle 시간 지난 것만 처리
        to_process = []
        for path, info in list(pending.items()):
            if now - info["first_detected"] >= self.settle_seconds:
                if path in new_snapshot and new_snapshot[path] == info["mtime"]:
                    to_process.append(path)
                del pending[path]

        for path in to_process:
            rel = os.path.relpath(path, watch_dir)
            # 메일 초안 파일이고 [x] 발송승인 체크되어 있으면 E_UserApproved
            if path.endswith(DRAFT_SUFFIX) or "메일초안" in path:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        content = f.read()
                    if APPROVAL_PATTERN.search(content):
                        events.append(
                            Event(
                                type="E_UserApproved",
                                payload={
                                    "path": path,
                                    "content": content,
                                    "to": self._parse_to_from_header(content),
                                    "subject": self._parse_subject(content),
                                },
                                source_module=self.name,
                            )
                        )
                        snapshot[path] = new_snapshot.get(path, 0)
                        continue
                except Exception:
                    pass
            # 일반 새 파일 (회의록 등) → E_FileCreated
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception:
                content = ""
            p = Path(path)
            events.append(
                Event(
                    type="E_FileCreated",
                    payload={
                        "path": path,
                        "content": content,
                        "size": os.path.getsize(path) if os.path.exists(path) else 0,
                        "modified": datetime.fromtimestamp(new_snapshot.get(path, 0)).isoformat(),
                        "filename": p.name,
                        "dirname": str(p.parent),
                        "dir": str(p.parent),  # alias
                        "stem": p.stem,
                        "suffix": p.suffix,
                    },
                    source_module=self.name,
                )
            )
            snapshot[path] = new_snapshot.get(path, 0)

        self._snapshot[watch_dir] = new_snapshot
        self._pending[watch_dir] = pending

        # 삭제된 파일 처리
        for path in snapshot.keys():
            if path not in new_snapshot:
                print(f"FILE_WATCHER _detect_changes: {path} deleted")
                events.append(
                    Event(
                        type="E_FileDeleted",
                        payload={"path": path},
                        source_module=self.name,
                    )
                )
        return events

    def _parse_to_from_header(self, content: str) -> str:
        for line in content.split("\n"):
            if line.strip().lower().startswith("to:"):
                return line.split(":", 1)[1].strip()
        return ""

    def _parse_subject(self, content: str) -> str:
        for line in content.split("\n"):
            if line.strip().lower().startswith("subject:") or "제목:" in line:
                return line.split(":", 1)[1].strip() if ":" in line else ""
        return ""
