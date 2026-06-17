"""
M_PaymentHub: 결제 준비·확인 (일반카드, 계좌이체, 간편결제 채널 선택)
- PAYMENT_PREPARE: 주문 금액·수단에 맞는 결제 파라미터 생성
- PAYMENT_CONFIRM: 결제 완료 검증(목업/포트원 V2·KPN 또는 V1)

연동:
- PAYMENT_PROVIDER=mock  : 즉시 성공 목업 (개발용)
- PAYMENT_PROVIDER=kpn    : 한국결제네트웍스(KPN) — 포트원 V2 SDK + api.portone.io (권장)
- PAYMENT_PROVIDER=portone: 포트원 V1(구 아임포트 JS) — 하위 호환

환경 (KPN / 포트원 V2):
- PORTONE_STORE_ID: 상점 ID (콘솔 연동 정보)
- PORTONE_CHANNEL_KEY: KPN 채널 키 (콘솔 [결제연동] > [채널관리]에서 KPN 채널 추가 후 발급)
- PORTONE_API_SECRET: V2 API Secret (결제 조회, Authorization: PortOne {secret})

환경 (포트원 V1, portone 모드만):
- PORTONE_IMP_CODE, PORTONE_REST_API_KEY, PORTONE_API_SECRET(V1 토큰)
"""
from __future__ import annotations

import os
import re
import time
import uuid
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

PORTONE_V2_SDK = "https://cdn.portone.io/v2/browser-sdk.js"
PORTONE_V2_API = "https://api.portone.io"

# 결제 수단 → V1 pay_method / V2 payMethod
METHOD_ALIASES = {
    "card": "card",
    "credit_card": "card",
    "일반카드": "card",
    "trans": "trans",
    "transfer": "trans",
    "계좌이체": "trans",
    "vbank": "vbank",
    "easy_pay": "easy_pay",
    "간편결제": "easy_pay",
    "kakaopay": "kakaopay",
    "naverpay": "naverpay",
    "tosspay": "tosspay",
}

METHOD_V2 = {
    "card": "CARD",
    "trans": "TRANSFER",
    "transfer": "TRANSFER",
    "vbank": "VIRTUAL_ACCOUNT",
    "easy_pay": "EASY_PAY",
    "kakaopay": "EASY_PAY",
    "naverpay": "EASY_PAY",
    "tosspay": "EASY_PAY",
}


def _v2_payment_id(order_id: str) -> str:
    """V2 paymentId: 영문·숫자만 허용."""
    ts = int(time.time() * 1000)
    rnd = uuid.uuid4().hex[:10]
    oid = re.sub(r"[^a-zA-Z0-9]", "", str(order_id or ""))[:16]
    return f"pay{ts}{rnd}{oid}"[:64]


class PaymentHubModule(Module):
    name = "M_PaymentHub"
    description = "결제 준비(카드/계좌이체/간편결제) 및 확인"
    capabilities = ["PAYMENT_PREPARE", "PAYMENT_CONFIRM"]

    def __init__(self):
        super().__init__()
        self.provider = (os.getenv("PAYMENT_PROVIDER") or "mock").strip().lower()
        self.portone_api_secret = (
            os.getenv("PORTONE_V2_API_SECRET", "").strip()
            or os.getenv("PORTONE_API_SECRET", "").strip()
        )
        self.portone_store_id = os.getenv("PORTONE_STORE_ID", "").strip()
        self.portone_channel_key = os.getenv("PORTONE_CHANNEL_KEY", "").strip()

        # IMP.init(고객사 식별코드) — REST API Key 와 별도
        self.portone_imp_code = (
            (os.getenv("PORTONE_IMP_CODE", "") or "").strip()
            or (os.getenv("PORTONE_CLIENT_CODE", "") or "").strip()
        )
        # users/getToken 의 imp_key
        self.portone_rest_api_key = (os.getenv("PORTONE_REST_API_KEY", "") or "").strip()

        legacy = (os.getenv("PORTONE_IMP_KEY", "") or "").strip()
        if legacy:
            if not self.portone_imp_code and legacy.startswith("imp"):
                self.portone_imp_code = legacy
            if not self.portone_rest_api_key and legacy.isdigit():
                self.portone_rest_api_key = legacy

        # pg: explicit > PG.MID
        self.portone_default_pg = (os.getenv("PORTONE_DEFAULT_PG", "") or "").strip()
        if not self.portone_default_pg:
            pgp = (os.getenv("PORTONE_PG_PROVIDER", "") or "").strip().lower()
            mid = (os.getenv("PORTONE_MID", "") or "").strip()
            if pgp and mid:
                self.portone_default_pg = f"{pgp}.{mid}"

    def _apply_default_pg_to_channels(self, channels: Dict[str, Any]) -> Dict[str, Any]:
        """채널에 pg가 없을 때만 PORTONE_DEFAULT_PG를 주입 (카카오페이 등 이미 pg가 있으면 유지)."""
        pg = self.portone_default_pg
        if not pg:
            return channels
        out: Dict[str, Any] = {}
        for key, val in channels.items():
            if not isinstance(val, dict):
                out[key] = val
                continue
            merged = dict(val)
            if not (str(merged.get("pg") or "")).strip():
                merged["pg"] = pg
            out[key] = merged
        return out

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        p = event.payload or {}
        if event.type == "PAYMENT_PREPARE":
            return self._prepare(p)
        if event.type == "PAYMENT_CONFIRM":
            return self._confirm(p)
        return []

    def _prepare(self, p: Dict[str, Any]) -> List[Event]:
        try:
            amount = int(p.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0
        if amount <= 0:
            return [
                Event(
                    type="PAYMENT_PREPARE_RESULT",
                    payload={"ok": False, "error": "amount는 1원 이상이어야 합니다."},
                    source_module=self.name,
                )
            ]
        order_id = (p.get("order_id") or p.get("merchant_uid") or "").strip()
        if not order_id:
            order_id = f"order_{uuid.uuid4().hex[:16]}"
        order_name = (p.get("order_name") or "주문").strip()[:120]
        buyer_email = (p.get("buyer_email") or "").strip()
        buyer_name = (p.get("buyer_name") or "").strip()
        buyer_tel = (p.get("buyer_tel") or "").strip()
        customer_id = (
            (p.get("customer_id") or p.get("buyer_id") or p.get("user_id") or "").strip()
        )

        raw_methods = p.get("payment_methods") or p.get("methods") or ["card", "trans", "easy_pay"]
        if not isinstance(raw_methods, list):
            raw_methods = ["card", "trans", "easy_pay"]
        normalized: List[str] = []
        for m in raw_methods:
            key = str(m).strip().lower()
            mapped = METHOD_ALIASES.get(key, key)
            if mapped not in normalized:
                normalized.append(mapped)

        use_kpn = self.provider in ("kpn", "kpn_korea", "한국결제네트웍스")
        merchant_uid = _v2_payment_id(order_id) if use_kpn else f"pay_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"

        base: Dict[str, Any] = {
            "ok": True,
            "provider": self.provider,
            "merchant_uid": merchant_uid,
            "payment_id": merchant_uid,
            "amount": amount,
            "order_id": order_id,
            "order_name": order_name,
            "name": order_name,
            "buyer_email": buyer_email,
            "buyer_name": buyer_name,
            "buyer_tel": buyer_tel,
            "buyer_id": customer_id,
            "customer_id": customer_id,
            "payment_methods": normalized,
            "pay_method": normalized[0] if normalized else "card",
            "pg": self.portone_default_pg,
            "hint": "KPN: PortOne V2 requestPayment(storeId, channelKey, paymentId).",
            "store_id": self.portone_store_id,
            "channel_key": self.portone_channel_key,
        }

        if self.provider == "mock":
            base["mock"] = True
            base["sdk_version"] = "v2"
            base["portone_script"] = PORTONE_V2_SDK
            base["pay_method_v2"] = METHOD_V2.get(normalized[0] if normalized else "card", "CARD")
            if self.portone_store_id:
                base["store_id"] = self.portone_store_id
            if self.portone_channel_key:
                base["channel_key"] = self.portone_channel_key
            base["channels"] = self._apply_default_pg_to_channels(
                {
                    "card": {"pay_method": "card"},
                    "trans": {"pay_method": "trans"},
                    "easy_pay": {"pay_method": "card", "digital": True},
                    "kakaopay": {"pg": "kakaopay", "pay_method": "card"},
                    "naverpay": {"pg": "naverpay", "pay_method": "card"},
                    "tosspay": {"pg": "tosspay", "pay_method": "card"},
                }
            )
            return [Event(type="PAYMENT_PREPARE_RESULT", payload=base, source_module=self.name)]

        if use_kpn:
            if not self.portone_store_id or not self.portone_channel_key:
                return [
                    Event(
                        type="PAYMENT_PREPARE_RESULT",
                        payload={
                            "ok": False,
                            "error": "KPN 연동에 PORTONE_STORE_ID, PORTONE_CHANNEL_KEY(한국결제네트웍스 채널)가 필요합니다.",
                        },
                        source_module=self.name,
                    )
                ]
            first = normalized[0] if normalized else "card"
            base["sdk_version"] = "v2"
            base["portone_script"] = PORTONE_V2_SDK
            base["pay_method_v2"] = METHOD_V2.get(first, "CARD")
            base["currency"] = "KRW"
            base["pg_provider"] = "kpn"
            return [Event(type="PAYMENT_PREPARE_RESULT", payload=base, source_module=self.name)]

        if self.provider == "portone":
            if not self.portone_imp_code:
                return [
                    Event(
                        type="PAYMENT_PREPARE_RESULT",
                        payload={
                            "ok": False,
                            "error": "PORTONE_IMP_CODE(고객사 식별코드)가 필요합니다. 관리자 연동 정보 → 식별코드·API Keys.",
                        },
                        source_module=self.name,
                    )
                ]
            token = self._portone_token()
            base["imp_code"] = self.portone_imp_code
            base["access_token"] = token
            base["portone_script"] = "https://cdn.iamport.kr/v1/iamport.js"
            base["channels"] = self._apply_default_pg_to_channels(
                {
                    "card": {"pay_method": "card"},
                    "trans": {"pay_method": "trans"},
                    "easy_pay": {"pay_method": "card", "digital": True},
                    "kakaopay": {"pg": "kakaopay", "pay_method": "card"},
                    "naverpay": {"pg": "naverpay", "pay_method": "card"},
                    "tosspay": {"pg": "tosspay", "pay_method": "card"},
                }
            )
            if not token:
                base["token_error"] = (
                    "포트원 토큰 발급 실패 — PORTONE_REST_API_KEY·PORTONE_API_SECRET 확인"
                )
            return [Event(type="PAYMENT_PREPARE_RESULT", payload=base, source_module=self.name)]

        return [
            Event(
                type="PAYMENT_PREPARE_RESULT",
                payload={"ok": False, "error": f"지원하지 않는 PAYMENT_PROVIDER: {self.provider}"},
                source_module=self.name,
            )
        ]

    def _portone_token(self) -> Optional[str]:
        if not requests or not self.portone_rest_api_key or not self.portone_api_secret:
            return None
        try:
            r = requests.post(
                "https://api.iamport.kr/users/getToken",
                json={
                    "imp_key": self.portone_rest_api_key,
                    "imp_secret": self.portone_api_secret,
                },
                timeout=15,
            )
            data = r.json() if r.text else {}
            if r.status_code == 200 and data.get("response"):
                return data["response"].get("access_token")
        except Exception:
            pass
        return None

    def _portone_v2_get_payment(self, payment_id: str) -> Optional[Dict[str, Any]]:
        if not requests or not self.portone_api_secret or not payment_id:
            return None
        try:
            r = requests.get(
                f"{PORTONE_V2_API}/payments/{payment_id}",
                headers={"Authorization": f"PortOne {self.portone_api_secret}"},
                timeout=15,
            )
            if r.status_code == 200 and r.text:
                data = r.json()
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
        return None

    def _confirm(self, p: Dict[str, Any]) -> List[Event]:
        """목업 확인 또는 paymentId(V2/KPN)·imp_uid(V1)로 포트원 조회."""
        order_id = (p.get("order_id") or "").strip()
        imp_uid = (p.get("imp_uid") or "").strip()
        merchant_uid = (p.get("merchant_uid") or "").strip()
        payment_id = (p.get("payment_id") or merchant_uid or "").strip()
        out: List[Event] = []

        def _result_payload(base: Dict[str, Any]) -> Dict[str, Any]:
            pl = dict(base)
            if order_id:
                pl["order_id"] = order_id
            return pl

        def _append_payment_result(base: Dict[str, Any]) -> None:
            out.append(
                Event(
                    type="PAYMENT_CONFIRM_RESULT",
                    payload=_result_payload(base),
                    source_module=self.name,
                )
            )

        def _maybe_promote_to_pending(
            paid_ok: bool, eff_imp_uid: str, eff_merchant_uid: str
        ) -> None:
            if not paid_ok or not order_id:
                return
            out.append(
                Event(
                    type="ORDER_UPDATE",
                    payload={
                        "order_id": order_id,
                        "status": "pending",
                        "payment_ok": True,
                        "imp_uid": eff_imp_uid,
                        "merchant_uid": eff_merchant_uid,
                    },
                    source_module=self.name,
                )
            )

        if self.provider == "mock":
            eff_imp = imp_uid or f"mock_{uuid.uuid4().hex[:12]}"
            _append_payment_result(
                {
                    "ok": True,
                    "status": "paid",
                    "mock": True,
                    "imp_uid": eff_imp,
                    "merchant_uid": merchant_uid or payment_id,
                    "payment_id": payment_id or merchant_uid,
                }
            )
            _maybe_promote_to_pending(True, eff_imp, merchant_uid or payment_id)
            return out

        if self.provider in ("kpn", "kpn_korea", "한국결제네트웍스") and payment_id:
            pr = self._portone_v2_get_payment(payment_id)
            if pr:
                status = (pr.get("status") or "").upper()
                paid = status == "PAID"
                amt = pr.get("totalAmount") or pr.get("amount")
                _append_payment_result(
                    {
                        "ok": paid,
                        "status": status.lower() if status else pr.get("status"),
                        "amount": amt,
                        "payment_id": payment_id,
                        "merchant_uid": payment_id,
                        "imp_uid": pr.get("transactionId") or pr.get("pgTxId") or imp_uid,
                        "raw": pr,
                    }
                )
                _maybe_promote_to_pending(
                    paid,
                    pr.get("transactionId") or pr.get("pgTxId") or imp_uid or payment_id,
                    payment_id,
                )
                return out
            _append_payment_result({"ok": False, "error": "KPN(포트원 V2) 결제 조회 실패", "payment_id": payment_id})
            return out

        if self.provider == "portone" and imp_uid and requests:
            token = self._portone_token()
            if not token:
                _append_payment_result({"ok": False, "error": "포트원 토큰 발급 실패"})
                return out
            try:
                r = requests.get(
                    f"https://api.iamport.kr/payments/{imp_uid}",
                    headers={"Authorization": token},
                    timeout=15,
                )
                data = r.json() if r.text else {}
                if r.status_code == 200 and data.get("response"):
                    pr = data["response"]
                    paid = pr.get("status") == "paid"
                    mu = (pr.get("merchant_uid") or merchant_uid or "").strip()
                    _append_payment_result(
                        {
                            "ok": paid,
                            "status": pr.get("status"),
                            "amount": pr.get("amount"),
                            "imp_uid": imp_uid,
                            "merchant_uid": mu,
                            "raw": pr,
                        }
                    )
                    _maybe_promote_to_pending(paid, imp_uid, mu)
                    return out
            except Exception as e:
                _append_payment_result({"ok": False, "error": str(e)})
                return out
        _append_payment_result(
            {
                "ok": False,
                "error": "payment_id(또는 imp_uid) 또는 PAYMENT_PROVIDER 설정을 확인하세요.",
                "payment_id": payment_id,
                "imp_uid": imp_uid,
                "merchant_uid": merchant_uid,
            }
        )
        return out
