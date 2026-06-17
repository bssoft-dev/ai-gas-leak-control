"""
M_DocChatLLM: CHAT_MESSAGE → LLM → CHAT_RESPONSE
도큐먼트 작성 UI(onChatMessage)와 연동. 텍스트 / 멀티모달 / VLM 업로드 지원.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    import requests
except ImportError:
    requests = None

LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
# 기본 /chat 이 410 Gone 인 경우: LLM_CHAT_URL(전체 URL) 또는 LLM_CHAT_PATH(베이스 하위 경로)로 교체
# 예: LLM_CHAT_PATH=/v1/chat/completions  |  LLM_CHAT_URL=https://호스트/v1/chat/completions
LLM_CHAT_URL = (os.getenv("LLM_CHAT_URL") or "").strip()
LLM_CHAT_PATH = (os.getenv("LLM_CHAT_PATH") or "/chat").strip() or "/chat"
if not LLM_CHAT_PATH.startswith("/"):
    LLM_CHAT_PATH = "/" + LLM_CHAT_PATH
# multimodal(기본) | vlm_upload
DEFAULT_ATTACHMENT_MODE = os.getenv("DOC_CHAT_ATTACHMENT_MODE", "multimodal").strip().lower() or "multimodal"
# POST /chat 본문: { model, messages, stream } 만 허용하는 게이트웨이 — 기본은 이 세 필드만 전송
LLM_CHAT_SEND_OPTIONAL = os.getenv("LLM_CHAT_SEND_OPTIONAL", "0").strip().lower() in (
    "1",
    "true",
    "yes",
)


def _load_system_prompt() -> str:
    p = Path(__file__).resolve().parent / "system_prompt.md"
    if p.is_file():
        try:
            return p.read_text(encoding="utf-8")
        except OSError:
            pass
    return (
        "You are a document writing assistant. "
        "When changing the document, output valid JSON with assistant_message and optional document_edit as required by the app."
    )


class DocChatLLMModule(Module):
    name = "M_DocChatLLM"
    description = "문서 채팅: CHAT_MESSAGE → CHAT_RESPONSE"
    capabilities = ["CHAT_MESSAGE"]

    def __init__(self) -> None:
        super().__init__()
        self.api_base = LLM_API_BASE
        self.api_key = LLM_API_KEY
        self.default_model = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
        self.vlm_model = os.getenv("VLM_CHAT_MODEL", self.default_model)
        self.chat_url = LLM_CHAT_URL if LLM_CHAT_URL else f"{self.api_base}{LLM_CHAT_PATH}"
        self.multimodal_url = f"{self.api_base}/chat/multimodal/nim"
        self.vlm_upload_url = f"{self.api_base}/chat/vlm/nim/upload"
        self._system_prompt = _load_system_prompt()

    def can_handle(self, event: Event) -> float:
        if event.type != "CHAT_MESSAGE":
            return 0.0
        p = event.payload or {}
        if not (p.get("message") or "").strip():
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "CHAT_MESSAGE":
            return []
        p = event.payload or {}
        req_id = p.get("request_id") or p.get("requestId")
        message = (p.get("message") or "").strip()
        if not message:
            return [self._fail(req_id, "empty message", p)]

        model = (p.get("model") or self.default_model).strip() or self.default_model
        vlm_model = (p.get("vlm_model") or p.get("VLM_MODEL") or self.vlm_model).strip() or self.vlm_model
        mode = (p.get("attachment_mode") or DEFAULT_ATTACHMENT_MODE).strip().lower() or "multimodal"
        if mode not in ("multimodal", "vlm_upload"):
            mode = "multimodal"

        document_title = p.get("document_title") or ""
        editor_content = p.get("editor_content") or ""
        context_content = p.get("context_content") or ""
        cursor_block = p.get("cursor_block_content") or ""
        history = p.get("history") or []
        if not isinstance(history, list):
            history = []

        system = self._build_system_block(document_title, editor_content, context_content, cursor_block)
        user_text = self._build_user_envelope(p, message)

        attachments = p.get("attachments")
        if attachments and isinstance(attachments, list) and len(attachments) > 0:
            if mode == "vlm_upload":
                text, err = self._call_vlm_upload(
                    vlm_model, system, user_text, attachments, p
                )
            else:
                text, err = self._call_multimodal_nim(
                    vlm_model, system, user_text, history, attachments, p
                )
        else:
            text, err = self._call_text_chat(model, system, user_text, history, p)

        if err:
            return [self._fail(req_id, err, p)]
        return [
            Event(
                type="CHAT_RESPONSE",
                payload={
                    "request_id": req_id,
                    "success": True,
                    "response": text,
                    "client_op": p.get("client_op"),
                },
                source_module=self.name,
            )
        ]

    def _build_system_block(
        self, title: str, editor: str, ctx: str, cursor: str
    ) -> str:
        parts = [self._system_prompt, ""]
        if title:
            parts.append(f"## 문서 제목\n{title}\n")
        if editor:
            parts.append(f"## 현재 본문(마크다운)\n{editor}\n")
        if ctx:
            parts.append(f"## 활성 컨텍스트\n{ctx}\n")
        if cursor:
            parts.append(f"## 커서 근처 블록\n{cursor}\n")
        return "\n".join(parts).strip()

    def _build_user_envelope(self, p: Dict[str, Any], message: str) -> str:
        extra = {k: v for k, v in p.items() if k in ("user_display_name", "locale")}
        if extra:
            return f"{message}\n\n(메타: {json.dumps(extra, ensure_ascii=False)})"
        return message

    def _fail(
        self,
        request_id: Optional[str],
        error: str,
        source_payload: Optional[Dict[str, Any]] = None,
    ) -> Event:
        client_op: Optional[str] = None
        if source_payload and isinstance(source_payload, dict):
            client_op = source_payload.get("client_op")
        return Event(
            type="CHAT_RESPONSE",
            payload={
                "request_id": request_id,
                "success": False,
                "error": error,
                "response": "",
                "client_op": client_op,
            },
            source_module=self.name,
        )

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _call_text_chat(
        self,
        model: str,
        system: str,
        user_text: str,
        history: List[Dict[str, Any]],
        p: Dict[str, Any],
    ) -> Tuple[str, Optional[str]]:
        if not requests:
            return "", "requests not installed"
        messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
        for h in history[-40:]:
            if not isinstance(h, dict):
                continue
            role = h.get("role")
            content = h.get("content")
            if role in ("user", "assistant") and isinstance(content, str):
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_text})
        # https://llm-api.bs-soft.co.kr/chat — { "model", "messages", "stream": false }
        body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if LLM_CHAT_SEND_OPTIONAL:
            for key in ("temperature", "max_tokens", "top_p"):
                if p.get(key) is not None:
                    body[key] = p[key]
        try:
            r = requests.post(
                self.chat_url, json=body, headers=self._headers(), timeout=300
            )
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data), None
        except Exception as e:
            return "", str(e)

    def _call_multimodal_nim(
        self,
        model: str,
        system: str,
        user_text: str,
        history: List[Dict[str, Any]],
        attachments: List[Dict[str, Any]],
        p: Dict[str, Any],
    ) -> Tuple[str, Optional[str]]:
        if not requests:
            return "", "requests not installed"
        # OpenAI-style: user message with text + image_url parts
        content_parts: List[Dict[str, Any]] = [{"type": "text", "text": user_text}]
        for att in attachments:
            if not isinstance(att, dict):
                continue
            b64 = att.get("data") or att.get("base64") or att.get("image_base64")
            mime = att.get("mime_type") or att.get("mime") or "image/png"
            if b64 and isinstance(b64, str):
                if b64.startswith("data:"):
                    url = b64
                else:
                    url = f"data:{mime};base64,{b64}"
                content_parts.append({"type": "image_url", "image_url": {"url": url}})

        messages: List[Dict[str, Any]] = [{"role": "system", "content": system}]
        for h in history[-20:]:
            if not isinstance(h, dict):
                continue
            role = h.get("role")
            c = h.get("content")
            if role in ("user", "assistant") and isinstance(c, str):
                messages.append({"role": role, "content": c})
        messages.append({"role": "user", "content": content_parts})

        body: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        for key in ("temperature", "max_tokens", "top_p"):
            if p.get(key) is not None:
                body[key] = p[key]
        try:
            r = requests.post(
                self.multimodal_url, json=body, headers=self._headers(), timeout=300
            )
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data), None
        except Exception as e:
            return "", str(e)

    def _call_vlm_upload(
        self,
        model: str,
        system: str,
        user_text: str,
        attachments: List[Dict[str, Any]],
        p: Dict[str, Any],
    ) -> Tuple[str, Optional[str]]:
        if not requests:
            return "", "requests not installed"
        files = []
        for i, att in enumerate(attachments):
            if not isinstance(att, dict):
                continue
            raw = att.get("data") or att.get("base64") or att.get("image_base64")
            mime = (att.get("mime_type") or att.get("mime") or "image/png").split(";")[
                0
            ]
            name = att.get("filename") or f"image_{i}.png"
            if not raw or not isinstance(raw, str):
                continue
            if raw.startswith("data:"):
                raw = raw.split(",", 1)[-1]
            try:
                binary = base64.b64decode(raw)
            except Exception:
                continue
            files.append(("images", (name, binary, mime)))

        if not files:
            return "", "no valid image bytes for vlm_upload"

        data: Dict[str, str] = {
            "model": model,
            "system_prompt": system,
            "user_message": user_text,
        }
        for key in ("temperature", "max_tokens", "top_p"):
            if p.get(key) is not None:
                data[key] = str(p[key])
        h = {k: v for k, v in self._headers().items() if k != "Content-Type"}
        try:
            r = requests.post(
                self.vlm_upload_url, data=data, files=files, headers=h, timeout=300
            )
            r.raise_for_status()
            j = r.json()
            if isinstance(j, dict) and "text" in j:
                return str(j.get("text") or ""), None
            return self._extract_content(j) if isinstance(j, dict) else (str(j), None)
        except Exception as e:
            return "", str(e)

    def _extract_content(self, data: dict) -> str:
        if "choices" in data and data["choices"]:
            c0 = data["choices"][0]
            if "message" in c0:
                m = c0["message"]
                if isinstance(m, dict) and m.get("content") is not None:
                    c = m["content"]
                    if isinstance(c, str):
                        return c.strip()
                    if isinstance(c, list):
                        out = []
                        for part in c:
                            if isinstance(part, dict) and part.get("type") == "text":
                                out.append(part.get("text") or "")
                        return "".join(out).strip()
        if "message" in data and isinstance(data["message"], str):
            return data["message"].strip()
        if "content" in data and isinstance(data["content"], str):
            return data["content"].strip()
        if "response" in data and isinstance(data["response"], str):
            return data["response"].strip()
        return json.dumps(data, ensure_ascii=False) if data else ""
