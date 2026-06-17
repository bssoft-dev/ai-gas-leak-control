"""
M_TraceabilityPdfIngest: PDF 업로드를 파일로 저장하고 EVT_PDF_FOUND를 발행

UI에서 TRACEABILITY_PDF_UPLOAD 이벤트를 받으면:
- PDF base64를 data/traceability/pdf_uploads 아래에 저장
- job_id(stem)를 파일명에 부여하여 pdf_reader -> EVT_PDF_ANALYZED에서 stem으로 추적 가능하게 함
- 이벤트를 EVT_PDF_FOUND로 변환해 공용 pdf_reader 파이프라인을 재사용
"""

from __future__ import annotations

import base64
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module


def _traceability_data_dir() -> Path:
    base = os.getenv("TRACEABILITY_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "traceability"


def _pdf_uploads_dir() -> Path:
    d = _traceability_data_dir() / "pdf_uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


class TraceabilityPdfIngestModule(Module):
    name = "M_TraceabilityPdfIngest"
    description = "TRACEABILITY_PDF_UPLOAD -> PDF 저장 + EVT_PDF_FOUND 발행"
    capabilities = ["TRACEABILITY_PDF_UPLOAD", "TRACEABILITY_PDF_INGESTED"]

    def can_handle(self, event: Event) -> float:
        return 1.0 if event.type == "TRACEABILITY_PDF_UPLOAD" else 0.0

    def process(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        file_base64 = payload.get("file_base64")
        filename = (payload.get("filename") or "drawing.pdf").strip()
        original_stem = (payload.get("stem") or "").strip()
        job_id = (payload.get("job_id") or original_stem or "").strip() or str(uuid.uuid4())

        if not file_base64 or not isinstance(file_base64, str):
            return [
                Event(
                    type="TRACEABILITY_PDF_INGESTED",
                    payload={"success": False, "job_id": job_id, "error": "file_base64가 없습니다."},
                    source_module=self.name,
                )
            ]

        try:
            raw = base64.b64decode(file_base64)
        except Exception as e:
            return [
                Event(
                    type="TRACEABILITY_PDF_INGESTED",
                    payload={"success": False, "job_id": job_id, "error": f"base64 디코딩 실패: {e}"},
                    source_module=self.name,
                )
            ]

        uploads = _pdf_uploads_dir()
        # pdf_reader의 stem을 job_id로 강제(후속 모듈에서 job_id 추적)
        safe_filename = f"{job_id}.pdf"
        dst_path = uploads / safe_filename
        dst_path.write_bytes(raw)

        now = datetime.utcnow().isoformat() + "Z"
        rel_path = f"pdf_uploads/{safe_filename}"

        # UI 응답(진행 상황용)
        out_events: List[Event] = [
            Event(
                type="TRACEABILITY_PDF_INGESTED",
                payload={"success": True, "job_id": job_id, "filename": filename, "stored_path": rel_path, "at": now},
                source_module=self.name,
            )
        ]

        # 공용 pdf_reader로 넘김
        out_events.append(
            Event(
                type="EVT_PDF_FOUND",
                payload={
                    "file_path": str(dst_path),
                    "relative_path": rel_path,
                    "filename": filename,
                    "stem": job_id,
                    "watch_dir": payload.get("watch_dir", ""),
                },
                source_module=self.name,
            )
        )

        return out_events

