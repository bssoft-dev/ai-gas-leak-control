"""
M_TraceabilityPdfVision

요구사항 대응:
1) PDF를 페이지 이미지로 변환해 UI에 제공
2) VLM(선택): LLM_API_BASE 또는 TRACEABILITY_VISION_API_URL + /chat/vlm/nim 로 페이지별 설치/설계 분류
3) 텍스트(ETV_PDF_ANALYZED 결과) 기반 보정 분류
4) UI 표시용 이벤트 TRACEABILITY_PDF_VISION_READY 발행
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import requests

from SagoHub.core.event import Event
from SagoHub.core.module import Module


def _project_root() -> Path:
    mod_dir = Path(__file__).resolve().parent
    return mod_dir.parent.parent


def _traceability_data_dir() -> Path:
    base = os.getenv("TRACEABILITY_DATA_DIR")
    if base:
        return Path(base)
    return _project_root() / "data" / "traceability"


def _vision_root() -> Path:
    d = _traceability_data_dir() / "pdf_vision"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _vision_jobs_dir() -> Path:
    d = _vision_root() / "jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _vision_pages_dir(job_id: str) -> Path:
    d = _vision_root() / "pages" / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _job_path(job_id: str) -> Path:
    return _vision_jobs_dir() / f"{job_id}.json"


def _read_job(job_id: str) -> Dict[str, Any]:
    p = _job_path(job_id)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_job(job_id: str, data: Dict[str, Any]) -> None:
    p = _job_path(job_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _classify_by_text(text: str) -> str:
    t = (text or "").upper()
    install_keys = ["INSTALLATION", "INST DWG", "OVERVIEW", "PLAN VIEW", "취부", "설치"]
    if any(k in t for k in install_keys):
        return "installation"
    # 도면명/BOM/부품 중심은 설계로 분류
    return "design"


def _to_data_url(image_path: Path) -> str:
    raw = image_path.read_bytes()
    return "data:image/png;base64," + base64.b64encode(raw).decode("utf-8")


def _page_image_url(job_id: str, page_number: int) -> str:
    """
    프론트에서 <img src="...">로 바로 사용할 수 있는 URL 경로를 내려준다.
    """
    return f"/api/traceability/pdf_vision/jobs/{job_id}/pages/{page_number}/file"


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _vision_base_url() -> str:
    """
    VLM 호출 베이스 URL.
    TRACEABILITY_VISION_API_URL 이 없으면 LLM_API_BASE 를 사용한다 (동일 llm-api 서버).
    """
    u = (os.getenv("TRACEABILITY_VISION_API_URL") or os.getenv("LLM_API_BASE") or "").strip()
    return u.rstrip("/")


def _vision_model() -> str:
    return (os.getenv("TRACEABILITY_VISION_MODEL") or os.getenv("LLM_MODEL") or "qwen/qwen3.5-397b-a17b").strip()


def _vision_endpoint_path() -> str:
    ep = (os.getenv("TRACEABILITY_VISION_ENDPOINT") or "/chat/vlm/nim").strip()
    return ep if ep.startswith("/") else f"/{ep}"


def _vision_timeout_sec() -> float:
    try:
        return float(os.getenv("TRACEABILITY_VISION_TIMEOUT") or "600")
    except Exception:
        return 120.0


def _vision_auth_headers() -> Dict[str, str]:
    key = (os.getenv("TRACEABILITY_VISION_API_KEY") or os.getenv("LLM_API_KEY") or "").strip()
    if not key:
        return {}
    return {"Authorization": f"Bearer {key}"}


def _vlm_classification_prompt(filename: str, page_number: int) -> str:
    """
    VLM 분류 프롬프트를 `VLM_CLASSIFICATION.PROMPT` 파일에서 매 호출마다 읽어 사용합니다.
    """
    try:
        # 파일이 상대 경로로 위치할 수 있으므로 모듈 경로 기준으로 탐색
        prompt_path = Path(__file__).resolve().parent / "VLM_CLASSIFICATION.PROMPT"
        raw = prompt_path.read_text(encoding="utf-8")
        return raw.replace("{filename}", filename).replace("{page_number}", str(page_number))
    except Exception:
        # 파일이 없거나 읽기 실패 시 기본 프롬프트로 폴백
        return (
            "You classify a single engineering/shipbuilding PDF page image.\n"
            'Reply with ONE JSON object only (no markdown fence), keys:\n'
            '  "classification": "installation" or "design"\n'
            '    - installation: installation/assembly/site/취부/설치/현장 관련 도면\n'
            "    - design: system schematic, BOM, parts list, general arrangement as design doc\n"
            '  "confidence": number from 0 to 1\n'
            '  "text": one short explanation in Korean\n'
            f'Context: filename="{filename}", page_number={page_number}.\n'
        )


def _extract_vlm_text_from_response(data: Any) -> str:
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    if not isinstance(data, dict):
        return str(data)
    for key in ("content", "text", "message", "response", "result", "answer"):
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            return v
    ch = data.get("choices")
    if isinstance(ch, list) and ch:
        c0 = ch[0]
        if isinstance(c0, dict):
            msg = c0.get("message")
            if isinstance(msg, dict) and isinstance(msg.get("content"), str):
                return msg["content"]
            if isinstance(c0.get("text"), str):
                return c0["text"]
    nested = data.get("data")
    if isinstance(nested, dict):
        return _extract_vlm_text_from_response(nested)
    return ""


def _parse_vlm_classification(raw_text: str) -> Dict[str, Any]:
    """
    모델 응답에서 classification / confidence / text 추출.
    """
    t = (raw_text or "").strip()
    out: Dict[str, Any] = {"classification": "", "confidence": None, "text": t}
    if not t:
        return out
    try:
        j = json.loads(t)
        if isinstance(j, dict):
            cls = (j.get("classification") or "").strip().lower()
            if cls in ("installation", "design"):
                out["classification"] = cls
            c = j.get("confidence")
            if c is not None:
                try:
                    out["confidence"] = float(c)
                except Exception:
                    pass
            if j.get("text") is not None:
                out["text"] = str(j.get("text"))
            if out["classification"]:
                return out
    except Exception:
        pass
    m = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", t, re.DOTALL)
    if m:
        try:
            j = json.loads(m.group(0))
            if isinstance(j, dict):
                cls = (j.get("classification") or "").strip().lower()
                if cls in ("installation", "design"):
                    out["classification"] = cls
                c = j.get("confidence")
                if c is not None:
                    try:
                        out["confidence"] = float(c)
                    except Exception:
                        pass
                if j.get("text") is not None:
                    out["text"] = str(j.get("text"))
                if out["classification"]:
                    return out
        except Exception:
            pass
    tl = t.lower()
    if "installation" in tl or "설치" in t or "취부" in t:
        out["classification"] = "installation"
    elif "design" in tl or "설계" in t:
        out["classification"] = "design"
    return out


def _bbox_to_overlay(bbox: Any, width: float, height: float, box_type: str, text: str = "") -> Dict[str, Any]:
    if not isinstance(bbox, list) or len(bbox) != 4:
        return {}
    x1 = _safe_float(bbox[0], 0.0)
    y1 = _safe_float(bbox[1], 0.0)
    x2 = _safe_float(bbox[2], 0.0)
    y2 = _safe_float(bbox[3], 0.0)
    if width <= 0 or height <= 0:
        return {}
    x = max(0.0, min(1.0, x1 / width))
    y = max(0.0, min(1.0, y1 / height))
    w = max(0.0, min(1.0, (x2 - x1) / width))
    h = max(0.0, min(1.0, (y2 - y1) / height))
    if w <= 0 or h <= 0:
        return {}
    return {
        "type": box_type,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "text": (text or "").strip(),
    }


def _call_vision_api(image_base64: str, filename: str, page_number: int) -> Dict[str, Any]:
    """
    LLM API (OpenAPI) POST /chat/vlm/nim — NIMVLMRequest: prompt, image_urls, model, ...

    베이스 URL: TRACEABILITY_VISION_API_URL 이 비어 있으면 LLM_API_BASE 사용.
    엔드포인트: TRACEABILITY_VISION_ENDPOINT (기본 /chat/vlm/nim)
    인증: TRACEABILITY_VISION_API_KEY 또는 LLM_API_KEY (Bearer)
    """
    base = _vision_base_url()
    if not base:
        return {}
    url = base + _vision_endpoint_path()
    payload: Dict[str, Any] = {
        "prompt": _vlm_classification_prompt(filename, page_number),
        "image_urls": [f"data:image/png;base64,{image_base64}"],
        "model": _vision_model(),
        "temperature": 0.2,
        "max_tokens": 512,
    }
    headers = {"Content-Type": "application/json", **_vision_auth_headers()}
    timeout = _vision_timeout_sec()
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=timeout)
        if r.status_code != 200:
            return {}
        try:
            data = r.json()
        except Exception:
            return _parse_vlm_classification(r.text or "")
        if not isinstance(data, dict):
            return _parse_vlm_classification(r.text or "")
        text = _extract_vlm_text_from_response(data)
        merged = _parse_vlm_classification(text)
        dc = (data.get("classification") or "").strip().lower()
        if dc in ("installation", "design", "specification"):
            merged["classification"] = dc
        if merged.get("confidence") is None and data.get("confidence") is not None:
            try:
                merged["confidence"] = float(data.get("confidence"))
            except Exception:
                pass
        # 모델이 "Reply with ONE JSON object"를 따르며, `_parse_vlm_classification()`
        # 가 성공적으로 `text`(설명)까지 파싱하면 raw `text`(전체 JSON 문자열)로 덮어쓰지 말아야 함.
        # 덮어쓰면 프론트의 `text_vision`이 JSON 원문 전체로 들어가 파싱이 깨짐.
        if not merged.get("classification") and (text or "").strip():
            merged["text"] = text
        return merged
    except Exception:
        return {}


class TraceabilityPdfVisionModule(Module):
    name = "M_TraceabilityPdfVision"
    description = "PDF 페이지 이미지화 + 비전/텍스트 분류 + UI 결과 발행"
    capabilities = [
        "TRACEABILITY_PDF_VISION_UPLOAD",
        "EVT_PDF_ANALYZED",
        "TRACEABILITY_PDF_VISION_READY",
        "TRACEABILITY_PDF_VISION_FAILED",
    ]

    def can_handle(self, event: Event) -> float:
        if event.type in ("TRACEABILITY_PDF_VISION_UPLOAD", "EVT_PDF_ANALYZED"):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "TRACEABILITY_PDF_VISION_UPLOAD":
            return self._handle_upload(event)
        if event.type == "EVT_PDF_ANALYZED":
            return self._handle_pdf_analyzed(event)
        return []

    def _handle_upload(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        file_base64 = payload.get("file_base64")
        filename = (payload.get("filename") or "drawing.pdf").strip()
        job_id = (payload.get("job_id") or "").strip() or str(uuid.uuid4())
        if not isinstance(file_base64, str) or not file_base64.strip():
            return [
                Event(
                    type="TRACEABILITY_PDF_VISION_FAILED",
                    payload={"success": False, "job_id": job_id, "error": "file_base64가 필요합니다."},
                    source_module=self.name,
                )
            ]

        # PDF 저장
        uploads_dir = _traceability_data_dir() / "pdf_uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = uploads_dir / f"{job_id}.pdf"
        try:
            raw = base64.b64decode(file_base64)
            pdf_path.write_bytes(raw)
        except Exception as e:
            return [
                Event(
                    type="TRACEABILITY_PDF_VISION_FAILED",
                    payload={"success": False, "job_id": job_id, "error": f"PDF 저장 실패: {e}"},
                    source_module=self.name,
                )
            ]

        if not shutil.which("pdftoppm"):
            return [
                Event(
                    type="TRACEABILITY_PDF_VISION_FAILED",
                    payload={"success": False, "job_id": job_id, "error": "pdftoppm 명령이 없어 페이지 이미지 변환이 불가합니다."},
                    source_module=self.name,
                )
            ]

        pages_dir = _vision_pages_dir(job_id)
        out_prefix = pages_dir / "page"
        # 가벼운 UI 표시를 위해 140 DPI
        cmd = [
            "pdftoppm",
            "-png",
            "-r",
            "140",
            str(pdf_path),
            str(out_prefix),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e:
            return [
                Event(
                    type="TRACEABILITY_PDF_VISION_FAILED",
                    payload={"success": False, "job_id": job_id, "error": f"PDF 이미지 변환 실패: {e.stderr or e.stdout or str(e)}"},
                    source_module=self.name,
                )
            ]

        image_files = sorted(pages_dir.glob("page-*.png"))
        if not image_files:
            return [
                Event(
                    type="TRACEABILITY_PDF_VISION_FAILED",
                    payload={"success": False, "job_id": job_id, "error": "PDF 페이지 이미지가 생성되지 않았습니다."},
                    source_module=self.name,
                )
            ]

        pages: List[Dict[str, Any]] = []
        for idx, img in enumerate(image_files, start=1):
            # VLM: TRACEABILITY_VISION_API_URL 또는 LLM_API_BASE 가 있으면 페이지별 호출
            v = {}
            if _vision_base_url():
                data_url = _to_data_url(img)
                image_b64 = data_url.split("base64,", 1)[1]
                v = _call_vision_api(image_b64, filename=filename, page_number=idx) or {}
            pages.append(
                {
                    "page_number": idx,
                    "image_path": str(img),
                    "image_data_url": _page_image_url(job_id, idx),
                    "classification_vision": (v.get("classification") or "").strip().lower() if isinstance(v, dict) else "",
                    "confidence_vision": v.get("confidence") if isinstance(v, dict) else None,
                    "text_vision": v.get("text") if isinstance(v, dict) else "",
                    "text_pdf": "",
                    "classification": v.get("classification") or "unknown",
                    "source": "vision-pending-text",
                }
            )

        job = {
            "job_id": job_id,
            "filename": filename,
            "pdf_path": str(pdf_path),
            "created_at": _utc_now_iso(),
            "pages": pages,
        }
        _write_job(job_id, job)

        # PDF 텍스트 추출 파이프라인 기동
        return [
            Event(
                type="EVT_PDF_FOUND",
                payload={
                    "file_path": str(pdf_path),
                    "relative_path": f"pdf_uploads/{job_id}.pdf",
                    "filename": filename,
                    "stem": job_id,
                    "watch_dir": "",
                },
                source_module=self.name,
            ),
            Event(
                type="TRACEABILITY_PDF_VISION_READY",
                payload={
                    "success": True,
                    "job_id": job_id,
                    "filename": filename,
                    "status": "pages_ready",
                    "pages": pages,
                    "summary": {
                        "total_pages": len(pages),
                        "installation_pages": 0,
                        "design_pages": 0,
                    },
                },
                source_module=self.name,
            ),
        ]

    def _handle_pdf_analyzed(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        job_id = (payload.get("stem") or payload.get("job_id") or "").strip()
        if not job_id:
            return []
        job = _read_job(job_id)
        if not job:
            return []

        analysis = payload.get("analysis") or {}
        pages_analysis = analysis.get("pages") or []
        if not isinstance(pages_analysis, list):
            pages_analysis = []

        page_text_by_num: Dict[int, str] = {}
        page_boxes_by_num: Dict[int, List[Dict[str, Any]]] = {}
        for p in pages_analysis:
            if not isinstance(p, dict):
                continue
            try:
                n = int(p.get("page_number"))
            except Exception:
                continue
            page_text_by_num[n] = (p.get("text") or "").strip()
            width = _safe_float(p.get("width"), 0.0)
            height = _safe_float(p.get("height"), 0.0)
            boxes: List[Dict[str, Any]] = []

            # layout bbox (heading/paragraph 등)
            layout = p.get("layout") or []
            if isinstance(layout, list):
                for node in layout:
                    if not isinstance(node, dict):
                        continue
                    box = _bbox_to_overlay(
                        node.get("bbox"),
                        width,
                        height,
                        box_type=str(node.get("type") or "layout"),
                        text=str(node.get("text") or ""),
                    )
                    if box:
                        if "confidence" in node:
                            box["confidence"] = node.get("confidence")
                        boxes.append(box)

            # table bbox
            tables = p.get("tables") or []
            if isinstance(tables, list):
                for tb in tables:
                    if not isinstance(tb, dict):
                        continue
                    box = _bbox_to_overlay(
                        tb.get("bbox"),
                        width,
                        height,
                        box_type="table",
                        text=f"table_{tb.get('table_index', '')}",
                    )
                    if box:
                        boxes.append(box)

            page_boxes_by_num[n] = boxes

        pages = job.get("pages") or []
        for p in pages:
            if not isinstance(p, dict):
                continue
            n = int(p.get("page_number") or 0)
            text_pdf = page_text_by_num.get(n, "")
            p["text_pdf"] = text_pdf
            p["overlay_boxes"] = page_boxes_by_num.get(n, [])

            # 분류 우선순위: vision api -> text
            cls_v = (p.get("classification_vision") or "").strip().lower()
            if cls_v in ("installation", "design"):
                p["classification"] = cls_v
                p["source"] = "vision"
            else:
                cls_t = _classify_by_text(text_pdf)
                p["classification"] = cls_t
                p["source"] = "text"

        install_pages = [x for x in pages if isinstance(x, dict) and x.get("classification") == "installation"]
        design_pages = [x for x in pages if isinstance(x, dict) and x.get("classification") == "design"]

        job["pages"] = pages
        job["updated_at"] = _utc_now_iso()
        _write_job(job_id, job)

        return [
            Event(
                type="TRACEABILITY_PDF_VISION_READY",
                payload={
                    "success": True,
                    "job_id": job_id,
                    "filename": job.get("filename", ""),
                    "status": "classified",
                    "pages": pages,
                    "installation_pages": install_pages,
                    "design_pages": design_pages,
                    "summary": {
                        "total_pages": len(pages),
                        "installation_pages": len(install_pages),
                        "design_pages": len(design_pages),
                    },
                },
                source_module=self.name,
            )
        ]

