"""
M_SupplementApplyHandler: 보충 정보 반영 처리
E_SupplementApplyRequest → LLM으로 원본에 통합 → E_SupplementApplied
"""
import os
import re
import time
from pathlib import Path
from typing import List, Optional, Tuple

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

WRITE_RETRY_MAX = 3
WRITE_RETRY_INTERVAL = 1.0


def _read_file_safe(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _write_with_retry(path: str, content: str) -> Tuple[bool, Optional[str]]:
    """PermissionError 시 최대 3회, 1초 간격 재시도"""
    parent = Path(path).parent
    if parent and not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(WRITE_RETRY_MAX):
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return True, None
        except PermissionError as e:
            if attempt < WRITE_RETRY_MAX - 1:
                time.sleep(WRITE_RETRY_INTERVAL)
            else:
                return False, str(e)
        except OSError as e:
            return False, str(e)
    return False, "write failed"


class SupplementApplyHandlerModule(Module):
    """보충 정보 반영 처리 모듈"""

    name = "M_SupplementApplyHandler"
    description = "보충 정보를 원본 메모에 반영하는 모듈"
    capabilities = ["E_SupplementApplyRequest"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "E_SupplementApplyRequest":
            return 0.0
        payload = event.payload or {}
        if not payload.get("supplement_path") or not payload.get("original_path"):
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_SupplementApplyRequest":
            return []
        payload = event.payload or {}
        supplement_path = payload.get("supplement_path", "")
        original_path = payload.get("original_path", "")
        if not supplement_path or not original_path:
            return []

        supplement_content = _read_file_safe(supplement_path)
        original_content = _read_file_safe(original_path)

        # 보충 정보 내용만 추출
        body_match = re.search(r"## 보충 정보 내용\s*\n(.*?)(?=\n---|\n## |\Z)", supplement_content, re.DOTALL)
        supplement_body = body_match.group(1).strip() if body_match else supplement_content[:2000]

        merged = self._call_llm_merge(original_content, supplement_body)
        if not merged:
            return []

        ok, err = _write_with_retry(original_path, merged)
        if ok:
            from pathlib import Path
            supplement_dir = str(Path(supplement_path).parent)
            return [
                Event(
                    type="E_SupplementApplied",
                    payload={
                        **payload,
                        "merged_path": original_path,
                        "supplement_path": supplement_path,
                        "supplement_dir": supplement_dir,
                    },
                    source_module=self.name,
                )
            ]
        return []

    def _call_llm_merge(self, original_content: str, supplement_content: str) -> str:
        """원본 메모 + 보충 정보 → footnote 형태로 통합"""
        if not requests:
            return original_content
        prompt = f"""원본 메모와 보충 정보를 결합해주세요. 보충 정보는 footnote 형태로 추가해주세요.

규칙:
- 원본 메모의 내용을 유지하면서 보충 정보를 적절한 위치에 통합
- 보충 정보는 footnote 형태로 추가 (예: [^1], [^2])
- 파일 끝에 footnote 정의 추가 (예: [^1]: 보충 정보 내용)
- 기존 footnote가 있다면 번호를 이어서 사용
- 원본 메모의 구조와 형식을 최대한 유지

원본 메모:
{original_content[:6000]}

보충 정보:
{supplement_content[:3000]}

통합된 전체 메모 내용만 출력해주세요."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 원본 메모에 보충 정보를 footnote로 통합하는 비서입니다. 통합된 메모 전체만 출력하세요."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 4000,
        }
        try:
            r = requests.post(self.api_url, json=payload, headers=headers, timeout=90)
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data) or original_content
        except Exception as e:
            print(f"[{self.name}] LLM Merge 오류: {e}")
            return original_content

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
