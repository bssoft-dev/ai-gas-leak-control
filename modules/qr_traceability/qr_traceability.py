"""
M_QRTraceability: QR코드 기반 다계층 추적 모듈
- QR 데이터 구조: PCS No. + 설치위치 + 자재정보 + 도면번호 + ERP 링크
- QR_CODE_GENERATE: 레코드/페이로드로부터 QR 인코딩용 문자열 생성
- QR_CODE_PARSE: QR 문자열 파싱 후 추적 정보 반환
"""
from __future__ import annotations

import json
import urllib.parse
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# QR 페이로드 구분자 (바코드 대비 10배 데이터 수용 활용)
QR_VERSION = "T1"  # Traceability v1
SEP = "|"

# Equipment Traceability 서비스의 13대 필드 (README 기준)
FIELDS_13 = [
    "drawing_receipt_date",
    "ship_no",
    "block",
    "unit",
    "item",
    "pcs_no",
    "installation_location",
    "paint_code",
    "dwg_no",
    "quantity",
    "list_weight",
    "remarks",
    "revision_date_reason",
]


def _trim(v: Any, max_len: int) -> str:
    s = "" if v is None else str(v)
    s = s.strip()
    if len(s) <= max_len:
        return s
    return s[:max_len]


def _build_fields_13_from_record(record: Optional[Dict[str, Any]], max_per_field: int = 60) -> Dict[str, str]:
    record = record or {}
    # QR 용량을 고려해 각 필드를 충분히 짧게 자릅니다.
    # (필수는 아니지만 "아래 정보 포함" 요구를 만족하도록 대부분 필드를 담습니다.)
    out: Dict[str, str] = {}
    for k in FIELDS_13:
        # 최종 키는 README의 영문 키를 그대로 사용
        out[k] = _trim(record.get(k, ""), max_per_field)
    return out


def _build_material_info_json(record: Optional[Dict[str, Any]], target_len: int = 220) -> str:
    """
    QR 문자열 파트로 들어가는 JSON(material_info) 길이를 제한하되,
    중간 절단이 아닌 '필드별 길이 축소'로 항상 유효한 JSON이 되도록 구성합니다.
    """
    if not record:
        return "{}"
    for max_per_field in (60, 40, 30, 20, 15, 10):
        fields_13 = _build_fields_13_from_record(record, max_per_field=max_per_field)
        s = json.dumps(fields_13, ensure_ascii=False, separators=(",", ":"))
        if len(s) <= target_len:
            return s
    # 그래도 너무 길면 마지막으로 더 작은 값으로 만들고, (여전히) 유효 JSON을 반환합니다.
    fields_13 = _build_fields_13_from_record(record, max_per_field=10)
    return json.dumps(fields_13, ensure_ascii=False, separators=(",", ":"))


def _build_qr_payload(
    pcs_no: str = "",
    installation_location: str = "",
    material_info: str = "",
    drawing_no: str = "",
    erp_link: str = "",
    record: Optional[Dict[str, Any]] = None,
) -> str:
    """QR에 담을 문자열 생성. record가 있으면 13대 필드에서 추출."""
    if record:
        pcs_no = pcs_no or record.get("pcs_no", "")
        installation_location = installation_location or record.get("installation_location", "")
        drawing_no = drawing_no or record.get("dwg_no", "")
        erp_link = erp_link or record.get("erp_link", "")

        # "그룹 이름 없음": 필드를 그룹핑하지 않고 JSON으로 담습니다.
        # QR 문자열 파싱 시에도 material_info(4번째 파트)를 JSON으로 되돌릴 수 있습니다.
        material_info = material_info or _build_material_info_json(record, target_len=220)
    parts = [QR_VERSION, pcs_no, installation_location, material_info, drawing_no, erp_link]
    encoded = SEP.join(urllib.parse.quote(str(p), safe="") for p in parts)
    return encoded


def _parse_qr_payload(payload_str: str) -> Dict[str, Any]:
    """QR 문자열 파싱 → 추적 정보 딕셔너리"""
    try:
        decoded = [urllib.parse.unquote(p) for p in payload_str.split(SEP)]
        if len(decoded) >= 5:
            material_info_str = decoded[3] if len(decoded) > 3 else ""
            parsed: Dict[str, Any] = {
                "version": decoded[0] if decoded[0] else None,
                "pcs_no": decoded[1] if len(decoded) > 1 else "",
                "installation_location": decoded[2] if len(decoded) > 2 else "",
                "material_info": material_info_str,
                "drawing_no": decoded[4] if len(decoded) > 4 else "",
                "erp_link": decoded[5] if len(decoded) > 5 else "",
            }
            # 요구사항: DWG_no(도면번호)도 함께 제공 (호환)
            if parsed.get("drawing_no") and not parsed.get("dwg_no"):
                parsed["dwg_no"] = parsed.get("drawing_no")

            # material_info 안에 13대 필드 JSON이 들어있다면, 파싱해서 평탄화
            try:
                maybe_obj = json.loads(material_info_str)
                if isinstance(maybe_obj, dict):
                    parsed["material_fields_13"] = maybe_obj
                    # 평탄화(중복 키는 우선순위 없이 덮어쓰지 않음)
                    for k, v in maybe_obj.items():
                        parsed.setdefault(k, v)
            except Exception:
                pass

            return parsed
    except Exception:
        pass
    return {}


class QRTraceabilityModule(Module):
    """QR코드 기반 다계층 추적 (PCS No + 설치위치 + 자재 + 도면 + ERP 링크)"""

    name = "M_QRTraceability"
    description = "QR코드 데이터 구조 생성/파싱 (다계층 추적용)"
    capabilities = ["QR_CODE_GENERATE", "QR_CODE_PARSE"]

    def __init__(self):
        super().__init__()

    def can_handle(self, event: Event) -> float:
        if event.type in ("QR_CODE_GENERATE", "QR_CODE_PARSE"):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "QR_CODE_GENERATE":
            return self._handle_generate(event)
        if event.type == "QR_CODE_PARSE":
            return self._handle_parse(event)
        return []

    def _handle_generate(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        record = payload.get("record")
        fields_13 = _build_fields_13_from_record(record, max_per_field=60) if record else {}
        material_info_json = _build_material_info_json(record, target_len=220) if record else ""
        qr_str = _build_qr_payload(
            pcs_no=payload.get("pcs_no", ""),
            installation_location=payload.get("installation_location", ""),
            material_info=payload.get("material_info", ""),
            drawing_no=payload.get("drawing_no", ""),
            erp_link=payload.get("erp_link", ""),
            record=record,
        )
        # JSON 형태로도 제공 (클라이언트에서 QR 이미지 생성 시 사용)
        dwg_no = (record.get("dwg_no", "") if record else payload.get("drawing_no", "")) if (record or payload) else ""
        qr_json = {
            "version": QR_VERSION,
            # README/요구사항 기준 필드(그룹 이름 없이 flat 형태)
            "drawing_receipt_date": (fields_13.get("drawing_receipt_date") if fields_13 else payload.get("drawing_receipt_date", "")),
            "ship_no": (fields_13.get("ship_no") if fields_13 else payload.get("ship_no", "")),
            "block": (fields_13.get("block") if fields_13 else payload.get("block", "")),
            "unit": (fields_13.get("unit") if fields_13 else payload.get("unit", "")),
            "item": (fields_13.get("item") if fields_13 else payload.get("item", "")),
            "pcs_no": (fields_13.get("pcs_no") if fields_13 else payload.get("pcs_no", "")),
            "installation_location": (fields_13.get("installation_location") if fields_13 else payload.get("installation_location", "")),
            "paint_code": (fields_13.get("paint_code") if fields_13 else payload.get("paint_code", "")),
            "dwg_no": (fields_13.get("dwg_no") if fields_13 else payload.get("drawing_no", "")),
            "quantity": (fields_13.get("quantity") if fields_13 else payload.get("quantity", "")),
            "list_weight": (fields_13.get("list_weight") if fields_13 else payload.get("list_weight", "")),
            "remarks": (fields_13.get("remarks") if fields_13 else payload.get("remarks", "")),
            "revision_date_reason": (fields_13.get("revision_date_reason") if fields_13 else payload.get("revision_date_reason", "")),
            # 기존 호환 키
            "drawing_no": dwg_no,
            "material_info": payload.get("material_info", "") or material_info_json,
            "erp_link": payload.get("erp_link", ""),
        }
        return [
            Event(
                type="QR_CODE_PAYLOAD_READY",
                payload={
                    "qr_string": qr_str,
                    "qr_json": qr_json,
                    "request_id": payload.get("request_id"),
                },
                source_module=self.name,
            )
        ]

    def _handle_parse(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        qr_string = payload.get("qr_string", "")
        parsed = _parse_qr_payload(qr_string)
        return [
            Event(
                type="QR_CODE_PARSED",
                payload={
                    "parsed": parsed,
                    "request_id": payload.get("request_id"),
                },
                source_module=self.name,
            )
        ]
