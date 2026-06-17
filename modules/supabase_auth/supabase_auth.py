"""
M_SupabaseAuth: Supabase Auth 연동 (회원가입·로그인·OAuth URL)
- AUTH_SIGN_UP: 이메일/비밀번호 회원가입
- AUTH_SIGN_IN: 이메일/비밀번호 로그인
- AUTH_OAUTH_URL: 네이버·구글·카카오 등 간편로그인용 authorize URL 생성
  (Supabase 대시보드에서 해당 Provider 활성화 필요)

환경: SUPABASE_URL, SUPABASE_ANON_KEY (.env)
REST: https://supabase.com/docs/reference/api/auth-signup
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List
from urllib.parse import urlencode, urlparse

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

# Supabase가 지원하는 provider 슬러그 (프로젝트 설정에 따라 동작)
_ALLOWED_OAUTH = frozenset({"google", "kakao", "naver", "github", "apple"})


def _auth_headers() -> Dict[str, str]:
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        "Content-Type": "application/json",
    }


def _user_headers(user_token: str) -> Dict[str, str]:
    return {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {user_token}",
        "Content-Type": "application/json",
    }


class SupabaseAuthModule(Module):
    name = "M_SupabaseAuth"
    description = "Supabase Auth — 회원가입, 로그인, OAuth URL"
    capabilities = ["AUTH_SIGN_UP", "AUTH_SIGN_IN", "AUTH_OAUTH_URL", "AUTH_GET_USER", "AUTH_UPDATE_USER"]

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if not requests:
            return [
                Event(
                    type=f"{event.type}_RESULT",
                    payload={"ok": False, "error": "requests 패키지가 필요합니다."},
                    source_module=self.name,
                )
            ]
        if not SUPABASE_URL or not SUPABASE_ANON_KEY:
            return [
                Event(
                    type=f"{event.type}_RESULT",
                    payload={
                        "ok": False,
                        "error": "SUPABASE_URL, SUPABASE_ANON_KEY 를 .env에 설정하세요.",
                    },
                    source_module=self.name,
                )
            ]

        p = event.payload or {}
        if event.type == "AUTH_SIGN_UP":
            return self._sign_up(p)
        if event.type == "AUTH_SIGN_IN":
            return self._sign_in(p)
        if event.type == "AUTH_OAUTH_URL":
            return self._oauth_url(p)
        if event.type == "AUTH_GET_USER":
            return self._get_user(p)
        if event.type == "AUTH_UPDATE_USER":
            return self._update_user(p)
        return []

    def _sign_up(self, p: Dict[str, Any]) -> List[Event]:
        email = (p.get("email") or "").strip()
        password = p.get("password") or ""
        metadata = p.get("metadata") if isinstance(p.get("metadata"), dict) else {}
        if not email or not password:
            return [
                Event(
                    type="AUTH_SIGN_UP_RESULT",
                    payload={"ok": False, "error": "email과 password가 필요합니다."},
                    source_module=self.name,
                )
            ]
        body: Dict[str, Any] = {"email": email, "password": password}
        if metadata:
            body["data"] = metadata
        try:
            r = requests.post(
                f"{SUPABASE_URL}/auth/v1/signup",
                headers=_auth_headers(),
                data=json.dumps(body),
                timeout=30,
            )
            data = r.json() if r.text else {}
            if r.status_code not in (200, 201):
                return [
                    Event(
                        type="AUTH_SIGN_UP_RESULT",
                        payload={
                            "ok": False,
                            "error": data.get("msg") or data.get("error_description") or r.text or str(r.status_code),
                            "status_code": r.status_code,
                        },
                        source_module=self.name,
                    )
                ]
            user = data.get("user") or {}
            session = data.get("session") or {}
            return [
                Event(
                    type="AUTH_SIGN_UP_RESULT",
                    payload={
                        "ok": True,
                        "user": user,
                        "access_token": session.get("access_token"),
                        "refresh_token": session.get("refresh_token"),
                        "expires_in": session.get("expires_in"),
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="AUTH_SIGN_UP_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _sign_in(self, p: Dict[str, Any]) -> List[Event]:
        email = (p.get("email") or "").strip()
        password = p.get("password") or ""
        if not email or not password:
            return [
                Event(
                    type="AUTH_SIGN_IN_RESULT",
                    payload={"ok": False, "error": "email과 password가 필요합니다."},
                    source_module=self.name,
                )
            ]
        try:
            r = requests.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers=_auth_headers(),
                data=json.dumps({"email": email, "password": password}),
                timeout=30,
            )
            data = r.json() if r.text else {}
            if r.status_code != 200:
                return [
                    Event(
                        type="AUTH_SIGN_IN_RESULT",
                        payload={
                            "ok": False,
                            "error": data.get("error_description") or data.get("msg") or r.text or str(r.status_code),
                            "status_code": r.status_code,
                        },
                        source_module=self.name,
                    )
                ]
            user = data.get("user") or {}
            return [
                Event(
                    type="AUTH_SIGN_IN_RESULT",
                    payload={
                        "ok": True,
                        "user": user,
                        "access_token": data.get("access_token"),
                        "refresh_token": data.get("refresh_token"),
                        "expires_in": data.get("expires_in"),
                        "token_type": data.get("token_type"),
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="AUTH_SIGN_IN_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _oauth_url(self, p: Dict[str, Any]) -> List[Event]:
        provider = (p.get("provider") or "").strip().lower()
        redirect_to = (p.get("redirect_to") or "").strip()
        if not provider or provider not in _ALLOWED_OAUTH:
            return [
                Event(
                    type="AUTH_OAUTH_URL_RESULT",
                    payload={
                        "ok": False,
                        "error": f"provider는 다음 중 하나여야 합니다: {', '.join(sorted(_ALLOWED_OAUTH))}",
                    },
                    source_module=self.name,
                )
            ]
        if not redirect_to:
            return [
                Event(
                    type="AUTH_OAUTH_URL_RESULT",
                    payload={"ok": False, "error": "redirect_to (로그인 후 돌아올 URL)이 필요합니다."},
                    source_module=self.name,
                )
            ]
        # redirect_to 가 같은 사이트인지 간단 검사 (오타 방지)
        if not _safe_redirect(redirect_to):
            return [
                Event(
                    type="AUTH_OAUTH_URL_RESULT",
                    payload={"ok": False, "error": "redirect_to URL 형식이 올바르지 않습니다."},
                    source_module=self.name,
                )
            ]
        params = {
            "provider": provider,
            "redirect_to": redirect_to,
            "apikey": SUPABASE_ANON_KEY,
        }
        url = f"{SUPABASE_URL}/auth/v1/authorize?{urlencode(params)}"
        return [
            Event(
                type="AUTH_OAUTH_URL_RESULT",
                payload={
                    "ok": True,
                    "url": url,
                    "provider": provider,
                },
                source_module=self.name,
            )
        ]

    def _get_user(self, p: Dict[str, Any]) -> List[Event]:
        user_token = p.get("user_token") or ""
        if not user_token:
            return [
                Event(
                    type="AUTH_GET_USER_RESULT",
                    payload={"ok": False, "error": "로그인 토큰이 필요합니다."},
                    source_module=self.name,
                )
            ]
        try:
            r = requests.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers=_user_headers(user_token),
                timeout=30,
            )
            data = r.json() if r.text else {}
            if r.status_code != 200:
                return [
                    Event(
                        type="AUTH_GET_USER_RESULT",
                        payload={
                            "ok": False,
                            "error": data.get("msg") or data.get("error_description") or r.text or str(r.status_code),
                            "status_code": r.status_code,
                        },
                        source_module=self.name,
                    )
                ]
            return [
                Event(
                    type="AUTH_GET_USER_RESULT",
                    payload={
                        "ok": True,
                        "user": data,
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="AUTH_GET_USER_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _update_user(self, p: Dict[str, Any]) -> List[Event]:
        user_token = p.get("user_token") or ""
        password = p.get("password") or ""
        metadata = p.get("metadata") or {}
        if not user_token:
            return [
                Event(
                    type="AUTH_UPDATE_USER_RESULT",
                    payload={"ok": False, "error": "로그인 토큰이 필요합니다."},
                    source_module=self.name,
                )
            ]
        
        body: Dict[str, Any] = {}
        if password:
            body["password"] = password
        if metadata:
            body["data"] = metadata

        try:
            r = requests.put(
                f"{SUPABASE_URL}/auth/v1/user",
                headers=_user_headers(user_token),
                data=json.dumps(body),
                timeout=30,
            )
            data = r.json() if r.text else {}
            if r.status_code != 200:
                return [
                    Event(
                        type="AUTH_UPDATE_USER_RESULT",
                        payload={
                            "ok": False,
                            "error": data.get("msg") or data.get("error_description") or r.text or str(r.status_code),
                            "status_code": r.status_code,
                        },
                        source_module=self.name,
                    )
                ]
            return [
                Event(
                    type="AUTH_UPDATE_USER_RESULT",
                    payload={
                        "ok": True,
                        "user": data,
                        "access_token": data.get("access_token") or data.get("session", {}).get("access_token"),
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="AUTH_UPDATE_USER_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]


def _safe_redirect(url: str) -> bool:
    try:
        u = urlparse(url)
        if u.scheme in ("http", "https"):
            return bool(u.netloc)
        # Allow custom app deep links like com.nuridal.supabase://oauth
        return bool(u.scheme) and (bool(u.netloc) or bool(u.path))
    except Exception:
        return False
