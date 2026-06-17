"""
M_TraceabilityPdfAnalyzer

목표:
- EVT_PDF_ANALYZED 수신 시 equipment-traceability용 PDF 제안(proposal)을 생성해 저장
- TRACEABILITY_PDF_COMMIT 이벤트 수신 시 proposal을 실제 데이터(records.json, installation_location drawings/points)에 커밋

주의:
- PDF Analysis API의 analysis 스키마는 환경에 따라 달라질 수 있어, 본 모듈은 가능한 키가 있으면 사용하고
  없으면 HITL(검토) 단계에서 보정 가능하도록 “부분 결과”를 남기는 방향으로 동작합니다.
"""

from __future__ import annotations

import csv
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

from SagoHub.core.event import Event
from SagoHub.core.module import Module


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


def _project_root() -> Path:
    mod_dir = Path(__file__).resolve().parent
    return mod_dir.parent.parent


def _traceability_data_dir() -> Path:
    base = os.getenv("TRACEABILITY_DATA_DIR")
    if base:
        return Path(base)
    return _project_root() / "data" / "traceability"


def _pdf_jobs_dir() -> Path:
    d = _traceability_data_dir() / "pdf_jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _records_path() -> Path:
    d = _traceability_data_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "records.json"


def _installation_data_dir() -> Path:
    base = os.getenv("INSTALLATION_LOCATION_DATA_DIR")
    if base:
        return Path(base)
    return _project_root() / "data" / "installation_location"


def _installation_drawings_path() -> Path:
    p = _installation_data_dir() / "drawings.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _installation_uploads_dir() -> Path:
    d = _installation_data_dir() / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _installation_points_path(drawing_id: str) -> Path:
    d = _installation_data_dir() / "points"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{drawing_id}.json"


def _load_records() -> List[Dict[str, Any]]:
    path = _records_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_records(records: List[Dict[str, Any]]) -> None:
    path = _records_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def _load_installation_drawings() -> List[Dict[str, Any]]:
    path = _installation_drawings_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_installation_drawings(drawings: List[Dict[str, Any]]) -> None:
    path = _installation_drawings_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(drawings, f, ensure_ascii=False, indent=2)


def _load_json_list(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_points(drawing_id: str, points: List[Dict[str, Any]]) -> None:
    path = _installation_points_path(drawing_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(points, f, ensure_ascii=False, indent=2)


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _clean_text(s: Any) -> str:
    if s is None:
        return ""
    return str(s).strip()


def _normalize_header_cell(s: Any) -> str:
    v = _clean_text(s).lower()
    # 공백/탭/줄바꿈 제거
    v = re.sub(r"\s+", "", v)
    # 점 제거
    v = v.replace(".", "")
    return v


def _detect_page_kind(text: str) -> str:
    t = text.upper()
    installation_keywords = ["INSTALLATION", "INST DWG", "INSTDWG", "INSTALLATION DWG", "OVERVIEW", "PLAN VIEW"]
    if any(k in t for k in installation_keywords):
        return "installation"
    return "design"


def _extract_drawing_no(text: str) -> str:
    # DRAWING NO / DRAWING NO. / DWG NO 등 여러 형태를 허용
    patterns = [
        r"(?:NAME\s+OF\s+DRAWING)[\s\S]{0,80}?[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_. ]{2,80})",
        r"(?:DRAWING\s*NO|DRAWING\s*NUMBER|DWG\s*NO|DWG\s*NUMBER)[\s\S]{0,30}?[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_.\/ ]{2,60})",
        r"(?:DRAWING\s*NO)[\s\S]{0,30}?[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_.\/ ]{2,60})",
    ]
    for pat in patterns:
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            val = _clean_text(m.group(1))
            # 끝의 불필요 공백/구두점 정리
            return val.strip().strip(",.;:")[:60]
    return ""


def _extract_ship_no(text: str) -> str:
    m = re.search(r"(?:호선|SHIP\s*NO|SHIP\s*NO\.?)\s*[:\-]?\s*([A-Za-z0-9\-]+)", text, flags=re.IGNORECASE)
    if m:
        return _clean_text(m.group(1))[:30]
    return ""


def _try_parse_csv_table(csv_data: str) -> Tuple[List[List[str]], List[str]]:
    """
    csv_data를 파싱하고
    - rows: 전체 행 (str 리스트)
    - header: 헤더 후보(있으면)
    """
    if not csv_data or not isinstance(csv_data, str):
        return [], []
    # csv_data에는 줄바꿈이 포함될 수 있음
    # 쉼표 기반 CSV를 가정하되, 열 구분자가 탭인 경우도 일부 대응
    delim = ","
    # 탭이 많으면 탭을 delim로 추정
    if "\t" in csv_data and csv_data.count("\t") > csv_data.count(","):
        delim = "\t"
    try:
        reader = csv.reader(csv_data.splitlines(), delimiter=delim)
        rows = [[_clean_text(c) for c in r] for r in reader if any(_clean_text(c) for c in r)]
        if not rows:
            return [], []
        # 헤더 행 찾기: POS/MATERIAL/QUANTITY/WEIGHT 키워드가 있는 첫 행
        header_idx = 0
        header_keywords = ("pos", "material", "quantity", "weight", "dwg", "pcs")
        for i, row in enumerate(rows[:5]):
            joined = " ".join([_normalize_header_cell(c) for c in row])
            if any(k in joined for k in header_keywords):
                header_idx = i
                break
        header = rows[header_idx]
        return rows, header
    except Exception:
        return [], []


def _find_column_indices(header: List[str]) -> Dict[str, int]:
    """
    header cell 텍스트에 기반해 column index를 매핑
    """
    out: Dict[str, int] = {}
    if not header:
        return out
    norm = [_normalize_header_cell(h) for h in header]

    def idx_if_any(keys: Iterable[str]) -> Optional[int]:
        for i, cell in enumerate(norm):
            if any(k in cell for k in keys):
                return i
        return None

    pos_idx = idx_if_any(["posno", "posno.", "pos", "position", "pcsno", "pcsno.", "pc", "pcs"])
    mat_idx = idx_if_any(["material", "item", "description", "sec", "part"])
    qty_idx = idx_if_any(["quantity", "qty"])
    weight_idx = idx_if_any(["weight", "wei", "listweight", "listweightkg", "중량", "weightkg", "listweight(kg)"])

    if pos_idx is not None:
        out["pcs_no"] = pos_idx
    if mat_idx is not None:
        out["item"] = mat_idx
    if qty_idx is not None:
        out["quantity"] = qty_idx
    if weight_idx is not None:
        out["list_weight"] = weight_idx
    return out


def _make_record_from_bom_row(
    row: List[str],
    col_map: Dict[str, int],
    dwg_no: str,
    ship_no: str,
) -> Optional[Dict[str, Any]]:
    pcs_no = _clean_text(row[col_map["pcs_no"]]) if "pcs_no" in col_map and col_map["pcs_no"] < len(row) else ""
    item = _clean_text(row[col_map["item"]]) if "item" in col_map and col_map["item"] < len(row) else ""
    quantity = _clean_text(row[col_map["quantity"]]) if "quantity" in col_map and col_map["quantity"] < len(row) else ""
    list_weight = _clean_text(row[col_map["list_weight"]]) if "list_weight" in col_map and col_map["list_weight"] < len(row) else ""

    pcs_no = pcs_no.strip()
    item = item.strip()

    # 최소: 자재 식별이 있어야 함
    if not pcs_no and not item:
        return None

    now = _utc_now_iso()
    rec = {
        "drawing_receipt_date": "",
        "ship_no": ship_no,
        "block": "",
        "unit": "",
        "item": item,
        "pcs_no": pcs_no,
        "installation_location": "",
        "paint_code": "",
        "dwg_no": dwg_no,
        "quantity": quantity,
        "list_weight": list_weight,
        "remarks": "",
        "revision_date_reason": "",
        "id": str(uuid.uuid4()),
        "created_at": "",
        "updated_at": now,
    }
    return rec


def _extract_tag_text_candidates(text: str) -> List[str]:
    # 요구 예시에 맞춘 태그 패턴: SU01, M2C-1-C01 같은 패턴을 허용
    patterns = [
        r"\bSU\d{1,3}[A-Z]?\b",
        r"\bM\d+[A-Z0-9\-]*-C\d{1,3}\b",
        r"\b[A-Z]{1,3}\d{1,4}-C\d{1,3}\b",
        r"\b[A-Z]{1,2}\d{1,4}\b",
    ]
    out: List[str] = []
    seen = set()
    for pat in patterns:
        for m in re.finditer(pat, text, flags=re.IGNORECASE):
            v = m.group(0).upper().strip()
            if v and v not in seen:
                seen.add(v)
                out.append(v)
    return out


def _iter_nested(obj: Any) -> Iterable[Any]:
    if isinstance(obj, dict):
        for v in obj.values():
            yield v
            yield from _iter_nested(v)
    elif isinstance(obj, list):
        for it in obj:
            yield it
            yield from _iter_nested(it)


def _maybe_normalize_xy(x: float, y: float, page_w: float, page_h: float) -> Optional[Tuple[float, float]]:
    try:
        xf = float(x)
        yf = float(y)
    except Exception:
        return None
    if xf == xf and yf == yf:  # not NaN
        # 이미 0~1 정규화 같으면 그대로 사용
        if 0.0 <= xf <= 1.0 and 0.0 <= yf <= 1.0:
            return xf, yf
        if page_w > 0 and page_h > 0:
            if xf >= 0 and yf >= 0:
                return max(0.0, min(1.0, xf / page_w)), max(0.0, min(1.0, yf / page_h))
    return None


def _extract_tag_boxes(page: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    analysis의 page 객체에서 tag 텍스트와 좌표를 최대한 찾아냄.
    좌표 키/스키마가 불명확하므로 bbox/x/y 등 다양한 형태를 추정.
    """
    out: List[Dict[str, Any]] = []

    page_w = float(page.get("width") or page.get("page_width") or 0) if isinstance(page.get("width") or page.get("page_width"), (int, float)) else 0
    page_h = float(page.get("height") or page.get("page_height") or 0) if isinstance(page.get("height") or page.get("page_height"), (int, float)) else 0

    # bbox 스케일 추정을 위해 간단 스캔
    max_x = 0.0
    max_y = 0.0
    for node in _iter_nested(page):
        if not isinstance(node, dict):
            continue
        bbox = node.get("bbox") or node.get("box") or node.get("bounding_box")
        if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
            try:
                x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
                max_x = max(max_x, x1, x2)
                max_y = max(max_y, y1, y2)
            except Exception:
                continue

    if page_w <= 0:
        page_w = max_x if max_x > 0 else 0
    if page_h <= 0:
        page_h = max_y if max_y > 0 else 0

    def get_text(node: Dict[str, Any]) -> str:
        for k in ("text", "value", "content", "label", "token"):
            if k in node and isinstance(node[k], str) and node[k].strip():
                return node[k]
        return ""

    for node in _iter_nested(page):
        if not isinstance(node, dict):
            continue
        txt = get_text(node)
        if not txt:
            continue
        cand = txt.upper().strip()
        if not cand:
            continue
        if not re.search(r"(SU\d{1,3}[A-Z]?\b)|(M\d+[A-Z0-9\-]*-C\d{1,3}\b)", cand, flags=re.IGNORECASE):
            continue

        bbox = node.get("bbox") or node.get("box") or node.get("bounding_box")
        if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
            try:
                x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                norm = _maybe_normalize_xy(cx, cy, page_w, page_h) if page_w > 0 and page_h > 0 else None
                if norm is None and (0.0 <= x1 <= 1.0 and 0.0 <= y1 <= 1.0):
                    norm = (x1, y1)
                if norm:
                    out.append({"tag": cand, "x": norm[0], "y": norm[1], "confidence": node.get("confidence")})
            except Exception:
                continue
            continue

        # bbox가 없고 x/y만 있는 경우
        x = node.get("x")
        y = node.get("y")
        if isinstance(x, (int, float)) and isinstance(y, (int, float)):
            norm = _maybe_normalize_xy(float(x), float(y), page_w, page_h) if page_w > 0 and page_h > 0 else _maybe_normalize_xy(float(x), float(y), 1.0, 1.0)
            if norm:
                out.append({"tag": cand, "x": norm[0], "y": norm[1], "confidence": node.get("confidence")})

    return out


def _try_extract_page_image_base64(page: Dict[str, Any]) -> Optional[str]:
    """
    analysis 스키마가 불명확하므로 가능한 base64 키들을 열거.
    반환값은 순수 base64 문자열(데이터 URI 접두 제거) 또는 None.
    """
    for k in (
        "image_base64",
        "image",
        "page_image_base64",
        "rendered_image_base64",
        "png_base64",
        "jpg_base64",
    ):
        v = page.get(k) if isinstance(page, dict) else None
        if isinstance(v, str) and len(v) > 100:
            if v.startswith("data:") and "base64," in v:
                return v.split("base64,", 1)[1]
            # 이미 data uri가 아닌 순수 base64로 가정
            return v
    return None


def _save_base64_image_as_png(image_base64: str, dst_path: Path) -> None:
    raw = base64.b64decode(image_base64)
    dst_path.write_bytes(raw)


def _safe_filename(s: str) -> str:
    s2 = re.sub(r"[^A-Za-z0-9_.\-]+", "_", s.strip())
    return s2[:120] if s2 else str(uuid.uuid4())


class TraceabilityPdfAnalyzerModule(Module):
    name = "M_TraceabilityPdfAnalyzer"
    description = "EVT_PDF_ANALYZED -> PDF 제안 생성 / TRACEABILITY_PDF_COMMIT -> 커밋"
    capabilities = ["EVT_PDF_ANALYZED", "TRACEABILITY_PDF_COMMIT", "TRACEABILITY_PDF_REVIEW_READY", "TRACEABILITY_PDF_COMMIT_DONE"]

    # UI에서 너무 큰 데이터를 못 받는 것을 고려
    PREVIEW_RECORDS_LIMIT = int(os.getenv("TRACEABILITY_PDF_PREVIEW_RECORDS_LIMIT", "80"))

    def can_handle(self, event: Event) -> float:
        return 1.0 if event.type in ("EVT_PDF_ANALYZED", "TRACEABILITY_PDF_COMMIT") else 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "EVT_PDF_ANALYZED":
            return self._handle_analyzed(event)
        if event.type == "TRACEABILITY_PDF_COMMIT":
            return self._handle_commit(event)
        return []

    def _job_path(self, job_id: str) -> Path:
        return _pdf_jobs_dir() / f"{job_id}.json"

    def _handle_analyzed(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        analysis = payload.get("analysis") or {}
        success = bool(payload.get("success", False)) and bool(analysis.get("success", True) or analysis.get("success") is None)
        if not success:
            job_id = _clean_text(payload.get("stem") or payload.get("job_id") or "") or str(uuid.uuid4())
            return [
                Event(
                    type="TRACEABILITY_PDF_REVIEW_READY",
                    payload={"success": False, "job_id": job_id, "error": "PDF 분석 실패"},
                    source_module=self.name,
                )
            ]

        job_id = _clean_text(payload.get("stem") or payload.get("job_id") or "")
        if not job_id:
            job_id = str(uuid.uuid4())

        pdf_path = payload.get("file_path") or ""
        filename = payload.get("filename") or f"{job_id}.pdf"
        created_at = _utc_now_iso()

        pages = analysis.get("pages") or []
        if not isinstance(pages, list):
            pages = []

        # --------- 1) 페이지 분류 + BOM/태그 추출 ----------
        records: List[Dict[str, Any]] = []
        record_dedupe: Dict[str, int] = {}  # pcs_no -> idx in records

        design_drawings: List[Dict[str, Any]] = []
        installation_drawings: List[Dict[str, Any]] = []

        ship_no_global = _extract_ship_no("\n".join([_clean_text(p.get("text") or "") for p in pages if isinstance(p, dict)]))

        # 매 페이지마다 dwg_no를 찾고, 설치/설계를 분리
        design_idx = 0
        inst_idx = 0

        for page in pages:
            if not isinstance(page, dict):
                continue
            page_text = _clean_text(page.get("text") or "")
            page_kind = _detect_page_kind(page_text)
            dwg_no = _extract_drawing_no(page_text)
            if page_kind == "design" and not dwg_no:
                dwg_no = f"DWG-{design_idx+1}"
            if page_kind == "installation" and not dwg_no:
                dwg_no = f"INST-{inst_idx+1}"

            page_num = page.get("page_number")
            try:
                page_num = int(page_num) if page_num is not None else None
            except Exception:
                page_num = None

            if page_kind == "design":
                design_idx += 1
                # BOM 추출
                tables = page.get("tables") or []
                if not isinstance(tables, list):
                    tables = []
                # 설계도면의 BOM이 없을 수 있으므로, tables 없으면 건너뛰되 drawing entry는 만든다.
                design_drawings.append(
                    {
                        "drawing_id": str(uuid.uuid4()),
                        "dwg_no": dwg_no,
                        "filename": str(filename),
                        "file_type": "pdf",
                        "file_path": "",  # commit 단계에서 설정
                        "source": {"page_number": page_num, "kind": "design"},
                    }
                )
                if not tables:
                    continue

                for tbl in tables:
                    if not isinstance(tbl, dict):
                        continue
                    csv_data = tbl.get("csv_data") or tbl.get("csv") or ""
                    rows, header = _try_parse_csv_table(str(csv_data))
                    if not rows:
                        continue
                    col_map = _find_column_indices(header)
                    # fallback: 헤더 매핑 실패 시 4열 고정 추정
                    if not col_map and rows:
                        col_map = {"pcs_no": 0, "item": 1, "quantity": 2, "list_weight": 3}

                    # 헤더 행 제외: header 길이의 첫 행을 스킵하기 위해 header가 실제 행인지 확인
                    header_norm = [_normalize_header_cell(c) for c in header] if header else []
                    header_idx = 0
                    for i, r in enumerate(rows[:5]):
                        joined = " ".join([_normalize_header_cell(c) for c in r])
                        if any(k in joined for k in ("pos", "material", "quantity", "weight")):
                            header_idx = i
                            break

                    for row in rows[header_idx + 1 :]:
                        rec = _make_record_from_bom_row(row, col_map, dwg_no=dwg_no, ship_no=ship_no_global)
                        if not rec:
                            continue
                        pcs_no = rec.get("pcs_no") or ""
                        if pcs_no:
                            # pcs_no 기준 dedupe/upsert(제안 단계)
                            if pcs_no in record_dedupe:
                                idx = record_dedupe[pcs_no]
                                # dwg_no가 비어있거나 다를 때는 최신 proposal 우선
                                for k in FIELDS_13:
                                    if k != "installation_location":
                                        if rec.get(k):
                                            records[idx][k] = rec.get(k, records[idx].get(k, ""))
                            else:
                                record_dedupe[pcs_no] = len(records)
                                records.append(rec)
                        else:
                            # pcs_no 없으면 레코드를 그냥 추가(단, 커밋 시 덜 유용)
                            records.append(rec)

            else:
                # installation 페이지
                inst_idx += 1
                drawing_id = str(uuid.uuid4())
                page_kind_text = page_text.upper()
                # 태그 후보 추출(좌표가 없을 수 있으니 텍스트 기반 fallback)
                tag_candidates = _extract_tag_text_candidates(page_text)

                tag_boxes = _extract_tag_boxes(page)
                points: List[Dict[str, Any]] = []

                # 좌표가 있는 후보가 있으면 그걸 우선
                if tag_boxes:
                    # tag_boxes에서 같은 태그 중복은 거리 기준으로 줄임(간단히 dedupe)
                    seen_pairs = set()
                    for i, tb in enumerate(tag_boxes):
                        tag = _clean_text(tb.get("tag")).upper()
                        x = tb.get("x")
                        y = tb.get("y")
                        if not tag or x is None or y is None:
                            continue
                        key = (tag, round(float(x), 5), round(float(y), 5))
                        if key in seen_pairs:
                            continue
                        seen_pairs.add(key)
                        points.append(
                            {
                                "id": f"p-{drawing_id[:8]}-{i}",
                                "x": float(x),
                                "y": float(y),
                                "pcs_no": tag,
                                "record_id": "",
                                "label": "",
                                "detected": True,
                                "confidence": tb.get("confidence"),
                            }
                        )
                else:
                    # 좌표가 없는 경우: x/y 없이도 points proposal을 만들어 HITL 보정 가능하게 함
                    for i, tag in enumerate(tag_candidates[:200]):
                        points.append(
                            {
                                "id": f"p-{drawing_id[:8]}-{i}",
                                "x": 0.0,
                                "y": 0.0,
                                "pcs_no": tag,
                                "record_id": "",
                                "label": "",
                                "detected": False,
                                "confidence": None,
                            }
                        )

                installation_drawings.append(
                    {
                        "drawing_id": drawing_id,
                        "dwg_no": dwg_no,
                        "filename": str(filename),
                        "file_type": "pdf",  # commit 단계에서 page image가 있으면 image로 변경 시도
                        "file_path": "",
                        "source": {"page_number": page_num, "kind_text": page_kind_text},
                        "points": points,
                    }
                )

        # --------- 2) proposal 저장 ----------
        proposal_obj: Dict[str, Any] = {
            "records": records,
            "design_drawings": design_drawings,
            "installation_drawings": installation_drawings,
        }

        # UI preview용 축약
        preview_records = records[: self.PREVIEW_RECORDS_LIMIT]
        summary = {
            "records_total": len(records),
            "preview_records": len(preview_records),
            "design_drawings_total": len(design_drawings),
            "installation_drawings_total": len(installation_drawings),
            "installation_points_total": sum(len(d.get("points") or []) for d in installation_drawings if isinstance(d, dict)),
        }

        proposal_path = self._job_path(job_id)
        proposal_path.parent.mkdir(parents=True, exist_ok=True)
        proposal_path.write_text(
            json.dumps(
                {
                    "job_id": job_id,
                    "created_at": created_at,
                    "source_pdf": {"file_path": pdf_path, "filename": filename},
                    "proposal": proposal_obj,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        return [
            Event(
                type="TRACEABILITY_PDF_REVIEW_READY",
                payload={
                    "success": True,
                    "job_id": job_id,
                    "summary": summary,
                    "preview_records": preview_records,
                    "installation_drawings_preview": [
                        {
                            "drawing_id": d.get("drawing_id"),
                            "dwg_no": d.get("dwg_no"),
                            "page_number": (d.get("source") or {}).get("page_number"),
                            "points_count": len(d.get("points") or []),
                        }
                        for d in installation_drawings
                    ],
                },
                source_module=self.name,
            )
        ]

    def _handle_commit(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        job_id = _clean_text(payload.get("job_id") or "")
        if not job_id:
            return [
                Event(
                    type="TRACEABILITY_PDF_COMMIT_DONE",
                    payload={"success": False, "job_id": job_id, "error": "job_id가 필요합니다."},
                    source_module=self.name,
                )
            ]

        job_path = self._job_path(job_id)
        if not job_path.exists():
            return [
                Event(
                    type="TRACEABILITY_PDF_COMMIT_DONE",
                    payload={"success": False, "job_id": job_id, "error": "proposal 파일을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]

        record_overrides = payload.get("record_overrides") or []
        if not isinstance(record_overrides, list):
            record_overrides = []

        try:
            job_data = json.loads(job_path.read_text(encoding="utf-8"))
        except Exception as e:
            return [
                Event(
                    type="TRACEABILITY_PDF_COMMIT_DONE",
                    payload={"success": False, "job_id": job_id, "error": f"proposal 로드 실패: {e}"},
                    source_module=self.name,
                )
            ]

        proposal = job_data.get("proposal") or {}
        extracted_records: List[Dict[str, Any]] = proposal.get("records") or []
        design_drawings: List[Dict[str, Any]] = proposal.get("design_drawings") or []
        installation_drawings: List[Dict[str, Any]] = proposal.get("installation_drawings") or []

        # overrides 적용(제안 단계 레코드 id 기준)
        override_by_id = {(_clean_text(r.get("id"))): r for r in record_overrides if isinstance(r, dict) and r.get("id")}
        for rec in extracted_records:
            rid = _clean_text(rec.get("id"))
            if rid and rid in override_by_id:
                ov = override_by_id[rid]
                for k in FIELDS_13:
                    if k in ov:
                        rec[k] = ov.get(k, rec.get(k, ""))

        # --------- 1) records.json 업서트 ----------
        records_existing = _load_records()
        by_pcs_no: Dict[str, Dict[str, Any]] = {}
        by_id: Dict[str, Dict[str, Any]] = {}
        for r in records_existing:
            if not isinstance(r, dict):
                continue
            if r.get("pcs_no"):
                by_pcs_no[str(r.get("pcs_no"))] = r
            if r.get("id"):
                by_id[str(r.get("id"))] = r

        updated_at = _utc_now_iso()
        inserted = 0
        updated = 0

        for rec in extracted_records:
            pcs_no = _clean_text(rec.get("pcs_no"))
            if not pcs_no:
                # pcs_no 없는 레코드는 커밋에 포함하지 않음(조회/매핑이 불가능)
                continue
            if pcs_no in by_pcs_no:
                target = by_pcs_no[pcs_no]
                for k in FIELDS_13:
                    if k == "installation_location":
                        # installation mapping은 아래 설치도면 포인트 커밋 이후에 다시 덮어씀
                        continue
                    val = rec.get(k, "")
                    if val != "":
                        target[k] = val
                target["updated_at"] = updated_at
                updated += 1
            else:
                new_rec = {k: rec.get(k, "") for k in FIELDS_13}
                new_rec["id"] = rec.get("id") or str(uuid.uuid4())
                new_rec["created_at"] = rec.get("created_at") or ""
                new_rec["updated_at"] = updated_at
                records_existing.append(new_rec)
                by_pcs_no[pcs_no] = new_rec
                inserted += 1

        # --------- 2) installation_location drawings/points 생성 ----------
        drawings_existing = _load_installation_drawings()
        drawing_by_id = {d.get("id"): d for d in drawings_existing if isinstance(d, dict) and d.get("id")}

        # design drawings: dwg_no로 record 연결을 위해 entry 필요
        # installation_drawings는 포인트 좌표/pcs_no를 함께 저장
        uploads_dir = _installation_uploads_dir()

        pdf_source_path = (job_data.get("source_pdf") or {}).get("file_path") or ""
        if not pdf_source_path:
            pdf_source_path = ""

        def copy_pdf_to_uploads(job_id_prefix: str, dst_name: str) -> Optional[str]:
            if not pdf_source_path or not os.path.exists(pdf_source_path):
                return None
            dst = uploads_dir / dst_name
            try:
                dst.write_bytes(Path(pdf_source_path).read_bytes())
                return f"uploads/{dst.name}"
            except Exception:
                return None

        # design drawings 커밋
        # UI는 record.dwg_no로 drawings.json을 선형 검색(find)하므로,
        # 같은 dwg_no가 이미 있으면 해당 entry를 업데이트해서 "첫 매칭"이 최신 파일을 가리키게 한다.
        for d in design_drawings:
            if not isinstance(d, dict):
                continue
            drawing_id = d.get("drawing_id") or str(uuid.uuid4())
            dwg_no = d.get("dwg_no") or ""
            safe_name = _safe_filename(d.get("filename") or f"{dwg_no}.pdf")
            # uploads에 저장 파일명은 drawing_id 기반이 안전
            uploads_rel = copy_pdf_to_uploads(job_id, f"{drawing_id}.pdf") if pdf_source_path else None
            existing_same_dwg = next((x for x in drawings_existing if isinstance(x, dict) and (x.get("dwg_no") or "").strip() == dwg_no.strip()), None)
            if existing_same_dwg is not None:
                existing_same_dwg.update(
                    {
                        "dwg_no": dwg_no,
                        "filename": safe_name,
                        "file_type": "pdf",
                        "file_path": uploads_rel or existing_same_dwg.get("file_path") or "",
                        "updated_at": updated_at,
                    }
                )
                drawing_by_id[str(existing_same_dwg.get("id"))] = existing_same_dwg
            else:
                drawing = {
                    "id": drawing_id,
                    "dwg_no": dwg_no,
                    "filename": safe_name,
                    "file_type": "pdf",
                    "file_path": uploads_rel or "",
                    "created_at": updated_at,
                    "updated_at": updated_at,
                }
                drawings_existing.append(drawing)
                drawing_by_id[drawing_id] = drawing

        # installation drawings 커밋
        installation_drawings_ids: List[str] = []
        for d in installation_drawings:
            if not isinstance(d, dict):
                continue
            drawing_id = d.get("drawing_id") or str(uuid.uuid4())
            dwg_no = d.get("dwg_no") or ""
            installation_drawings_ids.append(drawing_id)
            safe_name = _safe_filename(d.get("filename") or f"{dwg_no}.pdf")
            uploads_rel = copy_pdf_to_uploads(job_id, f"{drawing_id}.pdf") if pdf_source_path else None
            drawing = {
                "id": drawing_id,
                "dwg_no": dwg_no,
                "filename": safe_name,
                "file_type": "pdf",
                "file_path": uploads_rel or "",
                "created_at": updated_at,
                "updated_at": updated_at,
            }
            if drawing_id in drawing_by_id:
                drawing_by_id[drawing_id].update(drawing)
            else:
                drawings_existing.append(drawing)
                drawing_by_id[drawing_id] = drawing

            points = d.get("points") or []
            normalized_points: List[Dict[str, Any]] = []
            for p in points:
                if not isinstance(p, dict):
                    continue
                # 0~1 정규화만 유지. 값이 비정상이면 0으로.
                x = p.get("x", 0.0)
                y = p.get("y", 0.0)
                try:
                    xf = float(x)
                    yf = float(y)
                except Exception:
                    xf = 0.0
                    yf = 0.0
                normalized_points.append(
                    {
                        "id": str(p.get("id") or f"p-{uuid.uuid4()}"),
                        "x": max(0.0, min(1.0, xf)),
                        "y": max(0.0, min(1.0, yf)),
                        "pcs_no": _clean_text(p.get("pcs_no") or ""),
                        "record_id": _clean_text(p.get("record_id") or ""),
                        "label": _clean_text(p.get("label") or ""),
                    }
                )
            _save_points(drawing_id, normalized_points)

        # --------- 3) installation_location 필드 업데이트 ----------
        # 포인트의 pcs_no에 해당하는 record의 installation_location을 설치도면 ID로 설정
        records_by_pcs = {r.get("pcs_no"): r for r in records_existing if isinstance(r, dict) and r.get("pcs_no")}
        points_count = 0
        for d in installation_drawings:
            if not isinstance(d, dict):
                continue
            drawing_id = d.get("drawing_id") or ""
            if not drawing_id:
                continue
            points = d.get("points") or []
            for p in points:
                if not isinstance(p, dict):
                    continue
                pcs_no = _clean_text(p.get("pcs_no"))
                if not pcs_no:
                    continue
                rec = records_by_pcs.get(pcs_no)
                if rec is None:
                    # BOM에서 없을 수 있으므로 placeholder record 생성
                    placeholder = {k: "" for k in FIELDS_13}
                    placeholder["pcs_no"] = pcs_no
                    placeholder["id"] = str(uuid.uuid4())
                    placeholder["created_at"] = ""
                    placeholder["updated_at"] = updated_at
                    rec = placeholder
                    records_existing.append(rec)
                    records_by_pcs[pcs_no] = rec
                rec["installation_location"] = f"도면 ID: {drawing_id}"
                rec["updated_at"] = updated_at
                points_count += 1

        _save_records(records_existing)
        _save_installation_drawings(drawings_existing)

        return [
            Event(
                type="TRACEABILITY_PDF_COMMIT_DONE",
                payload={
                    "success": True,
                    "job_id": job_id,
                    "inserted_records": inserted,
                    "updated_records": updated,
                    "installation_points_committed": points_count,
                },
                source_module=self.name,
            )
        ]


# 내부 helper: base64 사용을 위해 import를 함수 아래에 둠(위에서 lazy)
import base64  # noqa: E402

