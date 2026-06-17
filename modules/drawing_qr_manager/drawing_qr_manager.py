"""
M_DrawingQrManager: QR 기반 도면(제작/설치) 그룹 관리
- PDF 업로드 시 페이지별 단일 PDF 저장 및 QR 페이로드(DQ|1|<page_id>) 부여
- 그룹(이름, 사양) 및 제작/설치 도면 연결
"""
from __future__ import annotations

import base64
import binascii
import io
import json
import os
import re
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    PdfReader = None  # type: ignore
    PdfWriter = None  # type: ignore

QR_PREFIX = "DQ"
QR_VERSION = "1"


def _bytes_from_pdf_base64_field(b64: Any) -> bytes:
    """프론트/게이트웨이에서 온 base64(data URL 포함)를 바이트로 복원."""
    if b64 is None:
        return b""
    if isinstance(b64, (bytes, bytearray)):
        return bytes(b64)
    s = str(b64).strip()
    if not s:
        return b""
    low = s[: min(80, len(s))].lower()
    if "," in s and "base64" in low:
        s = s.split(",", 1)[1].strip()
    s = re.sub(r"\s+", "", s)
    pad = (-len(s)) % 4
    if pad:
        s += "=" * pad
    try:
        try:
            return base64.b64decode(s, validate=False)
        except TypeError:
            return base64.b64decode(s)
    except (binascii.Error, ValueError):
        pass
    try:
        try:
            return base64.urlsafe_b64decode(s, validate=False)
        except TypeError:
            return base64.urlsafe_b64decode(s)
    except (binascii.Error, ValueError):
        return b""


def _trim_to_pdf_start(raw: bytes) -> bytes:
    """BOM·선행 공백·바이너리 앞부분 잡음 뒤에 오는 %PDF 헤더까지 잘라냄."""
    if not raw:
        return raw
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    raw = raw.lstrip(b" \t\r\n\x00")
    if raw.startswith(b"%PDF"):
        return raw
    search_len = min(len(raw), 65536)
    idx = raw.find(b"%PDF", 0, search_len)
    if idx >= 0:
        return raw[idx:]
    return raw


def _read_pdf_from_temp_relpath(rel: str) -> Tuple[bytes, Path]:
    """UI 서버가 저장한 incoming/{uuid}.pdf 를 읽습니다. 보안: 경로 고정 패턴만 허용."""
    rel = (rel or "").strip().replace("\\", "/")
    if not rel.startswith("incoming/") or ".." in rel or rel.startswith("/"):
        raise ValueError("잘못된 임시 파일 경로입니다.")
    basename = rel.split("/")[-1]
    if not re.match(r"^[0-9a-fA-F-]{36}\.pdf$", basename, re.I):
        raise ValueError("잘못된 임시 파일 이름입니다.")
    path = _data_root() / rel
    path = path.resolve()
    incoming_root = (_data_root() / "incoming").resolve()
    try:
        path.relative_to(incoming_root)
    except ValueError:
        raise ValueError("잘못된 임시 파일 경로입니다.") from None
    if not path.is_file():
        raise ValueError("업로드 임시 파일을 찾을 수 없습니다.")
    return path.read_bytes(), path


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _data_root() -> Path:
    base = os.getenv("DRAWING_QR_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "drawing_qr"


def _catalog_path() -> Path:
    p = _data_root() / "catalog.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _pages_dir() -> Path:
    d = _data_root() / "pages"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _images_dir() -> Path:
    d = _data_root() / "images"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _page_image_path(page_id: str) -> Path:
    return _images_dir() / f"{page_id}.png"


def _render_page_pdf_to_png(page_pdf_path: Path, page_id: str, dpi: int = 140) -> Path:
    """
    1페이지짜리 PDF를 PNG로 렌더링합니다.
    - poppler의 pdftoppm 명령을 사용합니다.
    """
    dst = _page_image_path(page_id)
    if dst.exists() and dst.stat().st_size > 0:
        return dst

    if not shutil.which("pdftoppm"):
        raise RuntimeError("pdftoppm 명령이 없어 PNG 렌더링이 불가합니다.")

    out_prefix = _images_dir() / page_id
    # pdftoppm 출력은 {out_prefix}-1.png 형태입니다.
    cmd = ["pdftoppm", "-png", "-r", str(dpi), str(page_pdf_path), str(out_prefix)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"PDF->PNG 변환 실패: {proc.stderr or proc.stdout or str(proc)}")

    rendered = _images_dir() / f"{page_id}-1.png"
    if not rendered.exists():
        # 일부 환경에서 출력명이 다를 수 있으므로 폴백
        candidates = list(_images_dir().glob(f"{page_id}-*.png"))
        if candidates:
            rendered = sorted(candidates)[0]
        else:
            raise RuntimeError("PNG 렌더링 결과 파일을 찾을 수 없습니다.")

    # out_prefix-1.png를 고정 경로로 옮깁니다.
    if rendered.resolve() != dst.resolve():
        rendered.replace(dst)
    return dst


def _load_catalog() -> Dict[str, Any]:
    path = _catalog_path()
    if not path.exists():
        return {"pages": [], "groups": [], "uploads": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"pages": [], "groups": [], "uploads": []}
        for k in ("pages", "groups", "uploads"):
            if k not in data or not isinstance(data[k], list):
                data[k] = []
        return data
    except (json.JSONDecodeError, OSError):
        return {"pages": [], "groups": [], "uploads": []}


def _save_catalog(cat: Dict[str, Any]) -> None:
    path = _catalog_path()
    tmp = path.with_suffix(".tmp")
    text = json.dumps(cat, ensure_ascii=False, indent=2)
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def build_qr_string(page_id: str) -> str:
    return f"{QR_PREFIX}|{QR_VERSION}|{page_id}"


def parse_qr_string(qr: str) -> Optional[str]:
    if not qr:
        return None
    s = qr.strip()
    parts = s.split("|")
    if len(parts) == 3 and parts[0] == QR_PREFIX and parts[1] == QR_VERSION:
        pid = parts[2].strip()
        if re.match(r"^[0-9a-fA-F-]{36}$", pid):
            return pid
    return None


def _find_page(cat: Dict[str, Any], page_id: str) -> Optional[Dict[str, Any]]:
    for p in cat["pages"]:
        if p.get("id") == page_id:
            return p
    return None


def _find_group(cat: Dict[str, Any], group_id: str) -> Optional[Dict[str, Any]]:
    for g in cat["groups"]:
        if g.get("id") == group_id:
            return g
    return None


def _pages_for_group(cat: Dict[str, Any], group_id: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    prod: List[Dict[str, Any]] = []
    inst: List[Dict[str, Any]] = []
    unclassified: List[Dict[str, Any]] = []
    for p in cat["pages"]:
        if p.get("group_id") != group_id:
            continue
        k = p.get("kind")
        if k == "production":
            prod.append(p)
        elif k == "installation":
            inst.append(p)
        else:
            unclassified.append(p)
    prod.sort(key=lambda x: (x.get("upload_id", ""), x.get("page_number", 0)))
    inst.sort(key=lambda x: (x.get("upload_id", ""), x.get("page_number", 0)))
    unclassified.sort(key=lambda x: (x.get("upload_id", ""), x.get("page_number", 0)))
    return prod, inst, unclassified


def _order_first(pages: List[Dict[str, Any]], page_id: str) -> List[Dict[str, Any]]:
    head = [p for p in pages if p.get("id") == page_id]
    tail = [p for p in pages if p.get("id") != page_id]
    return head + tail


def _split_pdf_to_pages(pdf_bytes: bytes) -> List[bytes]:
    if PdfReader is None or PdfWriter is None:
        raise RuntimeError("pypdf가 설치되어 있지 않습니다. requirements.txt의 pypdf를 설치하세요.")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    out: List[bytes] = []
    for i in range(len(reader.pages)):
        writer = PdfWriter()
        writer.add_page(reader.pages[i])
        buf = io.BytesIO()
        writer.write(buf)
        out.append(buf.getvalue())
    return out


class DrawingQrManagerModule(Module):
    name = "M_DrawingQrManager"
    description = "QR 기반 도면 PDF 분할·그룹(제작/설치) 관리"
    capabilities = [
        "DRAWING_QR_PDF_UPLOAD",
        "DRAWING_QR_RESOLVE_PAGE",
        "DRAWING_QR_GROUP_CREATE",
        "DRAWING_QR_GROUP_ADD_PAGE",
        "DRAWING_QR_GROUP_UPDATE",
        "DRAWING_QR_RELATED_ADD",
        "DRAWING_QR_PAGE_SET_KIND",
        "DRAWING_QR_QR_STRING",
    ]

    def __init__(self):
        super().__init__()

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        handlers = {
            "DRAWING_QR_PDF_UPLOAD": self._upload,
            "DRAWING_QR_RESOLVE_PAGE": self._resolve,
            "DRAWING_QR_GROUP_CREATE": self._group_create,
            "DRAWING_QR_GROUP_ADD_PAGE": self._group_add_page,
            "DRAWING_QR_GROUP_UPDATE": self._group_update,
            "DRAWING_QR_RELATED_ADD": self._related_add,
            "DRAWING_QR_PAGE_SET_KIND": self._page_set_kind,
            "DRAWING_QR_QR_STRING": self._qr_string,
        }
        fn = handlers.get(event.type)
        if not fn:
            return []
        try:
            return fn(event)
        except Exception as e:
            return [
                Event(
                    type="DRAWING_QR_ERROR",
                    payload={"message": str(e), "request_id": (event.payload or {}).get("request_id")},
                    source_module=self.name,
                )
            ]

    def _upload(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        filename = (payload.get("filename") or "upload.pdf").strip()
        project_id = (payload.get("project_id") or "").strip()
        temp_path: Optional[Path] = None
        try:
            rel = (payload.get("pdf_temp_relpath") or "").strip()
            b64 = payload.get("pdf_base64")
            if rel:
                raw_bytes, temp_path = _read_pdf_from_temp_relpath(rel)
                raw = _trim_to_pdf_start(raw_bytes)
            else:
                raw = _trim_to_pdf_start(_bytes_from_pdf_base64_field(b64))
            if not raw or len(raw) < 8 or not raw.startswith(b"%PDF"):
                raise ValueError(
                    "유효한 PDF 파일이 아닙니다. (파일이 비었거나, JSON 업로드 시 Base64가 누락된 경우 multipart /api/drawing-qr/upload 를 사용하세요.)"
                )

            pages_pdf = _split_pdf_to_pages(raw)
            if not pages_pdf:
                raise ValueError("PDF에 페이지가 없습니다.")

            render_dpi = int(os.getenv("DRAWING_QR_RENDER_DPI", "140"))

            cat = _load_catalog()
            upload_id = str(uuid.uuid4())
            upload_rec = {
                "id": upload_id,
                "filename": filename,
                "page_count": len(pages_pdf),
                "created_at": _utc_now(),
            }
            if re.match(r"^[0-9a-fA-F-]{36}$", project_id):
                upload_rec["project_id"] = project_id
            cat["uploads"].append(upload_rec)

            page_infos: List[Dict[str, Any]] = []
            for idx, page_bytes in enumerate(pages_pdf):
                page_id = str(uuid.uuid4())
                rel = f"pages/{page_id}.pdf"
                dest = _pages_dir().parent / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(page_bytes)
                qr_str = build_qr_string(page_id)

                # 페이지 PDF를 PNG로 변환해 UI 표시용으로 사용합니다.
                image_path = _render_page_pdf_to_png(dest, page_id, dpi=render_dpi)
                image_rel = str(image_path.relative_to(_data_root())).replace("\\", "/")
                image_url = f"/api/drawing-qr/pages/{page_id}/image"

                rec = {
                    "id": page_id,
                    "upload_id": upload_id,
                    "page_number": idx + 1,
                    "storage_path": rel.replace("\\", "/"),
                    "image_storage_path": image_rel,
                    "qr_string": qr_str,
                    "kind": None,
                    "group_id": None,
                    "created_at": _utc_now(),
                }
                cat["pages"].append(rec)
                page_infos.append(
                    {
                        "page_id": page_id,
                        "page_number": idx + 1,
                        "qr_string": qr_str,
                        "file_url": f"/api/drawing-qr/pages/{page_id}/file",
                        "image_url": image_url,
                    }
                )

            _save_catalog(cat)
            return [
                Event(
                    type="DRAWING_QR_PDF_UPLOAD_DONE",
                    payload={
                        "upload_id": upload_id,
                        "filename": filename,
                        "pages": page_infos,
                        "request_id": request_id,
                    },
                    source_module=self.name,
                )
            ]
        finally:
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _resolve(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        qr_string = (payload.get("qr_string") or "").strip()
        page_id = payload.get("page_id")
        if not page_id and qr_string:
            page_id = parse_qr_string(qr_string)
        if not page_id:
            raise ValueError("QR 문자열 또는 page_id가 필요합니다.")

        cat = _load_catalog()
        page = _find_page(cat, page_id)
        if not page:
            raise ValueError("등록되지 않은 도면 QR입니다.")

        group = None
        prod_pages: List[Dict[str, Any]] = []
        inst_pages: List[Dict[str, Any]] = []
        unclassified_pages: List[Dict[str, Any]] = []
        if page.get("group_id"):
            group = _find_group(cat, page["group_id"])
            prod_pages, inst_pages, unclassified_pages = _pages_for_group(cat, page["group_id"])
            prod_pages = _order_first(prod_pages, page_id)
            inst_pages = _order_first(inst_pages, page_id)
            unclassified_pages = _order_first(unclassified_pages, page_id)

        def enrich(p: Dict[str, Any]) -> Dict[str, Any]:
            return {
                **p,
                "file_url": f"/api/drawing-qr/pages/{p['id']}/file",
                "image_url": f"/api/drawing-qr/pages/{p['id']}/image",
            }

        view_mode = "unclassified"
        if page.get("kind") == "production":
            view_mode = "scan_production"
        elif page.get("kind") == "installation":
            view_mode = "scan_installation"

        return [
            Event(
                type="DRAWING_QR_PAGE_RESOLVED",
                payload={
                    "page": enrich(page),
                    "group": group,
                    "production_pages": [enrich(p) for p in prod_pages],
                    "installation_pages": [enrich(p) for p in inst_pages],
                    "unclassified_pages": [enrich(p) for p in unclassified_pages],
                    "view_mode": view_mode,
                    "pending_classification": page.get("kind") is None,
                    "request_id": request_id,
                },
                source_module=self.name,
            )
        ]

    def _group_create(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        page_id = payload.get("page_id")
        kind = payload.get("kind")
        name = (payload.get("name") or "").strip() or "도면 그룹"
        specs = payload.get("specs") if isinstance(payload.get("specs"), dict) else {}

        if kind not in ("production", "installation"):
            raise ValueError("kind는 production 또는 installation 이어야 합니다.")
        if not page_id:
            raise ValueError("page_id가 필요합니다.")

        cat = _load_catalog()
        page = _find_page(cat, page_id)
        if not page:
            raise ValueError("페이지를 찾을 수 없습니다.")
        if page.get("group_id"):
            raise ValueError("이미 다른 그룹에 속한 도면입니다.")

        gid = str(uuid.uuid4())
        group = {
            "id": gid,
            "name": name,
            "specs": specs,
            "created_at": _utc_now(),
            "updated_at": _utc_now(),
        }
        cat["groups"].append(group)
        page["group_id"] = gid
        page["kind"] = kind
        _save_catalog(cat)
        return self._emit_group_saved(cat, gid, request_id)

    def _group_add_page(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        group_id = payload.get("group_id")
        page_id = payload.get("page_id")
        kind = payload.get("kind")

        if kind not in ("production", "installation"):
            raise ValueError("kind는 production 또는 installation 이어야 합니다.")
        if not group_id or not page_id:
            raise ValueError("group_id와 page_id가 필요합니다.")

        cat = _load_catalog()
        if not _find_group(cat, group_id):
            raise ValueError("그룹을 찾을 수 없습니다.")
        page = _find_page(cat, page_id)
        if not page:
            raise ValueError("페이지를 찾을 수 없습니다.")
        if page.get("group_id") and page["group_id"] != group_id:
            raise ValueError("이미 다른 그룹에 속한 도면입니다.")

        page["group_id"] = group_id
        page["kind"] = kind
        g = _find_group(cat, group_id)
        if g:
            g["updated_at"] = _utc_now()
        _save_catalog(cat)
        return self._emit_group_saved(cat, group_id, request_id)

    def _project_id_for_upload(self, cat: Dict[str, Any], upload_id: Optional[str]) -> Optional[str]:
        if not upload_id:
            return None
        for u in cat.get("uploads") or []:
            if u.get("id") == upload_id:
                return u.get("project_id")
        return None

    def _related_add(self, event: Event) -> List[Event]:
        """
        기준 도면(anchor)이 속한 그룹에 다른 도면을 연결합니다.
        - 추가되는 도면의 제작/설치 여부는 catalog에 저장된 kind를 따릅니다(클라이언트 kind 무시).
        - 기준 도면에 그룹이 없으면 그룹을 자동 생성합니다(이름·사양은 payload 또는 기본값).
        """
        payload = event.payload or {}
        request_id = payload.get("request_id")
        anchor_page_id = (payload.get("anchor_page_id") or "").strip()
        page_id = (payload.get("page_id") or "").strip()
        name = (payload.get("name") or "").strip() or "관련 도면"
        specs = payload.get("specs") if isinstance(payload.get("specs"), dict) else {}

        if not anchor_page_id or not page_id:
            raise ValueError("anchor_page_id와 page_id가 필요합니다.")
        if anchor_page_id == page_id:
            raise ValueError("같은 도면은 관련 도면으로 추가할 수 없습니다.")

        cat = _load_catalog()
        anchor = _find_page(cat, anchor_page_id)
        new_p = _find_page(cat, page_id)
        if not anchor or not new_p:
            raise ValueError("페이지를 찾을 수 없습니다.")

        pj_a = self._project_id_for_upload(cat, anchor.get("upload_id"))
        pj_b = self._project_id_for_upload(cat, new_p.get("upload_id"))
        if pj_a and pj_b and pj_a != pj_b:
            raise ValueError("같은 프로젝트의 도면끼리만 연결할 수 있습니다.")

        gid_anchor = anchor.get("group_id")
        gid_new = new_p.get("group_id")

        if gid_new:
            if gid_anchor and gid_new == gid_anchor:
                return self._emit_group_saved(cat, gid_new, request_id)
            raise ValueError("이미 다른 그룹에 속한 도면입니다.")

        if gid_anchor:
            g = _find_group(cat, gid_anchor)
            if not g:
                raise ValueError("그룹을 찾을 수 없습니다.")
            new_p["group_id"] = gid_anchor
            g["updated_at"] = _utc_now()
            _save_catalog(cat)
            return self._emit_group_saved(cat, gid_anchor, request_id)

        gid = str(uuid.uuid4())
        group = {
            "id": gid,
            "name": name,
            "specs": specs,
            "created_at": _utc_now(),
            "updated_at": _utc_now(),
        }
        cat["groups"].append(group)
        anchor["group_id"] = gid
        new_p["group_id"] = gid
        _save_catalog(cat)
        return self._emit_group_saved(cat, gid, request_id)

    def _group_update(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        group_id = payload.get("group_id")
        if not group_id:
            raise ValueError("group_id가 필요합니다.")

        cat = _load_catalog()
        g = _find_group(cat, group_id)
        if not g:
            raise ValueError("그룹을 찾을 수 없습니다.")
        if "name" in payload and payload["name"] is not None:
            g["name"] = str(payload["name"]).strip() or g.get("name", "")
        if "specs" in payload and isinstance(payload["specs"], dict):
            g["specs"] = payload["specs"]
        g["updated_at"] = _utc_now()
        _save_catalog(cat)
        return self._emit_group_saved(cat, group_id, request_id)

    def _page_set_kind(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        page_id = (payload.get("page_id") or "").strip()
        kind = payload.get("kind")

        if not page_id:
            raise ValueError("page_id가 필요합니다.")

        # kind는 production/installation/None(미분류) 허용
        if kind in ("", "none", "null"):
            kind = None
        if kind is not None and kind not in ("production", "installation"):
            raise ValueError("kind는 production 또는 installation 또는 null 이어야 합니다.")

        cat = _load_catalog()
        page = _find_page(cat, page_id)
        if not page:
            raise ValueError("등록되지 않은 page_id 입니다.")

        page["kind"] = kind
        _save_catalog(cat)

        def enrich(p: Dict[str, Any]) -> Dict[str, Any]:
            return {
                **p,
                "file_url": f"/api/drawing-qr/pages/{p['id']}/file",
                "image_url": f"/api/drawing-qr/pages/{p['id']}/image",
            }

        return [
            Event(
                type="DRAWING_QR_PAGE_UPDATED",
                payload={"page": enrich(page), "request_id": request_id},
                source_module=self.name,
            )
        ]

    def _qr_string(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        request_id = payload.get("request_id")
        page_id = payload.get("page_id")
        if not page_id:
            raise ValueError("page_id가 필요합니다.")
        cat = _load_catalog()
        page = _find_page(cat, page_id)
        if not page:
            raise ValueError("페이지를 찾을 수 없습니다.")
        return [
            Event(
                type="DRAWING_QR_QR_STRING_READY",
                payload={
                    "qr_string": page.get("qr_string") or build_qr_string(page_id),
                    "page_id": page_id,
                    "request_id": request_id,
                },
                source_module=self.name,
            )
        ]

    def _emit_group_saved(self, cat: Dict[str, Any], group_id: str, request_id: Any) -> List[Event]:
        group = _find_group(cat, group_id)
        prod, inst, unclassified = _pages_for_group(cat, group_id)

        def enrich(p: Dict[str, Any]) -> Dict[str, Any]:
            return {
                **p,
                "file_url": f"/api/drawing-qr/pages/{p['id']}/file",
                "image_url": f"/api/drawing-qr/pages/{p['id']}/image",
            }

        return [
            Event(
                type="DRAWING_QR_GROUP_SAVED",
                payload={
                    "group": group,
                    "production_pages": [enrich(p) for p in prod],
                    "installation_pages": [enrich(p) for p in inst],
                    "unclassified_pages": [enrich(p) for p in unclassified],
                    "request_id": request_id,
                },
                source_module=self.name,
            )
        ]
