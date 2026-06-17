"""
M_LLM_Drafter: 텍스트를 읽고 메일 초안 작성
E_FileCreated → LLM 호출 → E_DraftReady
"""
import os
from pathlib import Path
from typing import List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    import requests
except ImportError:
    requests = None

LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_URL = f"{LLM_API_BASE.rstrip('/')}/chat"


class LLMDrafterModule(Module):
    """회의록 등 텍스트 → 메일 초안 생성"""

    name = "M_LLM_Drafter"
    description = "LLM을 사용한 이메일 초안 작성 모듈"
    capabilities = ["E_FileCreated"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "E_FileCreated":
            return 0.0
        path = event.payload.get("path", "")
        content = (event.payload.get("content") or "").strip()
        if not path or not content:
            return 0.0
        # 회의록/메모 형태일 때만 (옵션: 확장자 제한)
        if path.endswith(".txt") or path.endswith(".md"):
            return 0.9
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_FileCreated":
            return []
        path = event.payload.get("path", "")
        content = event.payload.get("content", "")
        if not path or not content:
            return []
        draft_body, to_addr, subject = self._call_llm_draft(path, content)
        if not draft_body:
            return []

        new_event = Event(
            type="E_DraftReady",
            payload={
                "source_path": path,
                "draft_body": draft_body,
                "content": draft_body,
                "to": to_addr,
                "subject": subject,
            },
            source_module=self.name,
        )
        self.publish(new_event)
        return [new_event]

    def _call_llm_draft(self, file_path: str, content: str):
        if not requests:
            return "", "", ""
        name = Path(file_path).stem
        prompt = f"""다음은 회의록/메모입니다. 이를 바탕으로 팀에 보낼 이메일 초안을 작성해주세요.

파일명: {name}

내용:
{content}

다음 형식으로만 답변해주세요 (다른 설명 없이):
제목: (이메일 제목 한 줄)
받는이: (이메일 주소 또는 team@company.com 형태)
---
(이메일 본문)
"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 회의록을 바탕으로 간결한 이메일 초안을 작성하는 비서입니다. 제목/받는이/본문만 출력하세요."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.5,
            "max_tokens": 2000,
        }
        try:
            r = requests.post(self.api_url, json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            text = self._extract_content(data)
            if not text:
                return "", "", ""
            return self._parse_draft(text)
        except Exception as e:
            return "", "", ""

    def _extract_content(self, data: dict) -> str:
        if "choices" in data and len(data["choices"]) > 0:
            c = data["choices"][0]
            if "message" in c and "content" in c["message"]:
                return c["message"]["content"]
            if "text" in c:
                return c["text"]
        if "message" in data:
            m = data["message"]
            return m if isinstance(m, str) else m.get("content", "")
        return data.get("content", "") or data.get("text", "")

    def _parse_draft(self, text: str):
        subject, to_addr, body = "", "", ""
        lines = text.strip().split("\n")
        in_body = False
        body_lines = []
        for line in lines:
            if line.strip().startswith("제목:") or line.strip().startswith("Subject:"):
                subject = line.split(":", 1)[1].strip()
            elif line.strip().startswith("받는이:") or line.strip().lower().startswith("to:"):
                to_addr = line.split(":", 1)[1].strip()
            elif line.strip() == "---":
                in_body = True
            elif in_body:
                body_lines.append(line)
            elif not subject and not to_addr and not in_body and line.strip():
                body_lines.append(line)
        body = "\n".join(body_lines).strip()
        if not to_addr:
            to_addr = "team@company.com"
        return body, to_addr, subject
