"""
M_PdfReader: PDF 분석 모듈
- EVT_PDF_FOUND 이벤트 수신 시 PDF Analysis API(/analyze) 호출
- 분석 결과를 EVT_PDF_ANALYZED 이벤트로 발행
"""
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# PDF Analysis API 기본 URL (환경변수로 오버라이드)
PDF_ANALYSIS_API_URL = os.getenv("PDF_ANALYSIS_API_URL", "http://localhost:8000")
DEFAULT_TIMEOUT = int(os.getenv("PDF_READER_TIMEOUT", "120"))


class PdfReaderModule(Module):
    """PDF 파일을 API로 분석하고 결과를 이벤트로 발행하는 모듈"""

    name = "M_PdfReader"
    description = "PDF Analysis API로 PDF를 분석하여 텍스트/이미지/표/레이아웃 추출"
    capabilities = ["EVT_PDF_FOUND", "EVT_PDF_ANALYZED"]

    def __init__(
        self,
        api_base_url: str = "",
        enable_ocr: bool = False,
        extract_images: bool = False,
        extract_tables: bool = True,
        analyze_layout: bool = True,
        timeout: int = DEFAULT_TIMEOUT,
    ):
        super().__init__()
        self.api_base_url = (api_base_url or PDF_ANALYSIS_API_URL).rstrip("/")
        self.enable_ocr = enable_ocr
        self.extract_images = extract_images
        self.extract_tables = extract_tables
        self.analyze_layout = analyze_layout
        self.timeout = timeout

    def can_handle(self, event: Event) -> float:
        """EVT_PDF_FOUND 이벤트 처리 가능 여부"""
        if event.type != "EVT_PDF_FOUND":
            return 0.0
        payload = event.payload or {}
        file_path = payload.get("file_path") or ""
        if isinstance(file_path, str) and file_path.lower().endswith(".pdf"):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        """이벤트 처리: PDF 파일을 API로 분석 후 EVT_PDF_ANALYZED 발행"""
        if event.type != "EVT_PDF_FOUND":
            return []

        payload = event.payload or {}
        file_path = payload.get("file_path")
        if not file_path or not isinstance(file_path, str):
            print(f"[{self.name}] ⚠️  file_path가 없거나 유효하지 않습니다.")
            return []

        path = Path(file_path)
        if not path.is_file():
            print(f"[{self.name}] ⚠️  파일이 존재하지 않습니다: {file_path}")
            return []

        analysis = self._analyze_pdf(file_path, payload)
        if analysis is None:
            return []

        # EVT_PDF_ANALYZED 발행 (원본 이벤트 메타데이터 유지)
        out_payload: Dict[str, Any] = {
            "file_path": file_path,
            "relative_path": payload.get("relative_path", path.name),
            "filename": payload.get("filename", path.name),
            "stem": payload.get("stem", path.stem),
            "watch_dir": payload.get("watch_dir", ""),
            "analysis": analysis,
            "success": analysis.get("success", False),
        }
        if payload.get("sago_folder"):
            out_payload["sago_folder"] = payload["sago_folder"]

        return [
            Event(
                type="EVT_PDF_ANALYZED",
                payload=out_payload,
                source_module=self.name,
            )
        ]

    def _analyze_pdf(self, file_path: str, source_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """PDF Analysis API POST /analyze 호출."""
        url = f"{self.api_base_url}/analyze"
        try:
            with open(file_path, "rb") as f:
                files = {"file": (Path(file_path).name, f, "application/pdf")}
                params = {
                    "enable_ocr": self.enable_ocr,
                    "extract_images": self.extract_images,
                    "extract_tables": self.extract_tables,
                    "analyze_layout": self.analyze_layout,
                }
                resp = requests.post(
                    url,
                    files=files,
                    params=params,
                    timeout=self.timeout,
                )
            resp.raise_for_status()
            data = resp.json()
            return data
        except requests.exceptions.Timeout:
            print(f"[{self.name}] ⚠️  PDF 분석 API 타임아웃: {file_path}")
            return None
        except requests.exceptions.RequestException as e:
            print(f"[{self.name}] ⚠️  PDF 분석 API 오류: {e}")
            if hasattr(e, "response") and e.response is not None:
                try:
                    err_body = e.response.text
                    print(f"[{self.name}] 응답: {err_body[:500]}")
                except Exception:
                    pass
            return None
        except OSError as e:
            print(f"[{self.name}] ⚠️  파일 읽기 오류: {file_path}, {e}")
            return None
