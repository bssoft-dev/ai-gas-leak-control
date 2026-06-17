"""
M_InstallationLocation: 도면 관리 관리 모듈
- 도면(PDF/이미지) 업로드 및 DWG No 등록
- 도면 위 설치 위치 포인트 표시/저장
- 자재(installation_location) 연동 및 변경 이력 저장
"""
from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 허용 파일 확장자
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"}
ALLOWED_MIME = {
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp",
}


def _data_dir() -> Path:
    base = os.getenv("INSTALLATION_LOCATION_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "installation_location"


def _traceability_records_path() -> Path:
    """자재 records.json 경로 (도면번호 반영용)"""
    return _data_dir().parent / "traceability" / "records.json"


def _drawings_path() -> Path:
    p = _data_dir() / "drawings.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _uploads_dir() -> Path:
    d = _data_dir() / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _points_path(drawing_id: str) -> Path:
    d = _data_dir() / "points"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{drawing_id}.json"


def _history_path(drawing_id: str) -> Path:
    d = _data_dir() / "history"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{drawing_id}.json"


def _load_drawings() -> List[Dict[str, Any]]:
    path = _drawings_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except (json.JSONDecodeError, IOError):
            pass
    return []


def _save_drawings(drawings: List[Dict[str, Any]]) -> None:
    path = _drawings_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(drawings, f, ensure_ascii=False, indent=2)


def _load_points(drawing_id: str) -> List[Dict[str, Any]]:
    path = _points_path(drawing_id)
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except (json.JSONDecodeError, IOError):
            pass
    return []


def _save_points(drawing_id: str, points: List[Dict[str, Any]]) -> None:
    path = _points_path(drawing_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(points, f, ensure_ascii=False, indent=2)


def _update_traceability_records_for_drawing(
    drawing: Dict[str, Any],
    points: List[Dict[str, Any]],
    updated_at: str,
) -> int:
    """
    포인트에 등록된 자재(record_id/pcs_no)에 도면번호(dwg_no) 및 설치위치도(installation_location) 반영.
    반영된 레코드 개수 반환.
    """
    path = _traceability_records_path()
    if not path.exists():
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            records = json.load(f)
    except (json.JSONDecodeError, IOError):
        return 0
    if not isinstance(records, list):
        return 0
    drawing_id = drawing.get("id") or ""
    dwg_no = (drawing.get("dwg_no") or "").strip()
    if not dwg_no and not drawing_id:
        return 0
    # 설치위치도 표기: 도면 ID 또는 DWG No
    installation_value = dwg_no or f"도면 ID: {drawing_id}"
    updated_count = 0
    for pt in points:
        record_id = (pt.get("record_id") or "").strip()
        pcs_no = (pt.get("pcs_no") or "").strip()
        if not record_id and not pcs_no:
            continue
        for i, rec in enumerate(records):
            if not isinstance(rec, dict):
                continue
            rid = rec.get("id") or ""
            pcs = (rec.get("pcs_no") or "").strip()
            match = (record_id and rid == record_id) or (pcs_no and pcs == pcs_no)
            if match:
                records[i] = {**rec, "dwg_no": dwg_no, "installation_location": installation_value, "updated_at": updated_at}
                updated_count += 1
                break
    if updated_count > 0:
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(records, f, ensure_ascii=False, indent=2)
        except IOError:
            pass
    return updated_count


def _clear_traceability_records_for_drawing(
    points: List[Dict[str, Any]],
    updated_at: str,
) -> int:
    """
    도면 삭제 시, 해당 도면 포인트에 등록된 자재(record_id/pcs_no)의 dwg_no·installation_location 초기화.
    초기화된 레코드 개수 반환.
    """
    path = _traceability_records_path()
    if not path.exists():
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            records = json.load(f)
    except (json.JSONDecodeError, IOError):
        return 0
    if not isinstance(records, list):
        return 0
    updated_count = 0
    for pt in points:
        record_id = (pt.get("record_id") or "").strip()
        pcs_no = (pt.get("pcs_no") or "").strip()
        if not record_id and not pcs_no:
            continue
        for i, rec in enumerate(records):
            if not isinstance(rec, dict):
                continue
            rid = rec.get("id") or ""
            pcs = (rec.get("pcs_no") or "").strip()
            match = (record_id and rid == record_id) or (pcs_no and pcs == pcs_no)
            if match:
                records[i] = {
                    **rec,
                    "dwg_no": "",
                    "installation_location": "",
                    "updated_at": updated_at,
                }
                updated_count += 1
                break
    if updated_count > 0:
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(records, f, ensure_ascii=False, indent=2)
        except IOError:
            pass
    return updated_count


def _append_history(drawing_id: str, action: str, points_snapshot: List[Dict[str, Any]], changed_at: str) -> None:
    path = _history_path(drawing_id)
    history: List[Dict[str, Any]] = []
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                history = json.load(f)
                if not isinstance(history, list):
                    history = []
        except (json.JSONDecodeError, IOError):
            pass
    history.append({
        "action": action,
        "points": points_snapshot,
        "changed_at": changed_at,
    })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history[-500:], f, ensure_ascii=False, indent=2)  # 최근 500건


def _file_type_from_filename(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        return "image"
    return "image"


class InstallationLocationModule(Module):
    """도면 업로드, DWG No 등록, 설치 위치 포인트 저장 및 이력 관리"""

    name = "M_InstallationLocation"
    description = "도면 관리 관리 (도면 업로드, DWG No, 포인트 표시, 자재 연동)"
    capabilities = [
        "INSTALLATION_DRAWING_UPLOAD",
        "INSTALLATION_DRAWING_LIST",
        "INSTALLATION_DRAWING_GET",
        "INSTALLATION_POINTS_SAVE",
        "INSTALLATION_DRAWING_DELETE",
    ]

    def can_handle(self, event: Event) -> float:
        if event.type in (
            "INSTALLATION_DRAWING_UPLOAD",
            "INSTALLATION_DRAWING_LIST",
            "INSTALLATION_DRAWING_GET",
            "INSTALLATION_POINTS_SAVE",
            "INSTALLATION_DRAWING_DELETE",
        ):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "INSTALLATION_DRAWING_UPLOAD":
            return self._handle_upload(event)
        if event.type == "INSTALLATION_DRAWING_LIST":
            return self._handle_list(event)
        if event.type == "INSTALLATION_DRAWING_GET":
            return self._handle_get(event)
        if event.type == "INSTALLATION_POINTS_SAVE":
            return self._handle_points_save(event)
        if event.type == "INSTALLATION_DRAWING_DELETE":
            return self._handle_delete(event)
        return []

    def _handle_upload(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        dwg_no = (payload.get("dwg_no") or "").strip()
        file_base64 = payload.get("file_base64")
        filename = payload.get("filename") or "drawing"
        if not file_base64:
            return [
                Event(
                    type="INSTALLATION_DRAWING_UPLOADED",
                    payload={"success": False, "error": "파일 데이터가 없습니다."},
                    source_module=self.name,
                )
            ]
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return [
                Event(
                    type="INSTALLATION_DRAWING_UPLOADED",
                    payload={"success": False, "error": f"허용 형식: {', '.join(ALLOWED_EXTENSIONS)}"},
                    source_module=self.name,
                )
            ]
        try:
            raw = base64.b64decode(file_base64)
        except Exception as e:
            return [
                Event(
                    type="INSTALLATION_DRAWING_UPLOADED",
                    payload={"success": False, "error": f"파일 디코딩 실패: {e}"},
                    source_module=self.name,
                )
            ]
        drawing_id = str(uuid.uuid4())
        safe_name = f"{drawing_id}{ext}"
        upload_path = _uploads_dir() / safe_name
        try:
            upload_path.write_bytes(raw)
        except IOError as e:
            return [
                Event(
                    type="INSTALLATION_DRAWING_UPLOADED",
                    payload={"success": False, "error": f"파일 저장 실패: {e}"},
                    source_module=self.name,
                )
            ]
        now = datetime.utcnow().isoformat() + "Z"
        drawing = {
            "id": drawing_id,
            "dwg_no": dwg_no or filename,
            "filename": filename,
            "file_type": _file_type_from_filename(filename),
            "file_path": f"uploads/{safe_name}",
            "created_at": now,
            "updated_at": now,
        }
        drawings = _load_drawings()
        drawings.append(drawing)
        _save_drawings(drawings)
        _save_points(drawing_id, [])
        return [
            Event(
                type="INSTALLATION_DRAWING_UPLOADED",
                payload={"success": True, "drawing": drawing},
                source_module=self.name,
            )
        ]

    def _handle_list(self, event: Event) -> List[Event]:
        drawings = _load_drawings()
        return [
            Event(
                type="INSTALLATION_DRAWING_LIST_RESULT",
                payload={"drawings": drawings},
                source_module=self.name,
            )
        ]

    def _handle_get(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        drawing_id = payload.get("drawing_id") or payload.get("id")
        if not drawing_id:
            return [
                Event(
                    type="INSTALLATION_DRAWING_GET_RESULT",
                    payload={"success": False, "error": "drawing_id 필요"},
                    source_module=self.name,
                )
            ]
        drawings = _load_drawings()
        drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
        if not drawing:
            return [
                Event(
                    type="INSTALLATION_DRAWING_GET_RESULT",
                    payload={"success": False, "error": "도면을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        points = _load_points(drawing_id)
        return [
            Event(
                type="INSTALLATION_DRAWING_GET_RESULT",
                payload={"success": True, "drawing": drawing, "points": points},
                source_module=self.name,
            )
        ]

    def _handle_points_save(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        drawing_id = payload.get("drawing_id")
        points = payload.get("points")
        if not drawing_id or not isinstance(points, list):
            return [
                Event(
                    type="INSTALLATION_POINTS_SAVED",
                    payload={"success": False, "error": "drawing_id와 points 필요"},
                    source_module=self.name,
                )
            ]
        drawings = _load_drawings()
        drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
        if not drawing:
            return [
                Event(
                    type="INSTALLATION_POINTS_SAVED",
                    payload={"success": False, "error": "도면을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        # 정규화: 각 포인트에 id, x, y (0~1), pcs_no, record_id 등
        normalized = []
        for i, p in enumerate(points):
            if not isinstance(p, dict):
                continue
            pt = {
                "id": p.get("id") or str(uuid.uuid4()),
                "x": float(p.get("x", 0)),
                "y": float(p.get("y", 0)),
                "pcs_no": (p.get("pcs_no") or "").strip(),
                "record_id": p.get("record_id") or "",
                "label": (p.get("label") or "").strip(),
            }
            normalized.append(pt)
        now = datetime.utcnow().isoformat() + "Z"
        _save_points(drawing_id, normalized)
        _append_history(drawing_id, "save", normalized, now)
        drawing["updated_at"] = now
        idx = next((i for i, d in enumerate(drawings) if d.get("id") == drawing_id), None)
        if idx is not None:
            drawings[idx] = drawing
            _save_drawings(drawings)
        # 포인트에 등록된 자재(record_id/pcs_no)에 도면번호·설치위치도 반영
        records_updated = _update_traceability_records_for_drawing(drawing, normalized, now)
        return [
            Event(
                type="INSTALLATION_POINTS_SAVED",
                payload={
                    "success": True,
                    "drawing_id": drawing_id,
                    "points": normalized,
                    "updated_at": now,
                    "records_updated": records_updated,
                },
                source_module=self.name,
            )
        ]

    def _handle_delete(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        drawing_id = (payload.get("drawing_id") or payload.get("id") or "").strip()
        if not drawing_id:
            return [
                Event(
                    type="INSTALLATION_DRAWING_DELETED",
                    payload={"success": False, "error": "drawing_id 필요"},
                    source_module=self.name,
                )
            ]
        drawings = _load_drawings()
        drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
        if not drawing:
            return [
                Event(
                    type="INSTALLATION_DRAWING_DELETED",
                    payload={"success": False, "error": "도면을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        try:
            # 해당 도면 포인트에 연결된 자재의 DWG No·설치위치도 초기화 (포인트 파일 삭제 전에 로드)
            points = _load_points(drawing_id)
            now = datetime.utcnow().isoformat() + "Z"
            records_cleared = _clear_traceability_records_for_drawing(points, now)
            # 목록에서 제거
            drawings = [d for d in drawings if d.get("id") != drawing_id]
            _save_drawings(drawings)
            # 업로드 파일 삭제
            rel_path = drawing.get("file_path") or ""
            if rel_path and ".." not in rel_path:
                fp = _data_dir() / rel_path
                if fp.exists() and fp.is_file():
                    try:
                        fp.unlink()
                    except OSError:
                        pass
            # 포인트/이력 파일 삭제
            for path in [_points_path(drawing_id), _history_path(drawing_id)]:
                if path.exists():
                    try:
                        path.unlink()
                    except OSError:
                        pass
        except Exception as e:
            return [
                Event(
                    type="INSTALLATION_DRAWING_DELETED",
                    payload={"success": False, "error": str(e)},
                    source_module=self.name,
                )
            ]
        return [
            Event(
                type="INSTALLATION_DRAWING_DELETED",
                payload={"success": True, "drawing_id": drawing_id, "records_cleared": records_cleared},
                source_module=self.name,
            )
        ]
