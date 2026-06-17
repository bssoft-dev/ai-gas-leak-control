"""
M_DocContextLLM: DOC_ACTION → DOC_CTX_END
"""
from __future__ import annotations

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


class DocContextLLMModule(Module):
    name = "M_DocContextLLM"
    description = "컨텍스트 탭: DOC_ACTION → DOC_CTX_END"
    capabilities = ["DOC_ACTION"]

    def __init__(self) -> None:
        super().__init__()
        self.api_base = LLM_API_BASE
        self.api_key = LLM_API_KEY
        self.default_model = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
        self.chat_url = f"{self.api_base}/chat"

    def can_handle(self, event: Event) -> float:
        if event.type != "DOC_ACTION":
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "DOC_ACTION":
            return []
        p = event.payload or {}
        tab_id = p.get("tab_id")
        request_id = p.get("request_id")
        model = (p.get("model") or self.default_model).strip() or self.default_model
        body = p.get("body") or ""
        system_prompt = (p.get("system_prompt") or "").strip() or "You help refine or generate context tab content for a document."
        document_title = p.get("document_title") or ""
        history = p.get("history") or []
        if not isinstance(history, list):
            history = []

        if not requests:
            return [self._end(tab_id, request_id, False, None, "requests not installed")]

        system = system_prompt
        if document_title:
            system += f"\n\n## Document title\n{document_title}\n"
        system += f"\n\n## Current document body (markdown)\n{str(body)[:20000]}\n"

        messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
        for h in history[-20:]:
            if not isinstance(h, dict):
                continue
            role = h.get("role")
            c = h.get("content")
            if role in ("user", "assistant") and isinstance(c, str):
                messages.append({"role": role, "content": c})
        user_msg = "Apply the system instructions and produce the updated context tab content in markdown."
        messages.append({"role": "user", "content": user_msg})

        req_body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        try:
            r = requests.post(self.chat_url, json=req_body, headers=h, timeout=300)
            r.raise_for_status()
            data = r.json()
            text = _extract_content(data)
            return [self._end(tab_id, request_id, True, text, None)]
        except Exception as e:
            return [self._end(tab_id, request_id, False, None, str(e))]

    def _end(
        self,
        tab_id: Any,
        request_id: Any,
        success: bool,
        response: Optional[str],
        error: Optional[str],
    ) -> Event:
        pl: Dict[str, Any] = {
            "tab_id": tab_id,
            "request_id": request_id,
            "success": success,
            "response": response or "",
        }
        if error is not None:
            pl["error"] = error
        return Event(type="DOC_CTX_END", payload=pl, source_module=self.name)
