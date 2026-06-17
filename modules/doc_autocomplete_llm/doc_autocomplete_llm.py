"""
M_DocAutocompleteLLM: AUTOCOMPLETE_REQUEST → AUTOCOMPLETE_RESPONSE
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    import requests
except ImportError:
    requests = None

LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")


def _extract_content(data: dict) -> str:
    if "choices" in data and data["choices"]:
        c0 = data["choices"][0]
        if "message" in c0 and isinstance(c0["message"], dict):
            return (c0["message"].get("content") or "").strip()
    if "content" in data and isinstance(data["content"], str):
        return data["content"].strip()
    if "response" in data and isinstance(data["response"], str):
        return data["response"].strip()
    return ""


class DocAutocompleteLLMModule(Module):
    name = "M_DocAutocompleteLLM"
    description = "문서 자동완성: AUTOCOMPLETE_REQUEST → AUTOCOMPLETE_RESPONSE"
    capabilities = ["AUTOCOMPLETE_REQUEST"]

    def __init__(self) -> None:
        super().__init__()
        self.api_base = LLM_API_BASE
        self.api_key = LLM_API_KEY
        self.default_model = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
        self.chat_url = f"{self.api_base}/chat"

    def can_handle(self, event: Event) -> float:
        if event.type != "AUTOCOMPLETE_REQUEST":
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "AUTOCOMPLETE_REQUEST":
            return []
        p = event.payload or {}
        request_id = p.get("request_id")
        model = (p.get("model") or self.default_model).strip() or self.default_model
        body = p.get("body") or p.get("editor_content") or ""
        before = p.get("before_cursor") or p.get("cursor_text_before") or ""
        after = p.get("after_cursor") or ""

        if not requests:
            return [self._resp(request_id, False, "", "requests not installed")]

        system = (
            "You are a writing assistant. Return ONLY the short completion text to insert at the cursor, "
            "no quotes and no explanation. One line or a short phrase."
        )
        user = f"Document context (markdown):\n{str(body)[:12000]}\n\n"
        user += f"Text before cursor:\n{before}\n\nText after cursor:\n{after}\n\nSuggest completion:"

        req_body: Dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "max_tokens": 128,
        }
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        try:
            r = requests.post(self.chat_url, json=req_body, headers=h, timeout=60)
            r.raise_for_status()
            data = r.json()
            text = _extract_content(data)
            return [self._resp(request_id, True, text, None)]
        except Exception as e:
            return [self._resp(request_id, False, "", str(e))]

    def _resp(
        self,
        request_id: Optional[str],
        success: bool,
        suggestion: str,
        err: Optional[str],
    ) -> Event:
        pl: Dict[str, Any] = {
            "request_id": request_id,
            "success": success,
            "suggestion": suggestion,
        }
        if err is not None:
            pl["error"] = err
        return Event(type="AUTOCOMPLETE_RESPONSE", payload=pl, source_module=self.name)
