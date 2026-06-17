"""
M_KakaoAlarm: 카카오톡 나에게 보내기 알림
- DANGBAE_ORDER_CREATED: 신규 배송 등록 시 대기 중인 동의 배송원들에게 알림
- DANGBAE_DRIVER_ASSIGNED: 배송 할당 시 해당 배송원에게 알림
- DANGBAE_DELIVERY_CONFIRMED: 배송 완료 시 해당 배송원에게 알림
배송원 토큰: services/dangbae/data/drivers.json (kakao_access_token, kakao_refresh_token)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DRIVERS_FILE = PROJECT_ROOT / "services" / "dangbae" / "data" / "drivers.json"
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "ee5b2ac53eda17c8ab823a90fb9b573a")
KAKAO_ADMIN_ACCESS_TOKEN = (os.getenv("KAKAO_ADMIN_ACCESS_TOKEN") or "").strip()
# 배송원 알림에 넣는 웹 링크 (당배 배송현황)
DANGBAE_PUBLIC_URL = (os.getenv("DANGBAE_PUBLIC_URL") or "https://dangbae.bs-soft.co.kr").rstrip("/")
KAKAO_SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"


def _load_drivers() -> List[Dict[str, Any]]:
    if not DRIVERS_FILE.exists():
        return []
    try:
        with open(DRIVERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_drivers(drivers: List[Dict[str, Any]]) -> None:
    DRIVERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DRIVERS_FILE, "w", encoding="utf-8") as f:
        json.dump(drivers, f, ensure_ascii=False, indent=2)


def _refresh_access_token(driver: Dict[str, Any]) -> Optional[str]:
    """리프레시 토큰으로 액세스 토큰 갱신 후 driver에 반영"""
    if not requests or not KAKAO_REST_API_KEY:
        return None
    refresh = (driver.get("kakao_refresh_token") or "").strip()
    if not refresh:
        return driver.get("kakao_access_token")
    try:
        r = requests.post(
            KAKAO_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": KAKAO_REST_API_KEY,
                "refresh_token": refresh,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if r.status_code != 200:
            return driver.get("kakao_access_token")
        data = r.json()
        new_access = data.get("access_token")
        new_refresh = data.get("refresh_token")
        drivers = _load_drivers()
        for i, d in enumerate(drivers):
            if str(d.get("id")) == str(driver.get("id")):
                if new_access:
                    drivers[i]["kakao_access_token"] = new_access
                if new_refresh:
                    drivers[i]["kakao_refresh_token"] = new_refresh
                _save_drivers(drivers)
                break
        return new_access or driver.get("kakao_access_token")
    except Exception:
        return driver.get("kakao_access_token")


def _send_kakao_with_token(access_token: str, text: str, link_url: str = "https://dangbae.bs-soft.co.kr") -> bool:
    """액세스 토큰으로 카카오톡 나에게 보내기 (관리자 등)"""
    if not requests or not (access_token or "").strip():
        return False
    payload = {
        "template_object": json.dumps({
            "object_type": "text",
            "text": text,
            "link": {"web_url": link_url, "mobile_web_url": link_url},
            "button_title": "당배 확인",
        })
    }
    try:
        r = requests.post(
            KAKAO_SEND_URL,
            headers={"Authorization": f"Bearer {access_token.strip()}"},
            data=payload,
            timeout=10,
        )
        return r.status_code == 200
    except Exception:
        return False


def _send_kakao_text(driver: Dict[str, Any], text: str, link_url: str = "https://dangbae.bs-soft.co.kr") -> bool:
    """해당 배송원의 액세스 토큰으로 카카오톡 나에게 보내기"""
    if not requests:
        return False
    access = (driver.get("kakao_access_token") or "").strip()
    if not access:
        return False
    payload = {
        "template_object": json.dumps({
            "object_type": "text",
            "text": text,
            "link": {"web_url": link_url, "mobile_web_url": link_url},
            "button_title": "당배 확인",
        })
    }
    try:
        r = requests.post(
            KAKAO_SEND_URL,
            headers={"Authorization": f"Bearer {access}"},
            data=payload,
            timeout=10,
        )
        if r.status_code == 401:
            access = _refresh_access_token(driver)
            if access:
                r = requests.post(
                    KAKAO_SEND_URL,
                    headers={"Authorization": f"Bearer {access}"},
                    data=payload,
                    timeout=10,
                )
        return r.status_code == 200
    except Exception:
        return False


class KakaoAlarmModule(Module):
    """카카오톡 알림: 신규 배송 등록 / 배송 할당 / 완료 시 해당 배송원에게 메시지 전송"""

    name = "M_KakaoAlarm"
    description = "카카오톡 나에게 보내기 (배송 등록·할당·완료 알림)"
    capabilities = [
        "DANGBAE_ORDER_CREATED",
        "DANGBAE_DRIVER_ASSIGNED",
        "DANGBAE_DELIVERY_CONFIRMED",
    ]

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "DANGBAE_ORDER_CREATED":
            return self._on_order_created(event)
        if event.type == "DANGBAE_DRIVER_ASSIGNED":
            return self._on_driver_assigned(event)
        if event.type == "DANGBAE_DELIVERY_CONFIRMED":
            return self._on_delivery_confirmed(event)
        return []

    def _on_order_created(self, event: Event) -> List[Event]:
        """신규 배송 등록: 대기 중이며 동의한 배송원들에게 알림"""
        p = event.payload or {}
        order_id = p.get("order_id", "")
        origin = p.get("origin_address") or p.get("origin_detail") or ""
        dest = p.get("dest_address") or p.get("dest_detail") or ""
        link = f"{DANGBAE_PUBLIC_URL}/#/status?order={order_id}"
        text = (
            f"[당배] 신규 배송이 등록되었습니다.\n주문번호: {order_id}\n출발: {origin}\n도착: {dest}\n\n"
            f"배송 확인: {link}"
        )
        drivers = _load_drivers()
        for d in drivers:
            if (d.get("situation") == "waiting" and d.get("status") == "agreed" and d.get("kakao_access_token")):
                _send_kakao_text(d, text, link_url=link)
        if KAKAO_ADMIN_ACCESS_TOKEN:
            _send_kakao_with_token(KAKAO_ADMIN_ACCESS_TOKEN, text, link_url=link)
        return []

    def _on_driver_assigned(self, event: Event) -> List[Event]:
        """배송 할당: 해당 배송원에게 알림"""
        p = event.payload or {}
        driver_id = (p.get("driver_id") or "").strip()
        if not driver_id:
            return []
        drivers = _load_drivers()
        for d in drivers:
            if str(d.get("id")) == str(driver_id):
                order_id = p.get("order_id", "")
                origin = p.get("origin_address") or p.get("origin_detail") or ""
                dest = p.get("dest_address") or p.get("dest_detail") or ""
                link = f"{DANGBAE_PUBLIC_URL}/#/status?order={order_id}"
                text = (
                    f"[당배] 배송이 배정되었습니다.\n주문번호: {order_id}\n출발: {origin}\n도착: {dest}\n\n"
                    f"배송 확인: {link}"
                )
                _send_kakao_text(d, text, link_url=link)
                break
        return []

    def _on_delivery_confirmed(self, event: Event) -> List[Event]:
        """배송 완료: 해당 배송원에게 알림"""
        p = event.payload or {}
        driver_id = (p.get("driver_id") or "").strip()
        if not driver_id:
            return []
        drivers = _load_drivers()
        for d in drivers:
            if str(d.get("id")) == str(driver_id):
                order_id = p.get("order_id", "")
                text = f"[당배] 배송이 완료되었습니다.\n주문번호: {order_id}"
                _send_kakao_text(d, text)
                break
        return []
