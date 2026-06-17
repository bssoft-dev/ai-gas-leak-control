"""
LLM_PROMPT 이벤트 처리: payload(context, prompt, model)로 LLM 질의 후 회신
llm-api.bs-soft.co.kr /chat API 사용
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    import requests
except ImportError:
    requests = None

LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
CHAT_URL = f"{LLM_API_BASE.rstrip('/')}/chat"

# OpenAPI ChatRequest: model, messages[{role, content}], stream?(default false)


class LLMPromptModule(Module):
    """
    LLM_PROMPT 이벤트를 받아 context + prompt로 LLM 질의 후 회신 이벤트를 반환하는 모듈.
    payload: context (str, 선택), prompt (str), model (str, 선택)
    """

    name = "M_LLM_Prompt"
    description = "LLM_PROMPT 이벤트로 LLM 질의 후 회신"
    capabilities = ["LLM_PROMPT"]

    def __init__(self, api_base: str = "", api_key: str = ""):
        self.api_base = (api_base or LLM_API_BASE).rstrip("/")
        self.chat_url = f"{self.api_base}/chat"
        self.api_key = api_key or LLM_API_KEY
        self.default_model = os.getenv("LLM_MODEL", "gpt-4o-mini")

    def can_handle(self, event: Event) -> float:
        if event.type != "LLM_PROMPT":
            return 0.0
        payload = event.payload or {}
        if not payload.get("prompt"):
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "LLM_PROMPT":
            return []
        payload = event.payload or {}
        context = payload.get("context") or ""
        prompt = payload.get("prompt") or ""
        model = payload.get("model") or self.default_model
        if not prompt:
            return []

        messages: List[Dict[str, str]] = []
        if context:
            messages.append({"role": "system", "content": context})
        messages.append({"role": "user", "content": prompt})

        body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
        }

        content, raw, error = self._call_chat(body)
        # 요약 등 후속 처리용으로 원본 payload 필드 pass-through (context, prompt, model 제외)
        passthrough = {k: v for k, v in payload.items() if k not in ("context", "prompt", "model")}

        if error:
            return [
                Event(
                    type="LLM_PROMPT_RESPONSE",
                    payload={
                        "success": False,
                        "error": error,
                        "model": model,
                        "request_event_id": event.event_id,
                        **passthrough,
                    },
                    source_module=self.name,
                )
            ]

        return [
            Event(
                type="LLM_PROMPT_RESPONSE",
                payload={
                    "success": True,
                    "response": content,
                    "raw": raw,
                    "model": model,
                    "request_event_id": event.event_id,
                    **passthrough,
                },
                source_module=self.name,
            )
        ]

    def _call_chat(self, body: Dict[str, Any]):
        """POST /chat 호출. (content_text, raw_response, error_message) 반환."""
        if not requests:
            return "", None, "requests not installed"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            r = requests.post(
                self.chat_url,
                json=body,
                headers=headers,
                timeout=120,
            )
            r.raise_for_status()
            data = r.json()
            text = self._extract_content(data)
            return text, data, None
        except requests.RequestException as e:
            return "", None, str(e)
        except Exception as e:
            return "", None, str(e)

    def _extract_content(self, data: dict) -> str:
        """OpenAI/OpenAPI 호환 응답에서 assistant 메시지 텍스트 추출."""
        if "choices" in data and len(data["choices"]) > 0:
            c = data["choices"][0]
            if "message" in c and "content" in c["message"]:
                return (c["message"]["content"] or "").strip()
            if "text" in c:
                return (c["text"] or "").strip()
        if "message" in data:
            m = data["message"]
            return (m if isinstance(m, str) else m.get("content", "") or "").strip()
        if "content" in data:
            return (data["content"] or "").strip()
        if "response" in data:
            return (data["response"] or "").strip()
        return ""
