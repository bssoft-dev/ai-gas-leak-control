import os
from typing import Any, Optional


def mask_secret(value: str, *, head: int = 4, tail: int = 4) -> str:
    """응답용: 키 전체를 노출하지 않고 앞/뒤 일부만 표시."""
    if not value:
        return ""
    if len(value) <= head + tail + 3:
        return "***"
    return f"{value[:head]}...{value[-tail:]}"


class Settings:
    def __init__(self) -> None:
        self.supabase_url = (os.getenv("SUPABASE_URL") or "").strip()
        self.supabase_service_role_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        self.supabase_anon_key = (os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
        self.supabase_schema = (os.getenv("HUB_SUPABASE_SCHEMA") or "bs_message_hub").strip()

        self.module_event_timeout_s = float(os.getenv("HUB_MODULE_EVENT_TIMEOUT", "10"))
        self.callback_public_base_url = (os.getenv("HUB_CALLBACK_BASE_URL") or "").strip()

        # 모듈 주소는 "llm=http://llm_module:8000/event,git=http://git_module:8000/event" 형태도 허용
        raw_addrs = (os.getenv("HUB_MODULE_ADDRS") or "").strip()
        self.module_addrs = self._parse_kv_csv(raw_addrs) if raw_addrs else {}

        # 레시피는 "code_gen_service=llm|git,service_a=llm" 형태도 허용
        raw_recipes = (os.getenv("HUB_RECIPES") or "").strip()
        self.recipes = self._parse_recipes(raw_recipes) if raw_recipes else {}

        # POST /supabase/config 보호용 (비어 있으면 인증 없이 허용 — 개발 전용)
        self.config_secret = (os.getenv("HUB_CONFIG_SECRET") or "").strip()

        # 허브 GET /services: 기본은 저장소 루트의 services/ (Docker 등에서는 절대 경로로 지정)
        self.hub_services_dir = (os.getenv("HUB_SERVICES_DIR") or "").strip()

    def validate(self) -> None:
        if not self.supabase_url:
            raise RuntimeError("SUPABASE_URL is required")
        if not (self.supabase_service_role_key or self.supabase_anon_key):
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required")

    @property
    def supabase_key(self) -> str:
        # 쓰기 작업은 Service Role Key 권장 (RLS 우회)
        return self.supabase_service_role_key or self.supabase_anon_key

    def to_supabase_config_public(self) -> dict[str, Any]:
        """클라이언트에 내려줄 수 있는(비밀 마스킹) Supabase 관련 설정 스냅샷."""
        has_sr = bool(self.supabase_service_role_key)
        has_anon = bool(self.supabase_anon_key)
        effective = "service_role" if has_sr else ("anon" if has_anon else "none")
        return {
            "supabase_url": self.supabase_url,
            "supabase_schema": self.supabase_schema,
            "has_service_role_key": has_sr,
            "has_anon_key": has_anon,
            "effective_key_role": effective,
            "service_role_key_preview": mask_secret(self.supabase_service_role_key),
            "anon_key_preview": mask_secret(self.supabase_anon_key),
            "config_auth_required": bool(self.config_secret),
        }

    def apply_supabase_overrides(
        self,
        body: dict[str, Any],
        *,
        sync_environ: bool = True,
    ) -> None:
        """
        런타임에 Supabase URL/키 갱신. body 키가 없으면 유지, None 또는 "" 이면 해당 필드 비움.
        """
        def _get_str(key: str) -> Optional[str]:
            if key not in body:
                return None
            v = body.get(key)
            if v is None:
                return ""
            return str(v).strip()

        u = _get_str("supabase_url")
        if u is not None:
            self.supabase_url = u
            if sync_environ:
                if self.supabase_url:
                    os.environ["SUPABASE_URL"] = self.supabase_url
                else:
                    os.environ.pop("SUPABASE_URL", None)

        sr = _get_str("supabase_service_role_key")
        if sr is not None:
            self.supabase_service_role_key = sr
            if sync_environ:
                if self.supabase_service_role_key:
                    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = self.supabase_service_role_key
                else:
                    os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)

        ak = _get_str("supabase_anon_key")
        if ak is not None:
            self.supabase_anon_key = ak
            if sync_environ:
                if self.supabase_anon_key:
                    os.environ["SUPABASE_ANON_KEY"] = self.supabase_anon_key
                    os.environ["SUPABASE_KEY"] = self.supabase_anon_key
                else:
                    os.environ.pop("SUPABASE_ANON_KEY", None)
                    os.environ.pop("SUPABASE_KEY", None)

    @staticmethod
    def _parse_kv_csv(s: str) -> dict[str, str]:
        out: dict[str, str] = {}
        for part in s.split(","):
            part = part.strip()
            if not part:
                continue
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            k = k.strip()
            v = v.strip()
            if k and v:
                out[k] = v
        return out

    @staticmethod
    def _parse_recipes(s: str) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for part in s.split(","):
            part = part.strip()
            if not part or "=" not in part:
                continue
            svc, steps_raw = part.split("=", 1)
            svc = svc.strip()
            steps = [x.strip() for x in steps_raw.split("|") if x.strip()]
            if svc and steps:
                out[svc] = steps
        return out


settings = Settings()

