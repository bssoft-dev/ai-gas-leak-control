"""
M_OrderManager: 범용 주문 관리 모듈
- ORDER_CREATE: 주문 생성
- ORDER_UPDATE: 주문 상태/정보 업데이트
- ORDER_QUERY: 주문 조회 (선택적)
재활용 가능한 범용 주문 관리 시스템
"""
from __future__ import annotations

import base64
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 주문 저장 경로 (프로젝트 루트 기준 데이터 디렉터리)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ORDERS_DIR = PROJECT_ROOT / "services" / "dangbae" / "data" / "orders"
ORDERS_FILE = ORDERS_DIR / "orders.json"
ORDER_ITEM_IMAGES_DIR = (
    PROJECT_ROOT / "services" / "dangbae" / "data" / "order_item_images"
)


def _ensure_orders_dir() -> Path:
    ORDERS_DIR.mkdir(parents=True, exist_ok=True)
    return ORDERS_DIR


def _load_orders() -> Dict[str, Dict[str, Any]]:
    """주문 목록 로드 (파일 기반)"""
    _ensure_orders_dir()
    if not ORDERS_FILE.exists():
        return {}
    try:
        with open(ORDERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_orders(orders: Dict[str, Dict[str, Any]]) -> None:
    """주문 목록 저장"""
    _ensure_orders_dir()
    with open(ORDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(orders, f, ensure_ascii=False, indent=2)


def _build_order_display_name(p: Dict[str, Any]) -> str:
    """표시용 주문명: 아이템(출발지, 도착지)"""
    item = (p.get("item_title") or "물품").strip() or "물품"
    def _extract_simple_area(addr: str) -> str:
        # 동, 읍, 면 등 동네 위주로 요약 (ex: "광주 북구 연제동 1038-6" → "연제동")
        addr = (addr or "").strip()
        m = re.search(r'([가-힣]+(동|읍|면|가|리))', addr)
        if m:
            return m.group(1)
        # '시', '구'까지만 있는 주소면 구 단위라도 반환
        m2 = re.search(r'([가-힣]+구)', addr)
        if m2:
            return m2.group(1)
        m3 = re.search(r'([가-힣]+시)', addr)
        if m3:
            return m3.group(1)
        return addr  # 못찾으면 전체 반환

    oa = _extract_simple_area(p.get("origin_address") or p.get("origin_detail") or "")
    da = _extract_simple_area(p.get("dest_address") or p.get("dest_detail") or "")
    return f"{item}({oa}, {da})"[:200]


def _guess_image_extension(mime: str) -> str:
    mime = (mime or "").lower().strip()
    if mime in ("image/jpeg", "image/jpg"):
        return "jpg"
    if mime == "image/png":
        return "png"
    if mime == "image/webp":
        return "webp"
    if mime == "image/gif":
        return "gif"
    # 예외적으로 알려진 MIME이 아닐 경우 기본값
    return "jpg"


_DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<b64>.*)$", re.DOTALL)
_BASE64_LIKE_RE = re.compile(r"^[A-Za-z0-9+/=]+$")


def _save_item_images_to_files(
    item_images: Any, *, order_id: str
) -> Tuple[List[str], List[str]]:
    """
    item_images(base64 data URL list)를 디스크 파일로 저장하고,
    orders에는 경로만 저장하기 위한 유틸.

    Returns:
      (saved_paths, skipped_originals)
    """
    if not isinstance(item_images, list) or not item_images:
        return ([], [])

    target_dir = ORDER_ITEM_IMAGES_DIR / order_id
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_paths: List[str] = []
    skipped_originals: List[str] = []

    for v in item_images:
        if not v:
            continue
        if not isinstance(v, str):
            continue

        # 이미 경로/URL이라면 그대로 유지
        if v.startswith("http://") or v.startswith("https://") or v.startswith("/"):
            saved_paths.append(v)
            continue

        # data URL (data:image/png;base64,....) 형태면 디코딩해서 저장
        if v.startswith("data:"):
            m = _DATA_URL_RE.match(v)
            if not m:
                skipped_originals.append("data_url_parse_failed")
                continue
            mime = m.group("mime") or ""
            b64 = m.group("b64") or ""
            try:
                raw = base64.b64decode(b64, validate=False)
            except Exception:
                skipped_originals.append("data_url_base64_decode_failed")
                continue

            ext = _guess_image_extension(mime)
            fn = f"{uuid.uuid4().hex}.{ext}"
            file_path = target_dir / fn
            try:
                file_path.write_bytes(raw)
            except Exception:
                skipped_originals.append("file_write_failed")
                continue

            # 프로젝트 루트 기준 상대경로로 저장 (orders가 과도하게 길어지는 것 방지)
            try:
                rel = file_path.relative_to(PROJECT_ROOT)
                saved_paths.append(rel.as_posix())
            except Exception:
                saved_paths.append(str(file_path))
            continue

        # 그 외 문자열: base64일 가능성이 있으면 파일로 저장하고,
        # 경로/URL처럼 보이면 그대로 유지합니다.
        vv = v.strip()
        if len(vv) > 50 and _BASE64_LIKE_RE.match(vv):
            try:
                raw = base64.b64decode(vv, validate=False)
            except Exception:
                skipped_originals.append("bare_base64_decode_failed")
                continue
            ext = "bin"
            fn = f"{uuid.uuid4().hex}.{ext}"
            file_path = target_dir / fn
            try:
                file_path.write_bytes(raw)
            except Exception:
                skipped_originals.append("file_write_failed")
                continue
            try:
                rel = file_path.relative_to(PROJECT_ROOT)
                saved_paths.append(rel.as_posix())
            except Exception:
                saved_paths.append(str(file_path))
            continue

        # 안전장치: base64일 것 같은 긴 문자열은 저장하지 않음
        if len(vv) > 200:
            skipped_originals.append("unknown_large_string_skipped")
            continue

        # 짧은 문자열은 경로/식별자로 간주
        saved_paths.append(v)

    return (saved_paths, skipped_originals)


class OrderManagerModule(Module):
    """범용 주문 생성/조회/상태 업데이트 모듈"""

    name = "M_OrderManager"
    description = "범용 주문 관리 시스템 (생성/조회/상태 업데이트)"
    capabilities = ["ORDER_CREATE", "ORDER_UPDATE", "ORDER_QUERY"]

    def __init__(self, orders_file: Optional[str] = None):
        super().__init__()
        if orders_file:
            global ORDERS_FILE
            ORDERS_FILE = Path(orders_file)

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities or event.custom_event_type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "ORDER_CREATE":
            return self._process_create(event)
        if event.type == "ORDER_UPDATE":
            return self._process_update(event)
        if event.type == "ORDER_QUERY":
            return self._process_query(event)
        return []

    def _process_create(self, event: Event) -> List[Event]:
        """주문 생성 → ORDER_CREATED 또는 custom_event_type 발행"""
        p = event.payload or {}
        order_id = p.get("order_id") or str(uuid.uuid4())[:8]
        custom_event_type = p.get("custom_event_type")  # 커스텀 이벤트 타입 (선택)

        # item_images: base64 그대로 orders에 저장하지 않고 파일로 저장 후 경로만 남김
        if "item_images" in p:
            stored_paths, _ = _save_item_images_to_files(p.get("item_images"), order_id=order_id)
            # 저장 실패/스킵이 있어도, orders에는 base64 원문을 남기지 않기 위해 paths만 넣음
            p["item_images"] = stored_paths
        
        # 기본 주문 구조
        order = {
            "order_id": order_id,
            "status": p.get("status", "pending"),
            "created_at": event.timestamp.isoformat() if event.timestamp else "",
            **{k: v for k, v in p.items() if k not in ("order_id", "custom_event_type")},  # 나머지 필드 복사
        }
        if not (order.get("order_name") or "").strip():
            order["order_name"] = _build_order_display_name(p)
        
        orders = _load_orders()
        if order_id in orders:
            # 이미 존재하면 업데이트로 처리
            return []
        orders[order_id] = order
        _save_orders(orders)

        # 커스텀 이벤트 타입이 있으면 그것을 사용, 없으면 기본 ORDER_CREATED
        event_type = custom_event_type or "ORDER_CREATED"
        _SENSITIVE = ("order_access_pin", "user_pin")
        public_order = {k: v for k, v in order.items() if k not in _SENSITIVE}
        return [
            Event(
                type=event_type,
                payload={"order_id": order_id, **public_order},
                source_module=self.name,
            )
        ]

    def _process_update(self, event: Event) -> List[Event]:
        """주문 상태/정보 업데이트 → ORDER_UPDATED 또는 custom_event_type 발행"""
        p = event.payload or {}
        order_id = p.get("order_id", "")
        custom_event_type = p.get("custom_event_type")  # 커스텀 이벤트 타입 (선택)
        if not order_id:
            return []

        orders = _load_orders()
        if order_id not in orders:
            return []

        old_status = (orders[order_id].get("status") or "").strip()
        # payment_ok, admin_cancel_approve 는 검증용 — 저장하지 않음
        update_fields = {
            k: v
            for k, v in p.items()
            if k not in ("order_id", "custom_event_type", "payment_ok", "admin_cancel_approve")
        }
        new_status = update_fields.get("status", old_status)

        def _reject(msg: str, code: str) -> List[Event]:
            return [
                Event(
                    type="ORDER_UPDATE_REJECTED",
                    payload={
                        "order_id": order_id,
                        "error": code,
                        "message": msg,
                        "current_status": old_status,
                    },
                    source_module=self.name,
                )
            ]

        # 취소 요청: 배송원 배정·픽업 완료 단계에서만, 사유 필수
        if new_status == "cancel_requested":
            if old_status not in ("assigned", "picked_up"):
                return _reject(
                    "배송원 배정 또는 픽업 완료 단계에서만 취소 요청할 수 있습니다.",
                    "invalid_cancel_request",
                )
            if not str(p.get("cancel_reason") or "").strip():
                return _reject("취소 사유를 입력해 주세요.", "cancel_reason_required")

        # 취소요청 중 → 취소외 전환 불가 (관리자 취소 승인만)
        if old_status == "cancel_requested" and new_status != "cancelled":
            return _reject(
                "취소 요청이 접수되었습니다. 관리자 승인을 기다려 주세요.",
                "cancel_pending",
            )

        # 취소 완료: 접수·결제대기는 바로 / 취소요청 중은 관리자만
        if new_status == "cancelled":
            if old_status in ("assigned", "picked_up"):
                return _reject(
                    "배송 진행 중에는 [취소 요청]으로 사유를 남겨 주세요. 관리자가 승인하면 취소 완료됩니다.",
                    "use_cancel_request",
                )
            if old_status == "cancel_requested" and not p.get("admin_cancel_approve"):
                return _reject("취소 완료는 관리자 화면에서만 처리할 수 있습니다.", "admin_cancel_only")

        # 결제 대기 → 고객 결제 없이는 배송원 배정·픽업·완료 불가. (접수 대기로 전환은 payment_hub가 결제 검증 후 수행)
        if old_status == "payment_pending":
            if new_status in ("assigned", "picked_up", "delivered"):
                return _reject(
                    "고객 결제가 완료되어 접수 대기 상태가 된 뒤에 배정·진행할 수 있습니다.",
                    "payment_required",
                )
            if new_status == "pending":
                if not p.get("payment_ok") and not (str(p.get("imp_uid") or "").strip()):
                    return _reject(
                        "결제 검증(payment_ok 또는 imp_uid) 없이 접수 대기로 바꿀 수 없습니다.",
                        "payment_unverified",
                    )

        # 상태 전환 시각 (최초 1회만 setdefault)
        ts = event.timestamp.isoformat() if event.timestamp else ""
        if new_status != old_status:
            if new_status == "pending" and old_status == "payment_pending":
                update_fields.setdefault("paid_at", ts)
            elif new_status == "assigned":
                update_fields.setdefault("assigned_at", ts)
            elif new_status == "picked_up":
                update_fields.setdefault("picked_up_at", ts)
            elif new_status == "delivered":
                update_fields.setdefault("delivered_at", ts)
            elif new_status == "cancel_requested":
                update_fields.setdefault("cancel_requested_at", ts)
            elif new_status == "cancelled":
                update_fields.setdefault("cancelled_at", ts)

        # 업데이트할 필드들
        orders[order_id].update(update_fields)
        orders[order_id]["updated_at"] = event.timestamp.isoformat() if event.timestamp else ""
        _save_orders(orders)
        order = orders[order_id]

        # 커스텀 이벤트 타입이 있으면 그것을 사용, 없으면 기본 ORDER_UPDATED
        event_type = custom_event_type or "ORDER_UPDATED"
        return [
            Event(
                type=event_type,
                payload={"order_id": order_id, **order},
                source_module=self.name,
            )
        ]

    def _normalize_phone(self, s: Optional[str]) -> str:
        """전화번호 비교용 정규화 (공백·하이픈 제거)"""
        if not s:
            return ""
        return "".join(c for c in str(s).strip() if c.isdigit())

    def _normalize_pin(self, s: Optional[str]) -> str:
        """조회용 비밀번호(숫자만, 최대 6자리)"""
        if not s:
            return ""
        return "".join(c for c in str(s).strip() if c.isdigit())[:6]

    @staticmethod
    def _strip_sensitive_for_customer(order: Dict[str, Any]) -> Dict[str, Any]:
        """고객 조회 응답에서 비밀번호 필드 제거"""
        out = {k: v for k, v in order.items() if k not in ("order_access_pin", "user_pin")}
        return out

    @staticmethod
    def _get_email_from_token(token: str) -> str:
        """JWT access_token에서 이메일 추출 (서명 검증 없음, 조회용)"""
        if not token:
            return ""
        try:
            import base64 as _b64
            import json as _json
            parts = token.split(".")
            if len(parts) < 2:
                return ""
            b64 = parts[1].replace("-", "+").replace("_", "/")
            pad = len(b64) % 4
            if pad:
                b64 += "=" * (4 - pad)
            payload = _json.loads(_b64.b64decode(b64).decode("utf-8"))
            return (
                payload.get("email") or
                (payload.get("user_metadata") or {}).get("email") or
                ""
            )
        except Exception:
            return ""

    def _process_query(self, event: Event) -> List[Event]:
        """주문 조회 → ORDER_QUERIED 발행 (order_id / status / user_phone+user_pin / user_token 필터)"""
        p = event.payload or {}
        order_id = p.get("order_id", "")
        status_filter = p.get("status")
        user_phone = (p.get("user_phone") or "").strip()
        user_pin = self._normalize_pin(p.get("user_pin") or p.get("order_access_pin"))
        user_token = (p.get("user_token") or "").strip()
        # 로그인 토큰이 있는 경우 PIN 검증 없이 연락처 또는 이메일로 조회 허용
        is_authenticated = bool(user_token)
        # 토큰에서 이메일 추출 (전화번호 없이 이메일만으로 조회 가능)
        token_email = self._get_email_from_token(user_token).strip().lower() if is_authenticated else ""

        orders = _load_orders()

        if order_id:
            # 특정 주문 조회
            if order_id in orders:
                return [
                    Event(
                        type="ORDER_QUERIED",
                        payload={"order_id": order_id, **orders[order_id]},
                        source_module=self.name,
                    )
                ]
            return []

        # 로그인 상태 + 전화번호 없음 → 이메일로 조회 (내 배송 현황 자동 조회)
        if is_authenticated and not user_phone and token_email:
            filtered = []
            for oid, order in orders.items():
                order_email = (order.get("user_email") or "").strip().lower()
                if order_email and order_email == token_email:
                    filtered.append(
                        self._strip_sensitive_for_customer({"order_id": oid, **order})
                    )
            return [
                Event(
                    type="ORDER_QUERIED",
                    payload={"orders": filtered, "count": len(filtered)},
                    source_module=self.name,
                )
            ]

        if user_phone:
            key = self._normalize_phone(user_phone)
            # 로그인 사용자: PIN 없이 연락처만으로 조회
            if is_authenticated:
                filtered = []
                for oid, order in orders.items():
                    if not key or self._normalize_phone(order.get("user_phone")) != key:
                        continue
                    filtered.append(
                        self._strip_sensitive_for_customer({"order_id": oid, **order})
                    )
                return [
                    Event(
                        type="ORDER_QUERIED",
                        payload={"orders": filtered, "count": len(filtered)},
                        source_module=self.name,
                    )
                ]
            # 비로그인 사용자: 연락처 + 6자리 비밀번호로만 조회
            if len(user_pin) != 6:
                return [
                    Event(
                        type="ORDER_QUERIED",
                        payload={
                            "orders": [],
                            "count": 0,
                            "query_error": "6자리 비밀번호를 입력해 주세요.",
                        },
                        source_module=self.name,
                    )
                ]
            filtered = []
            for oid, order in orders.items():
                if not key or self._normalize_phone(order.get("user_phone")) != key:
                    continue
                stored = self._normalize_pin(
                    order.get("order_access_pin") or order.get("user_pin")
                )
                if len(stored) != 6:
                    continue
                if stored == user_pin:
                    filtered.append(
                        self._strip_sensitive_for_customer({"order_id": oid, **order})
                    )
            return [
                Event(
                    type="ORDER_QUERIED",
                    payload={"orders": filtered, "count": len(filtered)},
                    source_module=self.name,
                )
            ]
        # 전체 조회 (필터 적용)
        filtered = [
            {"order_id": oid, **order}
            for oid, order in orders.items()
            if not status_filter or order.get("status") == status_filter
        ]
        return [
            Event(
                type="ORDER_QUERIED",
                payload={"orders": filtered, "count": len(filtered)},
                source_module=self.name,
            )
        ]
