"""
M_SagoScanner: 초기 폴더 스캔 모듈
- PATH_SET 이벤트를 받아서 해당 폴더의 모든 파일을 스캔
- 각 파일에 대해 EVT_FILE_SCANNED 이벤트 발생
"""
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class SagoScannerModule(Module):
    """초기 폴더 스캔 모듈"""
    
    name = "M_SagoScanner"
    description = "초기 폴더 스캔 모듈"
    capabilities = ["PATH_SET", "EVT_FILE_SCANNED", "EVT_PDF_FOUND"]
    
    def __init__(self):
        super().__init__()
    
    def can_handle(self, event: Event) -> float:
        """PATH_SET 이벤트 처리 가능 여부"""
        if event.type == "PATH_SET":
            return 1.0
        return 0.0
    
    def process(self, event: Event) -> List[Event]:
        """이벤트 처리: 폴더 스캔"""
        if event.type != "PATH_SET":
            return []
        
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or payload.get("path")
        
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir 또는 path가 이벤트에 없습니다")
            return []
        
        watch_dir = os.path.abspath(str(watch_dir))
        include_pdf = payload.get("include_pdf", True)
        
        if not os.path.isdir(watch_dir):
            print(f"[{self.name}] ⚠️  디렉토리가 존재하지 않습니다: {watch_dir}")
            return []
        
        # 폴더 내 모든 .md 파일 스캔 (.pdf는 include_pdf일 때만)
        events = []
        watch_path = Path(watch_dir).resolve()
        sago_path = watch_path / "sago"
        sago_hidden_path = watch_path / ".sago"
        
        try:
            for root, dirs, files in os.walk(watch_dir):
                root_path = Path(root).resolve()
                
                # sago 폴더와 .sago 폴더, 그 하위 폴더는 제외
                if (root_path == sago_path or sago_path in root_path.parents or
                    root_path == sago_hidden_path or sago_hidden_path in root_path.parents):
                    dirs[:] = []
                    continue
                
                # 숨김 디렉토리 제외 (.data 등)
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                
                # sago 폴더 제외
                if "sago" in dirs:
                    dirs.remove("sago")
                
                for file in files:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, watch_dir)
                    p = Path(file_path)

                    if file.endswith(".md"):
                        # .md 파일: 내용 읽어서 EVT_FILE_SCANNED
                        try:
                            with open(file_path, "r", encoding="utf-8") as f:
                                content = f.read()
                        except Exception as e:
                            print(f"[{self.name}] ⚠️  파일 읽기 실패: {file_path}, 오류: {e}")
                            continue
                        events.append(
                            Event(
                                type="EVT_FILE_SCANNED",
                                payload={
                                    "file_path": file_path,
                                    "relative_path": rel_path,
                                    "content": content,
                                    "filename": p.name,
                                    "stem": p.stem,
                                    "watch_dir": watch_dir,
                                },
                                source_module=self.name,
                            )
                        )
                    elif include_pdf and file.lower().endswith(".pdf"):
                        # .pdf 파일: EVT_PDF_FOUND (pdf_reader가 API로 분석, include_pdf일 때만)
                        events.append(
                            Event(
                                type="EVT_PDF_FOUND",
                                payload={
                                    "file_path": file_path,
                                    "relative_path": rel_path,
                                    "filename": p.name,
                                    "stem": p.stem,
                                    "watch_dir": watch_dir,
                                },
                                source_module=self.name,
                            )
                        )
            
            print(f"[{self.name}] 스캔 완료: {len(events)}개 파일 발견")
        except Exception as e:
            print(f"[{self.name}] ⚠️  스캔 중 오류 발생: {e}")
            return []
        
        return events
