"""
M_TraceabilityRecord: 자재 13대 필드 관리 모듈
- TRACEABILITY_RECORD_SAVE: 13대 필드 저장
- TRACEABILITY_RECORD_QUERY: PCS No/조건별 조회
- TRACEABILITY_RECORD_LIST: 목록 조회 (호선/BLOCK/UNIT 등 필터)
- 성적서-시험 자재-도면 적용 위치 3단계 매핑 지원
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 13대 필드 정의 (명세 기준)
FIELDS_13 = [
    "drawing_receipt_date",   # 1. 도면접수일
    "ship_no",                # 2. 호선
    "block",                  # 3. BLOCK
    "unit",                   # 4. UNIT
    "item",                   # 5. ITEM
    "pcs_no",                 # 6. PC's No
    "installation_location",  # 7. 설치위치도
    "paint_code",             # 8. Paint Code
    "dwg_no",                 # 9. DWG No
    "quantity",               # 10. 수량
    "list_weight",            # 11. LIST 중량
    "remarks",                # 12. 비고
    "revision_date_reason",   # 13. 개정일/사유
]

FIELDS_13_LABELS = {
    "drawing_receipt_date": "도면접수일",
    "ship_no": "호선",
    "block": "BLOCK",
    "unit": "UNIT",
    "item": "ITEM",
    "pcs_no": "PC's No",
    "installation_location": "설치위치도",
    "paint_code": "Paint Code",
    "dwg_no": "DWG No",
    "quantity": "수량",
    "list_weight": "LIST 중량",
    "remarks": "비고",
    "revision_date_reason": "개정일/사유",
}


# 기초데이터 엑셀 파일명 (services/equipment-traceability/data/ 또는 TRACEABILITY_DATA_DIR)
BASE_DATA_EXCEL = "H8265 SKID 중량 check(전체 ).xlsx"


def _data_dir() -> Path:
    base = os.getenv("TRACEABILITY_DATA_DIR")
    if base:
        return Path(base)
    # 프로젝트 루트 기준: modules/../data/traceability
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "traceability"


def _base_excel_path() -> Path:
    """기초데이터 엑셀 경로: 서비스 data 폴더 우선, 없으면 traceability data 폴더."""
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    service_data = project_root / "services" / "equipment-traceability" / "data" / BASE_DATA_EXCEL
    if service_data.exists():
        return service_data
    return _data_dir() / BASE_DATA_EXCEL


def _records_path() -> Path:
    p = _data_dir() / "records.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load_records() -> List[Dict[str, Any]]:
    path = _records_path()
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    # 기초데이터: records 없을 때 엑셀 파일이 있으면 자동 로드
    base_path = _base_excel_path()
    if base_path.exists():
        from datetime import datetime
        now = datetime.utcnow().isoformat() + "Z"
        records = _load_records_from_excel(base_path)
        for r in records:
            r.setdefault("created_at", now)
            r.setdefault("updated_at", now)
        if records:
            _save_records(records)
            return records
    return []


def _save_records(records: List[Dict[str, Any]]) -> None:
    path = _records_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


# 엑셀 헤더(한글/영문) → 13대 필드 키 매핑 (H8265 SKID 중량 check 등)
EXCEL_HEADER_MAP = {
    "도면접수일": "drawing_receipt_date",
    "호선": "ship_no",
    "block": "block",
    "블록": "block",
    "unit": "unit",
    "유닛": "unit",
    "item": "item",
    "아이템": "item",
    "pcs no": "pcs_no",
    "pc's no": "pcs_no",
    "pcs_no": "pcs_no",
    "pc's no.": "pcs_no",
    "pcs no.": "pcs_no",
    "pcs": "pcs_no",
    "pc's": "pcs_no",
    "pcsno": "pcs_no",
    "설치위치도": "installation_location",
    "설치위치": "installation_location",
    "paint code": "paint_code",
    "페인트코드": "paint_code",
    "dwg no": "dwg_no",
    "dwg_no": "dwg_no",
    "도면번호": "dwg_no",
    "dwg no.": "dwg_no",
    "dwg": "dwg_no",
    "수량": "quantity",
    "list 중량": "list_weight",
    "list_weight": "list_weight",
    "list중량": "list_weight",
    "중량": "list_weight",
    "중량(kg)": "list_weight",
    "weight": "list_weight",
    "비고": "remarks",
    "개정일/사유": "revision_date_reason",
    "개정일": "revision_date_reason",
}


def _normalize_header(h: str) -> str:
    if not h or not isinstance(h, str):
        return ""
    s = str(h).strip()
    # 엑셀 셀 내 줄바꿈(\n), 탭, 공백 등 모든 공백 문자 제거 (도면\n접수일, PAINT\nCODE 등)
    for ws in (" ", "\n", "\r", "\t", "\u00a0"):
        s = s.replace(ws, "")
    return s.lower().replace(".", "")


def _build_col_to_key(headers: List[str]) -> Dict[int, str]:
    """헤더 문자열 리스트에서 컬럼 인덱스 → 13대 필드 키 매핑 생성."""
    col_to_key: Dict[int, str] = {}
    for idx, h in enumerate(headers):
        if not h:
            continue
        h = str(h).strip()
        norm = _normalize_header(h)
        for label, key in EXCEL_HEADER_MAP.items():
            if _normalize_header(label) == norm or h == label:
                col_to_key[idx] = key
                break
        if idx not in col_to_key:
            for en_key, kr_label in FIELDS_13_LABELS.items():
                if _normalize_header(kr_label) == norm or h == kr_label:
                    col_to_key[idx] = en_key
                    break
    return col_to_key


def _load_records_from_excel(path: Path) -> List[Dict[str, Any]]:
    """엑셀 파일에서 1시트 읽어 13대 필드 레코드 리스트로 변환.
    한글 등이 포함된 경로를 피하기 위해 파일을 바이너리로 열어 스트림으로 openpyxl에 전달.
    헤더가 첫 행이 아닐 수 있으므로 상위 5행 중 매핑이 가장 많은 행을 헤더로 사용하고,
    매핑이 하나도 없으면 컬럼 순서(0=도면접수일, 1=호선, …)로 인덱스 폴백."""
    try:
        import openpyxl
    except ImportError:
        return []
    if not path.exists():
        return []
    records: List[Dict[str, Any]] = []
    try:
        with path.open("rb") as f:
            wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
            ws = wb.active
            if not ws:
                wb.close()
                return []
            rows = list(ws.iter_rows(values_only=True))
            wb.close()
    except Exception as e:
        raise RuntimeError(f"엑셀 파일 열기/읽기 실패: {e}") from e
    if not rows:
        return []

    # 헤더 행 찾기: 상위 최대 5행 중 매핑 개수가 가장 많은 행 사용
    best_header_idx = 0
    best_col_to_key: Dict[int, str] = {}
    for header_idx in range(min(5, len(rows))):
        headers = [str(c).strip() if c is not None else "" for c in rows[header_idx]]
        ct = _build_col_to_key(headers)
        if len(ct) > len(best_col_to_key):
            best_col_to_key = ct
            best_header_idx = header_idx
    col_to_key = best_col_to_key
    data_start = best_header_idx + 1

    # 매핑이 하나도 없으면 컬럼 순서로 인덱스 폴백 (0=도면접수일, 1=호선, 2=BLOCK, …)
    if not col_to_key and len(rows) > 0:
        num_cols = len(rows[0]) if rows else 0
        col_to_key = {i: FIELDS_13[i] for i in range(min(num_cols, len(FIELDS_13)))}
        data_start = 0  # 첫 행부터 데이터로 간주

    def _cell_to_str(cell: Any) -> str:
        if cell is None:
            return ""
        if hasattr(cell, "isoformat"):
            return cell.isoformat()[:10]
        return str(cell).strip()

    for row in rows[data_start:]:
        record: Dict[str, Any] = {k: "" for k in FIELDS_13}
        for idx, cell in enumerate(row):
            if idx in col_to_key:
                record[col_to_key[idx]] = _cell_to_str(cell)
        if any(record.values()):
            record["id"] = str(uuid.uuid4())
            record["created_at"] = ""
            record["updated_at"] = ""
            records.append(record)
    return records


def _record_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    record = {}
    for key in FIELDS_13:
        record[key] = payload.get(key, "")
    record.setdefault("id", str(uuid.uuid4()))
    record.setdefault("created_at", "")
    record.setdefault("updated_at", "")
    return record


class TraceabilityRecordModule(Module):
    """자재 13대 필드 저장/조회/목록"""

    name = "M_TraceabilityRecord"
    description = "자재 13대 필드 관리 (도면-자재-부품-설치위치 추적)"
    capabilities = [
        "TRACEABILITY_RECORD_SAVE",
        "TRACEABILITY_RECORD_QUERY",
        "TRACEABILITY_RECORD_LIST",
        "TRACEABILITY_RECORD_DELETE",
        "TRACEABILITY_IMPORT_EXCEL",
    ]

    def __init__(self, data_dir: str = ""):
        super().__init__()
        if data_dir:
            os.environ["TRACEABILITY_DATA_DIR"] = data_dir

    def can_handle(self, event: Event) -> float:
        if event.type in (
            "TRACEABILITY_RECORD_SAVE",
            "TRACEABILITY_RECORD_QUERY",
            "TRACEABILITY_RECORD_LIST",
            "TRACEABILITY_RECORD_DELETE",
            "TRACEABILITY_IMPORT_EXCEL",
        ):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "TRACEABILITY_RECORD_SAVE":
            return self._handle_save(event)
        if event.type == "TRACEABILITY_RECORD_QUERY":
            return self._handle_query(event)
        if event.type == "TRACEABILITY_RECORD_LIST":
            return self._handle_list(event)
        if event.type == "TRACEABILITY_RECORD_DELETE":
            return self._handle_delete(event)
        if event.type == "TRACEABILITY_IMPORT_EXCEL":
            return self._handle_import_excel(event)
        return []

    def _handle_save(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        record = _record_from_payload(payload)
        from datetime import datetime
        now = datetime.utcnow().isoformat() + "Z"
        records = _load_records()
        existing_idx = next(
            (i for i, r in enumerate(records) if r.get("id") == record.get("id") or (record.get("pcs_no") and r.get("pcs_no") == record.get("pcs_no"))),
            None,
        )
        if existing_idx is not None:
            record["id"] = records[existing_idx].get("id", record.get("id") or str(uuid.uuid4()))
            record["created_at"] = records[existing_idx].get("created_at", now)
            record["updated_at"] = now
            records[existing_idx] = record
        else:
            record_id = record.get("id") or str(uuid.uuid4())
            record["id"] = record_id
            record["created_at"] = now
            record["updated_at"] = now
            records.append(record)

        _save_records(records)
        return [
            Event(
                type="TRACEABILITY_RECORD_SAVED",
                payload={"success": True, "id": record["id"], "record": record},
                source_module=self.name,
            )
        ]

    def _handle_query(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        pcs_no = payload.get("pcs_no")
        record_id = payload.get("id")
        records = _load_records()
        if pcs_no:
            found = next((r for r in records if r.get("pcs_no") == pcs_no), None)
        elif record_id:
            found = next((r for r in records if r.get("id") == record_id), None)
        else:
            found = None
        return [
            Event(
                type="TRACEABILITY_RECORD_RESULT",
                payload={"found": found is not None, "record": found},
                source_module=self.name,
            )
        ]

    def _handle_list(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        ship_no = payload.get("ship_no")
        block = payload.get("block")
        unit = payload.get("unit")
        limit = int(payload.get("limit", 100))
        records = _load_records()
        if ship_no:
            records = [r for r in records if r.get("ship_no") == ship_no]
        if block:
            records = [r for r in records if r.get("block") == block]
        if unit:
            records = [r for r in records if r.get("unit") == unit]
        records = records[-limit:]
        return [
            Event(
                type="TRACEABILITY_RECORD_LIST_RESULT",
                payload={"records": records, "total": len(records)},
                source_module=self.name,
            )
        ]

    def _handle_delete(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        ids = payload.get("ids") or []
        if not ids:
            return [
                Event(
                    type="TRACEABILITY_RECORD_DELETED",
                    payload={"success": False, "error": "삭제할 항목이 없습니다.", "deleted": 0},
                    source_module=self.name,
                )
            ]
        records = _load_records()
        before = len(records)
        ids_set = set(str(x) for x in ids)
        records = [r for r in records if r.get("id") not in ids_set]
        deleted = before - len(records)
        _save_records(records)
        return [
            Event(
                type="TRACEABILITY_RECORD_DELETED",
                payload={"success": True, "deleted": deleted, "ids": list(ids_set)},
                source_module=self.name,
            )
        ]

    def _handle_import_excel(self, event: Event) -> List[Event]:
        """업로드된 엑셀(excel_base64) 또는 경로(path)로 기초데이터를 읽어 records에 병합."""
        import base64
        import tempfile
        from datetime import datetime

        payload = event.payload or {}
        excel_path: Optional[Path] = None
        from_upload = False

        if payload.get("excel_base64"):
            try:
                raw = base64.b64decode(payload["excel_base64"])
                suffix = ".xlsx"
                fd, temp_path_str = tempfile.mkstemp(suffix=suffix)
                with os.fdopen(fd, "wb") as f:
                    f.write(raw)
                excel_path = Path(temp_path_str)
                from_upload = True
            except Exception as e:
                return [
                    Event(
                        type="TRACEABILITY_IMPORT_DONE",
                        payload={"success": False, "error": f"엑셀 데이터 디코딩 실패: {e}", "imported": 0},
                        source_module=self.name,
                    )
                ]
        else:
            base_path = _base_excel_path()
            if not base_path.exists():
                return [
                    Event(
                        type="TRACEABILITY_IMPORT_DONE",
                        payload={"success": False, "error": "엑셀 파일을 선택해 업로드하세요.", "path": str(base_path), "imported": 0},
                        source_module=self.name,
                    )
                ]
            excel_path = base_path

        try:
            excel_records = _load_records_from_excel(excel_path)
        except Exception as e:
            if from_upload and excel_path and excel_path.exists():
                try:
                    excel_path.unlink()
                except OSError:
                    pass
            return [
                Event(
                    type="TRACEABILITY_IMPORT_DONE",
                    payload={"success": False, "error": str(e), "imported": 0},
                    source_module=self.name,
                )
            ]
        if from_upload and excel_path and excel_path.exists():
            try:
                excel_path.unlink()
            except OSError:
                pass
        if not excel_records:
            return [
                Event(
                    type="TRACEABILITY_IMPORT_DONE",
                    payload={"success": False, "error": "엑셀에서 읽은 행 없음", "imported": 0},
                    source_module=self.name,
                )
            ]
        now = datetime.utcnow().isoformat() + "Z"
        existing = _load_records()
        by_pcs = {r.get("pcs_no"): r for r in existing if r.get("pcs_no")}
        imported = 0
        for r in excel_records:
            r.setdefault("created_at", now)
            r.setdefault("updated_at", now)
            pcs = r.get("pcs_no")
            if pcs and pcs in by_pcs:
                by_pcs[pcs].update(r)
                by_pcs[pcs]["updated_at"] = now
            else:
                r.setdefault("id", str(uuid.uuid4()))
                existing.append(r)
                if pcs:
                    by_pcs[pcs] = r
                imported += 1
        _save_records(existing)
        path_info = payload.get("filename", "uploaded") if from_upload else str(excel_path)
        return [
            Event(
                type="TRACEABILITY_IMPORT_DONE",
                payload={"success": True, "imported": imported, "total": len(existing), "path": path_info},
                source_module=self.name,
            )
        ]
