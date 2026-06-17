"""
M_SagoWatcher: 옵시디언 보관소 파일 감시 모듈
- .md 파일의 Created/Modified 이벤트 감지
- 파일 내용 읽어서 EVT_FILE_CHANGE 이벤트 발생
"""
import os
import time
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 기본 설정
SETTLE_TIME = int(os.getenv("SAGO_WATCHER_SETTLE_TIME", "3"))  # 파일 안정화 대기 시간 (초)
POLL_INTERVAL = int(os.getenv("SAGO_WATCHER_POLL_INTERVAL", "5"))  # 폴링 간격 (초)


class SagoWatcherModule(Module):
    """옵시디언 보관소 파일 감시 모듈"""
    
    name = "M_SagoWatcher"
    description = "옵시디언 보관소의 .md 파일 변경 감지 모듈"
    capabilities = ["PATH_SET", "EVT_FILE_CHANGE", "EVT_PDF_FOUND", "{sago하위폴더}_created", "{sago하위폴더}_updated", "{sago하위폴더}_deleted"]
    
    def __init__(self, watch_dir: str = "", settle_seconds: int = SETTLE_TIME):
        super().__init__()
        self.settle_seconds = settle_seconds
        self.poll_interval = POLL_INTERVAL
        self.default_watch_dir = watch_dir
        self._snapshot: Dict[str, Dict[str, float]] = {}  # watch_dir -> {path -> mtime}
        self._pending: Dict[str, Dict[str, Dict[str, Any]]] = {}  # watch_dir -> {path -> {mtime, first_detected}}
        self._sago_snapshot: Dict[str, Dict[str, float]] = {}  # watch_dir -> {path -> mtime} (sago/.sago 내부만)
        self._pending_sago: Dict[str, Dict[str, Dict[str, Any]]] = {}  # settle 대기용
        self._watch_threads: Dict[str, threading.Thread] = {}
        self._watch_stop_flags: Dict[str, threading.Event] = {}
        self._include_pdf: Dict[str, bool] = {}  # watch_dir -> PDF 포함 여부
        
        # 기본 watch_dir이 있으면 자동 시작
        if self.default_watch_dir:
            self._start_watching(self.default_watch_dir)
    
    def can_handle(self, event: Event) -> float:
        """PATH_SET 이벤트 처리 가능 여부 확인"""
        if event.type == "PATH_SET":
            payload = event.payload or {}
            if payload.get("watch_dir") or payload.get("path"):
                return 1.0
        return 0.0
    
    def process(self, event: Event) -> List[Event]:
        """이벤트 처리: PATH_SET 받으면 감시 시작"""
        if event.type == "PATH_SET":
            return self._handle_path_set(event)
        return []
    
    def _handle_path_set(self, event: Event) -> List[Event]:
        """PATH_SET 이벤트 처리: 감시 디렉토리 설정 및 감시 시작"""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or payload.get("path")
        
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir 또는 path가 이벤트에 없습니다")
            return []
        
        watch_dir = os.path.abspath(str(watch_dir))
        self._include_pdf[watch_dir] = payload.get("include_pdf", True)
        self._start_watching(watch_dir)
        return []
    
    def _start_watching(self, watch_dir: str):
        """감시 시작 (내부 메서드)"""
        # 이미 감시 중이면 스킵
        if watch_dir in self._watch_threads and self._watch_threads[watch_dir].is_alive():
            print(f"[{self.name}] 이미 감시 중인 디렉토리: {watch_dir}")
            return
        
        # 디렉토리 확인
        if not os.path.isdir(watch_dir):
            os.makedirs(watch_dir, exist_ok=True)
            print(f"[{self.name}] 감시 디렉토리 생성: {watch_dir}")
        
        # 스냅샷 초기화
        if watch_dir not in self._snapshot:
            self._snapshot[watch_dir] = {}
            self._pending[watch_dir] = {}
            self._sago_snapshot[watch_dir] = {}
            self._pending_sago[watch_dir] = {}
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
                            print(f"[{self.name}] 파일 변경 감지: {ev.payload.get('file_path', 'N/A')}")
                            self.publish(ev)
                        except Exception as e:
                            print(f"[{self.name}] ⚠️  이벤트 발행 실패: {e}")
                except Exception as e:
                    print(f"[{self.name}] ⚠️  감시 중 오류: {e}")
                
                stop_event.wait(timeout=self.poll_interval)
            print(f"[{self.name}] 파일 감시 종료: {watch_dir}")
        
        thread = threading.Thread(target=watch_loop, daemon=True, name=f"SagoWatcher-{watch_dir}")
        self._watch_threads[watch_dir] = thread
        thread.start()
    
    def _init_snapshot(self, watch_dir: str):
        """초기 스냅샷 생성 (전체 스캔 후 폴더별로 분리)"""
        all_files = self._scan_all(watch_dir)
        watch_path = Path(watch_dir).resolve()
        sago_path = watch_path / "sago"
        sago_hidden_path = watch_path / ".sago"
        rest, sago = {}, {}
        for path, mtime in all_files.items():
            path_obj = Path(path).resolve()
            if (sago_path in path_obj.parents or path_obj.parent == sago_path or
                sago_hidden_path in path_obj.parents or path_obj.parent == sago_hidden_path):
                sago[path] = mtime
            else:
                rest[path] = mtime
        self._snapshot[watch_dir] = rest
        self._sago_snapshot[watch_dir] = sago
    
    def _scan_all(self, watch_dir: str) -> Dict[str, float]:
        """watch_dir 전체 스캔 (sago/.sago 포함). .md, .pdf 파일 경로와 mtime 반환"""
        out: Dict[str, float] = {}
        for root, dirs, files in os.walk(watch_dir):
            for f in files:
                if not (f.endswith(".md") or f.lower().endswith(".pdf")):
                    continue
                full = os.path.join(root, f)
                try:
                    out[full] = os.path.getmtime(full)
                except (FileNotFoundError, PermissionError, OSError):
                    pass
        return out
    
    def _is_sago_path(self, path: str, watch_dir: str) -> bool:
        """경로가 sago 또는 .sago 하위인지 여부"""
        watch_path = Path(watch_dir).resolve()
        path_obj = Path(path).resolve()
        sago_path = watch_path / "sago"
        sago_hidden_path = watch_path / ".sago"
        return (
            sago_path in path_obj.parents or path_obj.parent == sago_path or
            sago_hidden_path in path_obj.parents or path_obj.parent == sago_hidden_path
        )

    def _sago_folder_prefix(self, path: str, watch_dir: str) -> str:
        """sago/.sago 내 경로에서 이벤트 접두사(하위폴더명) 반환. 예: founds → founds_created"""
        watch_path = Path(watch_dir).resolve()
        path_obj = Path(path).resolve()
        sago_path = watch_path / "sago"
        sago_hidden_path = watch_path / ".sago"
        if sago_path in path_obj.parents or path_obj.parent == sago_path:
            root = sago_path
        else:
            root = sago_hidden_path
        try:
            rel = path_obj.relative_to(root)
        except ValueError:
            return "sago"
        parts = rel.parts
        if len(parts) > 1:
            return parts[0]  # 하위폴더명 (예: founds)
        return root.name  # sago 또는 .sago (파일이 sago 직하위에 있는 경우)
    
    def _detect_changes(self, watch_dir: str) -> List[Event]:
        """전체 스캔 후 폴더에 따라 분기: 일반 → EVT_FILE_CHANGE, sago/.sago 하위 → {폴더명}_created/_updated/_deleted"""
        now = time.time()
        all_new = self._scan_all(watch_dir)
        # 폴더별로 분리
        new_rest: Dict[str, float] = {}
        new_sago: Dict[str, float] = {}
        for path, mtime in all_new.items():
            if self._is_sago_path(path, watch_dir):
                new_sago[path] = mtime
            else:
                new_rest[path] = mtime

        snapshot = self._snapshot.get(watch_dir, {})
        pending = self._pending.get(watch_dir, {})
        sago_snap = self._sago_snapshot.get(watch_dir, {})
        pending_sago = self._pending_sago.get(watch_dir, {})
        events: List[Event] = []

        # ----- 일반 폴더: EVT_FILE_CHANGE -----
        for path, mtime in new_rest.items():
            if path not in snapshot or snapshot[path] != mtime:
                pending[path] = {"mtime": mtime, "first_detected": now}
        to_process_rest = []
        for path, info in list(pending.items()):
            if now - info["first_detected"] >= self.settle_seconds:
                if path in new_rest and new_rest[path] == info["mtime"]:
                    to_process_rest.append(path)
                del pending[path]
        for path in to_process_rest:
            p = Path(path)
            rel_path = os.path.relpath(path, watch_dir)
            if p.suffix.lower() == ".pdf":
                # PDF: include_pdf일 때만 EVT_PDF_FOUND (pdf_reader가 API로 분석)
                if not self._include_pdf.get(watch_dir, True):
                    snapshot[path] = new_rest[path]
                    continue
                events.append(
                    Event(
                        type="EVT_PDF_FOUND",
                        payload={
                            "file_path": path,
                            "relative_path": rel_path,
                            "filename": p.name,
                            "stem": p.stem,
                            "modified": datetime.fromtimestamp(new_rest[path]).isoformat(),
                            "watch_dir": watch_dir,
                        },
                        source_module=self.name,
                    )
                )
                snapshot[path] = new_rest[path]
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                if len(content.strip()) == 0:
                    print(f"[{self.name}] ⚠️  빈 파일 감지: {path}")
                    continue
                events.append(
                    Event(
                        type="EVT_FILE_CHANGE",
                        payload={
                            "file_path": path,
                            "relative_path": rel_path,
                            "content": content,
                            "filename": p.name,
                            "stem": p.stem,
                            "modified": datetime.fromtimestamp(new_rest[path]).isoformat(),
                            "watch_dir": watch_dir,
                        },
                        source_module=self.name,
                    )
                )
                snapshot[path] = new_rest[path]
            except Exception as e:
                print(f"[{self.name}] ⚠️  파일 읽기 실패: {path}, 오류: {e}")

        # ----- sago/.sago 하위폴더별: {폴더}_created / _updated / _deleted -----
        for path in list(sago_snap.keys()):
            if path not in new_sago:
                prefix = self._sago_folder_prefix(path, watch_dir)
                p = Path(path)
                rel_path = os.path.relpath(path, watch_dir)
                events.append(
                    Event(
                        type=f"{prefix}_deleted",
                        payload={
                            "file_path": path,
                            "relative_path": rel_path,
                            "filename": p.name,
                            "stem": p.stem,
                            "watch_dir": watch_dir,
                            "sago_folder": prefix,
                        },
                        source_module=self.name,
                    )
                )
        for path, mtime in new_sago.items():
            if path not in sago_snap or sago_snap[path] != mtime:
                pending_sago[path] = {
                    "mtime": mtime,
                    "first_detected": now,
                    "is_new": path not in sago_snap,
                }
        to_process_sago: List[tuple] = []
        for path, info in list(pending_sago.items()):
            if now - info["first_detected"] >= self.settle_seconds:
                if path in new_sago and new_sago[path] == info["mtime"]:
                    to_process_sago.append((path, info.get("is_new", False)))
                del pending_sago[path]
        for path, is_new in to_process_sago:
            p = Path(path)
            prefix = self._sago_folder_prefix(path, watch_dir)
            rel_path = os.path.relpath(path, watch_dir)
            if p.suffix.lower() == ".pdf":
                # sago 내 PDF: include_pdf일 때만 EVT_PDF_FOUND (pdf_reader가 API로 분석)
                if not self._include_pdf.get(watch_dir, True):
                    continue
                events.append(
                    Event(
                        type="EVT_PDF_FOUND",
                        payload={
                            "file_path": path,
                            "relative_path": rel_path,
                            "filename": p.name,
                            "stem": p.stem,
                            "modified": datetime.fromtimestamp(new_sago[path]).isoformat(),
                            "watch_dir": watch_dir,
                            "sago_folder": prefix,
                        },
                        source_module=self.name,
                    )
                )
                continue
            event_type = f"{prefix}_created" if is_new else f"{prefix}_updated"
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                print(f"[{self.name}] ⚠️  sago 파일 읽기 실패: {path}, 오류: {e}")
                continue
            events.append(
                Event(
                    type=event_type,
                    payload={
                        "file_path": path,
                        "relative_path": rel_path,
                        "content": content,
                        "filename": p.name,
                        "stem": p.stem,
                        "modified": datetime.fromtimestamp(new_sago[path]).isoformat(),
                        "watch_dir": watch_dir,
                        "sago_folder": prefix,
                    },
                    source_module=self.name,
                )
            )

        self._snapshot[watch_dir] = new_rest
        self._pending[watch_dir] = pending
        self._sago_snapshot[watch_dir] = new_sago
        self._pending_sago[watch_dir] = pending_sago
        return events
