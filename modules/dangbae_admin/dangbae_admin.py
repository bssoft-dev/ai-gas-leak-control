"""
M_DangbaeAdmin: 당배 관리자 전용 모듈
- ADMIN_AUTH: 비밀번호 검증
- ADMIN_DRIVER_LIST: 배송원 목록 조회
- ADMIN_DRIVER_SAVE: 배송원 등록/수정
- ADMIN_DRIVER_DELETE: 배송원 삭제
배송원 데이터: services/dangbae/data/drivers.json
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DRIVERS_FILE = PROJECT_ROOT / "services" / "dangbae" / "data" / "drivers.json"
KAKAO_CODES_FILE = PROJECT_ROOT / "services" / "dangbae" / "data" / "kakao_codes.json"
ADMIN_PASSWORD = os.getenv("DANGBAE_ADMIN_PASSWORD", "admin123")
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "ee5b2ac53eda17c8ab823a90fb9b573a")
KAKAO_REDIRECT_URI = os.getenv("KAKAO_REDIRECT_URI", "https://dangbae.bs-soft.co.kr")
KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"


def _ensure_drivers_dir() -> Path:
    DRIVERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    return DRIVERS_FILE.parent


def _load_drivers() -> List[Dict[str, Any]]:
    _ensure_drivers_dir()
    if not DRIVERS_FILE.exists():
        return []
    try:
        with open(DRIVERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_drivers(drivers: List[Dict[str, Any]]) -> None:
    _ensure_drivers_dir()
    with open(DRIVERS_FILE, "w", encoding="utf-8") as f:
        json.dump(drivers, f, ensure_ascii=False, indent=2)


class DangbaeAdminModule(Module):
    """당배 관리자: 비밀번호 인증, 배송원 CRUD"""

    name = "M_DangbaeAdmin"
    description = "당배 관리자 (비밀번호 인증, 배송원 등록/수정/삭제)"
    capabilities = [
        "ADMIN_AUTH",
        "ADMIN_DRIVER_LIST",
        "ADMIN_DRIVER_SAVE",
        "ADMIN_DRIVER_DELETE",
        "ADMIN_SAVE_KAKAO_CODE",
    ]

    def __init__(self, password: str = ""):
        super().__init__()
        self._admin_password = (password or os.getenv("DANGBAE_ADMIN_PASSWORD", ADMIN_PASSWORD)).strip()

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "ADMIN_AUTH":
            return self._process_auth(event)
        if event.type == "ADMIN_DRIVER_LIST":
            return self._process_driver_list(event)
        if event.type == "ADMIN_DRIVER_SAVE":
            return self._process_driver_save(event)
        if event.type == "ADMIN_DRIVER_DELETE":
            return self._process_driver_delete(event)
        if event.type == "ADMIN_SAVE_KAKAO_CODE":
            return self._process_save_kakao_code(event)
        return []

    def _process_auth(self, event: Event) -> List[Event]:
        p = event.payload or {}
        password = (p.get("password") or "").strip()
        ok = bool(self._admin_password and password and password == self._admin_password)
        return [
            Event(
                type="ADMIN_AUTH_RESULT",
                payload={"ok": ok},
                source_module=self.name,
            )
        ]

    def _process_driver_list(self, event: Event) -> List[Event]:
        drivers = _load_drivers()
        return [
            Event(
                type="ADMIN_DRIVER_LIST_RESULT",
                payload={"drivers": drivers},
                source_module=self.name,
            )
        ]

    def _process_driver_save(self, event: Event) -> List[Event]:
        p = event.payload or {}
        driver_id = (p.get("id") or "").strip()
        name = (p.get("name") or "").strip()
        phone = (p.get("phone") or "").strip()
        status = (p.get("status") or "pending").strip()  # 동의 상태: agreed, pending
        situation = (p.get("situation") or "waiting").strip()  # 대기, 배송중, 휴무

        if not name or not phone:
            return [
                Event(
                    type="ADMIN_DRIVER_SAVED",
                    payload={"ok": False, "error": "이름과 전화번호는 필수입니다."},
                    source_module=self.name,
                )
            ]

        drivers = _load_drivers()
        if driver_id:
            for i, d in enumerate(drivers):
                if str(d.get("id")) == str(driver_id):
                    drivers[i] = {
                        "id": d["id"],
                        "name": name,
                        "phone": phone,
                        "status": status,
                        "situation": situation,
                        "kakao_code": d.get("kakao_code"),
                        "kakao_access_token": d.get("kakao_access_token"),
                        "kakao_refresh_token": d.get("kakao_refresh_token"),
                    }
                    _save_drivers(drivers)
                    return [
                        Event(
                            type="ADMIN_DRIVER_SAVED",
                            payload={"ok": True, "driver": drivers[i]},
                            source_module=self.name,
                        )
                    ]
            return [
                Event(
                    type="ADMIN_DRIVER_SAVED",
                    payload={"ok": False, "error": "해당 배송원을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        new_id = str(uuid.uuid4())[:8]
        new_driver = {"id": new_id, "name": name, "phone": phone, "status": status, "situation": situation}
        drivers.append(new_driver)
        _save_drivers(drivers)
        return [
            Event(
                type="ADMIN_DRIVER_SAVED",
                payload={"ok": True, "driver": new_driver},
                source_module=self.name,
            )
        ]

    def _process_driver_delete(self, event: Event) -> List[Event]:
        p = event.payload or {}
        driver_id = (p.get("id") or "").strip()
        if not driver_id:
            return [
                Event(
                    type="ADMIN_DRIVER_DELETED",
                    payload={"ok": False, "error": "id가 필요합니다."},
                    source_module=self.name,
                )
            ]
        drivers = _load_drivers()
        new_list = [d for d in drivers if str(d.get("id")) != str(driver_id)]
        if len(new_list) == len(drivers):
            return [
                Event(
                    type="ADMIN_DRIVER_DELETED",
                    payload={"ok": False, "error": "해당 배송원을 찾을 수 없습니다."},
                    source_module=self.name,
                )
            ]
        _save_drivers(new_list)
        return [
            Event(
                type="ADMIN_DRIVER_DELETED",
                payload={"ok": True, "id": driver_id},
                source_module=self.name,
            )
        ]

    def _process_save_kakao_code(self, event: Event) -> List[Event]:
        """카카오 인증 code 저장 및 선택 시 해당 배송원 동의 상태·코드 갱신"""
        p = event.payload or {}
        code = (p.get("code") or "").strip()
        driver_id = (p.get("driver_id") or "").strip()
        if not code:
            return [
                Event(
                    type="ADMIN_KAKAO_CODE_SAVED",
                    payload={"ok": False, "error": "code가 필요합니다."},
                    source_module=self.name,
                )
            ]
        _ensure_drivers_dir()
        codes = []
        if KAKAO_CODES_FILE.exists():
            try:
                with open(KAKAO_CODES_FILE, "r", encoding="utf-8") as f:
                    codes = json.load(f)
                if not isinstance(codes, list):
                    codes = []
            except Exception:
                codes = []
        codes.append({"code": code, "driver_id": driver_id or None, "saved_at": datetime.now(timezone.utc).isoformat()})
        with open(KAKAO_CODES_FILE, "w", encoding="utf-8") as f:
            json.dump(codes, f, ensure_ascii=False, indent=2)
        if driver_id:
            drivers = _load_drivers()
            for i, d in enumerate(drivers):
                if str(d.get("id")) == str(driver_id):
                    drivers[i] = {**d, "status": "agreed", "kakao_code": code}
                    _save_drivers(drivers)
                    if requests and KAKAO_REST_API_KEY:
                        tokens = _exchange_kakao_code(code)
                        if tokens:
                            drivers[i]["kakao_access_token"] = tokens.get("access_token")
                            drivers[i]["kakao_refresh_token"] = tokens.get("refresh_token")
                            _save_drivers(drivers)
                    break
        return [
            Event(
                type="ADMIN_KAKAO_CODE_SAVED",
                payload={"ok": True, "driver_id": driver_id or None},
                source_module=self.name,
            )
        ]


def _exchange_kakao_code(code: str) -> Dict[str, Any]:
    """인가 코드로 액세스/리프레시 토큰 발급"""
    if not requests or not code:
        return {}
    try:
        r = requests.post(
            KAKAO_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": KAKAO_REST_API_KEY,
                "redirect_uri": KAKAO_REDIRECT_URI,
                "code": code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if r.status_code != 200:
            return {}
        return r.json()
    except Exception:
        return {}
