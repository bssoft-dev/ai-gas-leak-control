"""
M_LLM_RequestExtractor: 원본 파일에서 요청사항 추출
E_OriginalFileDetected → LLM 요청 추출 → E_RequestExtracted
"""
import os
import re
from typing import Any, Dict, List

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

SUPPLEMENT_CATEGORIES = [
    "1. 인터넷 검색 추가정보",
    "2. 질문에 대한 답변",
    "3. 메모내용 정리",
    "4. 관련 개념 설명",
    "5. 예시 및 사례",
    "6. 참고 자료 및 링크",
    "7. 실용 팁 및 베스트 프랙티스",
    "8. 잠재적 문제점 및 해결방안",
    "9. 관련 도구 및 리소스",
    "10. 심화 학습 자료",
    "11. 비교 분석",
    "12. 구현 가이드",
    "13. 트러블슈팅",
    "14. 업데이트 및 최신 동향",
]


class LLMRequestExtractorModule(Module):
    """원본 파일에서 요청사항 추출 (LLM 사용)"""

    name = "M_LLM_RequestExtractor"
    description = "LLM을 사용한 요청사항 추출 모듈"
    capabilities = ["E_OriginalFileDetected"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "E_OriginalFileDetected":
            return 0.0
        payload = event.payload or {}
        content = payload.get("content", "")
        if not content:
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_OriginalFileDetected":
            return []
        payload = event.payload or {}
        content = payload.get("content", "")
        path = payload.get("path", "")
        if not content:
            return []

        requests_data = self._extract_requests(content, path)
        if not requests_data:
            return []

        return [
            Event(
                type="E_RequestExtracted",
                payload={
                    **payload,
                    "requests": requests_data,
                },
                source_module=self.name,
            )
        ]

    def _extract_requests(self, content: str, file_path: str) -> List[Dict[str, str]]:
        """LLM으로 요청사항 추출"""
        if not requests:
            return []
        categories_str = "\n".join(SUPPLEMENT_CATEGORIES)
        prompt = f"""다음 메모 내용에서 사용자의 요청사항·질문을 추출하고, 각각에 대해 적절한 보충 정보를 생성해주세요.

메모 내용:
{content[:8000]}

보충 정보 카테고리 (해당하는 번호와 이름 사용):
{categories_str}

다음 형식으로만 답변해주세요 (다른 설명 없이):
요청사항 1: [사용자의 요청 또는 질문]
카테고리: [카테고리 번호 및 이름]
보충 정보 1: [상세한 보충 정보 내용]

요청사항 2: ...
카테고리: ...
보충 정보 2: ...
"""
        text = self._call_llm(prompt)
        if not text:
            return []
        return self._parse_extract_response(text)

    def _parse_extract_response(self, text: str) -> List[Dict[str, str]]:
        result = []
        current = {}
        in_supplement = False
        for line in text.split("\n"):
            stripped = line.strip()
            if re.match(r"^요청사항\s*\d+\s*:", stripped):
                if current and current.get("request"):
                    result.append(current)
                current = {"request": stripped.split(":", 1)[1].strip()}
                in_supplement = False
            elif re.match(r"^카테고리\s*:", stripped):
                current["category"] = stripped.split(":", 1)[1].strip()
                in_supplement = False
            elif re.match(r"^보충 정보\s*\d+\s*:", stripped):
                current["supplement"] = stripped.split(":", 1)[1].strip()
                in_supplement = True
            elif in_supplement and current:
                current["supplement"] = (current.get("supplement", "") + "\n" + line.rstrip()).strip()
        if current and current.get("request"):
            result.append(current)
        return result

    def _call_llm(self, user_content: str) -> str:
        if not requests:
            return ""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 메모 내용을 분석하고 요청사항을 추출하며 보충 정보를 작성하는 비서입니다. 지정된 형식으로만 답변하세요."},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.5,
            "max_tokens": 4000,
        }
        try:
            r = requests.post(self.api_url, json=payload, headers=headers, timeout=120)
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data)
        except Exception as e:
            print(f"[{self.name}] LLM API 오류: {e}")
            return ""

    def _extract_content(self, data: dict) -> str:
        """LLM 응답에서 content 추출"""
        if "choices" in data and len(data["choices"]) > 0:
            c = data["choices"][0]
            if isinstance(c.get("message"), dict) and "content" in c["message"]:
                return c["message"]["content"]
            if "text" in c:
                return c["text"]
        if "message" in data:
            m = data["message"]
            return m if isinstance(m, str) else (m.get("content") or m.get("text") or "")
        return data.get("content") or data.get("text") or ""
