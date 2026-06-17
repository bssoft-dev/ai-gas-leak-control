"""
파일첨부 모듈: EVT_PROMPT_WITH_ATTACHMENTS 이벤트 처리
- payload(context, system_prompt, prompt, attachments[{name, content}], model) 수신
- 첨부 파일 내용을 컨텍스트에 병합 후 LLM_PROMPT 발행
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class FileAttachmentModule(Module):
    """
    EVT_PROMPT_WITH_ATTACHMENTS를 받아 첨부 파일 내용을 context에 병합한 뒤 LLM_PROMPT 발행.
    payload: context (str), system_prompt (str), prompt (str), attachments ([{name, content}]), model (str, 선택)
    """

    name = "M_FileAttachment"
    description = "프롬프트와 첨부 파일을 병합하여 LLM_PROMPT 발행"
    capabilities = ["EVT_PROMPT_WITH_ATTACHMENTS"]

    def can_handle(self, event: Event) -> float:
        if event.type != "EVT_PROMPT_WITH_ATTACHMENTS":
            return 0.0
        payload = event.payload or {}
        if not payload.get("prompt"):
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "EVT_PROMPT_WITH_ATTACHMENTS":
            return []
        payload = event.payload or {}
        context = payload.get("context") or ""
        system_prompt = payload.get("system_prompt") or ""
        prompt = payload.get("prompt") or ""
        attachments = payload.get("attachments") or []
        model = payload.get("model") or ""

        # system_prompt + 첨부 내용 + context 순으로 병합
        parts: List[str] = []
        if system_prompt.strip():
            parts.append(system_prompt.strip())
        for att in attachments:
            if isinstance(att, dict):
                name = att.get("name") or att.get("filename") or "첨부"
                content = att.get("content") or ""
                if content.strip():
                    parts.append(f"--- 첨부: {name} ---\n{content.strip()}\n---")
            elif isinstance(att, str):
                parts.append(att.strip())
        if context.strip():
            parts.append(context.strip())

        merged_context = "\n\n".join(parts) if parts else ""

        out_payload: Dict[str, Any] = {
            "prompt": prompt,
            "context": merged_context or None,
            "model": model or None,
            "intent": payload.get("intent", "thinking_monitor"),
        }
        out_payload = {k: v for k, v in out_payload.items() if v is not None}

        return [
            Event(
                type="LLM_PROMPT",
                payload=out_payload,
                source_module=self.name,
            )
        ]
