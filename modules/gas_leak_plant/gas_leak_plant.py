"""
AI 가스 누출 - 공장 도면·센서 위치 관리 모듈
- 공장 도면(이미지) 업로드/목록/조회/삭제
- 도면 내 센서 설치 위치 등록 및 저장
"""
from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _data_dir() -> Path:
    base = os.getenv("AI_GAS_LEAK_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "ai_gas_leak"


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


def _sensors_path() -> Path:
    return _data_dir() / "sensors.json"


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
    with open(_drawings_path(), "w", encoding="utf-8") as f:
        json.dump(drawings, f, ensure_ascii=False, indent=2)


def _load_points_doc(drawing_id: str) -> Dict[str, Any]:
    """도면별 포인트: { sensors: [], valves: [] } (구버전: 배열만 있으면 sensors로 간주)."""
    path = _points_path(drawing_id)
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {"sensors": data, "valves": []}
                if isinstance(data, dict):
                    sens = data.get("sensors")
                    vals = data.get("valves")
                    return {
                        "sensors": sens if isinstance(sens, list) else [],
                        "valves": vals if isinstance(vals, list) else [],
                    }
        except (json.JSONDecodeError, IOError):
            pass
    return {"sensors": [], "valves": []}


def _save_points_doc(drawing_id: str, doc: Dict[str, Any]) -> None:
    path = _points_path(drawing_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)


def _load_sensors() -> List[Dict[str, Any]]:
    path = _sensors_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except (json.JSONDecodeError, IOError):
            pass
    return []


def _save_sensors(sensors: List[Dict[str, Any]]) -> None:
    path = _sensors_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sensors, f, ensure_ascii=False, indent=2)


def _file_type_from_filename(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        return "image"
    return "image"


class GasLeakPlantModule(Module):
    """공장 도면 업로드 및 도면 내 센서 설치 위치 등록"""

    name = "M_GasLeakPlant"
    description = "가스 누출 관제 - 공장 도면·센서 위치 관리"
    capabilities = [
        "GAS_LEAK_DRAWING_UPLOAD",
        "GAS_LEAK_DRAWING_LIST",
        "GAS_LEAK_DRAWING_GET",
        "GAS_LEAK_DRAWING_DELETE",
        "GAS_LEAK_SENSORS_SAVE",
    ]

    def can_handle(self, event: Event) -> float:
        if event.type in (
            "GAS_LEAK_DRAWING_UPLOAD",
            "GAS_LEAK_DRAWING_LIST",
            "GAS_LEAK_DRAWING_GET",
            "GAS_LEAK_DRAWING_DELETE",
            "GAS_LEAK_SENSORS_SAVE",
        ):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "GAS_LEAK_DRAWING_UPLOAD":
            return self._handle_upload(event)
        if event.type == "GAS_LEAK_DRAWING_LIST":
            return self._handle_list(event)
        if event.type == "GAS_LEAK_DRAWING_GET":
            return self._handle_get(event)
        if event.type == "GAS_LEAK_DRAWING_DELETE":
            return self._handle_delete(event)
        if event.type == "GAS_LEAK_SENSORS_SAVE":
            return self._handle_sensors_save(event)
        return []

    def _handle_upload(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        file_base64 = payload.get("file_base64")
        filename = payload.get("filename") or payload.get("name") or "floor_plan.png"
        name = (payload.get("name") or filename).strip() or filename
        if not file_base64:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_UPLOADED",
                    payload={"success": False, "error": "파일 데이터가 없습니다."},
                    source_module=self.name,
                )
            ]
        ext = Path(filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_UPLOADED",
                    payload={"success": False, "error": f"허용 형식: {', '.join(ALLOWED_EXTENSIONS)}"},
                    source_module=self.name,
                )
            ]
        try:
            raw = base64.b64decode(file_base64)
        except Exception as e:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_UPLOADED",
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
                    type="GAS_LEAK_DRAWING_UPLOADED",
                    payload={"success": False, "error": f"파일 저장 실패: {e}"},
                    source_module=self.name,
                )
            ]
        now = datetime.utcnow().isoformat() + "Z"
        drawing = {
            "id": drawing_id,
            "name": name,
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
                type="GAS_LEAK_DRAWING_UPLOADED",
                payload={"success": True, "drawing": drawing},
                source_module=self.name,
            )
        ]

    def _handle_list(self, event: Event) -> List[Event]:
        drawings = _load_drawings()
        return [
            Event(
                type="GAS_LEAK_DRAWING_LIST_RESULT",
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
                    type="GAS_LEAK_DRAWING_GET_RESULT",
                    payload={"success": False, "error": "drawing_id 필요"},
                    source_module=self.name,
                )
            ]
        drawings = _load_drawings()
        drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
        if not drawing:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_GET_RESULT",
                    payload={"success": False, "error": "도면을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        doc = _load_points_doc(drawing_id)
        return [
            Event(
                type="GAS_LEAK_DRAWING_GET_RESULT",
                payload={"success": True, "drawing": drawing, "sensors": doc.get("sensors") or [], "valves": doc.get("valves") or []},
                source_module=self.name,
            )
        ]

    def _handle_delete(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        drawing_id = (payload.get("drawing_id") or payload.get("id") or "").strip()
        if not drawing_id:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_DELETED",
                    payload={"success": False, "error": "drawing_id 필요"},
                    source_module=self.name,
                )
            ]
        drawings = _load_drawings()
        drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
        if not drawing:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_DELETED",
                    payload={"success": False, "error": "도면을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        try:
            drawings = [d for d in drawings if d.get("id") != drawing_id]
            _save_drawings(drawings)
            rel_path = drawing.get("file_path") or ""
            if rel_path and ".." not in rel_path:
                fp = _data_dir() / rel_path
                if fp.exists() and fp.is_file():
                    try:
                        fp.unlink()
                    except OSError:
                        pass
            pts_path = _points_path(drawing_id)
            if pts_path.exists():
                try:
                    pts_path.unlink()
                except OSError:
                    pass
        except Exception as e:
            return [
                Event(
                    type="GAS_LEAK_DRAWING_DELETED",
                    payload={"success": False, "error": str(e)},
                    source_module=self.name,
                )
            ]
        return [
            Event(
                type="GAS_LEAK_DRAWING_DELETED",
                payload={"success": True, "drawing_id": drawing_id},
                source_module=self.name,
            )
        ]

    def _handle_sensors_save(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        drawing_id = payload.get("drawing_id")
        sensors = payload.get("sensors")
        valves_in = payload.get("valves")
        if not drawing_id or not isinstance(sensors, list):
            return [
                Event(
                    type="GAS_LEAK_SENSORS_SAVED",
                    payload={"success": False, "error": "drawing_id와 sensors 필요"},
                    source_module=self.name,
                )
            ]
        drawings = _load_drawings()
        drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
        if not drawing:
            return [
                Event(
                    type="GAS_LEAK_SENSORS_SAVED",
                    payload={"success": False, "error": "도면을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        def _unit_from_sensor_type(st: str) -> str:
            st = (st or "").strip()
            if st == "pressure":
                return "MPa"
            if st == "concentration":
                return "%"
            return "L/min"

        normalized = []
        for i, s in enumerate(sensors):
            if not isinstance(s, dict):
                continue
            sid = (s.get("id") or str(uuid.uuid4())).strip()
            x = float(s.get("x", 0))
            y = float(s.get("y", 0))
            if x < 0 or x > 1:
                x = max(0, min(1, x))
            if y < 0 or y > 1:
                y = max(0, min(1, y))
            st = (s.get("sensor_type") or "pressure").strip()
            unit = (s.get("unit") or "").strip() or _unit_from_sensor_type(st)
            pt = {
                "id": sid,
                "label": (s.get("label") or "").strip() or f"S{i+1}",
                "zone_id": (s.get("zone_id") or "zone1").strip(),
                "x": x,
                "y": y,
                "unit": unit,
                "sensor_type": st,
            }
            normalized.append(pt)
        valves_norm: List[Dict[str, Any]] = []
        if isinstance(valves_in, list):
            for i, v in enumerate(valves_in):
                if not isinstance(v, dict):
                    continue
                vid = (v.get("id") or str(uuid.uuid4())).strip()
                x = float(v.get("x", 0))
                y = float(v.get("y", 0))
                if x < 0 or x > 1:
                    x = max(0, min(1, x))
                if y < 0 or y > 1:
                    y = max(0, min(1, y))
                valves_norm.append({
                    "id": vid,
                    "label": (v.get("label") or "").strip() or f"V{i+1}",
                    "x": x,
                    "y": y,
                })
        now = datetime.utcnow().isoformat() + "Z"
        _save_points_doc(drawing_id, {"sensors": normalized, "valves": valves_norm})
        drawing["updated_at"] = now
        idx = next((i for i, d in enumerate(drawings) if d.get("id") == drawing_id), None)
        if idx is not None:
            drawings[idx] = drawing
            _save_drawings(drawings)
        current_sensors = _load_sensors()
        by_id = {c.get("id"): c for c in current_sensors if c.get("id")}
        for pt in normalized:
            sid = pt.get("id")
            if sid not in by_id:
                by_id[sid] = {
                    "id": sid,
                    "zone_id": pt.get("zone_id"),
                    "label": pt.get("label"),
                    "value": 0,
                    "unit": pt.get("unit"),
                    "sensor_type": pt.get("sensor_type") or "pressure",
                    "status": "normal",
                }
            else:
                by_id[sid]["label"] = pt.get("label")
                by_id[sid]["zone_id"] = pt.get("zone_id")
                by_id[sid]["unit"] = pt.get("unit")
                by_id[sid]["sensor_type"] = pt.get("sensor_type") or "pressure"
        _save_sensors(list(by_id.values()))
        return [
            Event(
                type="GAS_LEAK_SENSORS_SAVED",
                payload={"success": True, "drawing_id": drawing_id, "sensors": normalized, "valves": valves_norm, "updated_at": now},
                source_module=self.name,
            )
        ]
