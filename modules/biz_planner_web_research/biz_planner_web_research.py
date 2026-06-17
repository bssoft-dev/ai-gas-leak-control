"""
M_WebResearch: WEB_SEARCH_APPROVED 시 검색·요약 후 Plan.md 해당 섹션에 삽입
SagoHub BizPlanner 시나리오 C (웹 검색 및 데이터 보강)
"""
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def _resolve(val: Any, payload: Dict[str, Any]) -> Any:
    if not isinstance(val, str) or "${" not in val:
        return val
    m = re.match(r"^\$\{event\.(\w+)\}$", val.strip())
    if m:
        return payload.get(m.group(1))
    return val


def _read_file_safe(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _append_with_retry(path: str, content: str) -> tuple:
    parent = Path(path).parent
    if parent and not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(WRITE_RETRY_MAX):
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(content)
            return True, None
        except (PermissionError, OSError) as e:
            if attempt < WRITE_RETRY_MAX - 1:
                time.sleep(WRITE_RETRY_INTERVAL)
            else:
                return False, str(e)
    return False, "append failed"


class WebResearchModule(Module):
    """사용자 검색 승인 시 웹 검색(스텁)·요약 후 Plan.md 해당 섹션에 삽입"""

    name = "M_BizPlanner_WebResearch"
    description = "웹 검색 및 Plan.md 보강"
    capabilities = ["WEB_SEARCH_APPROVED"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "WEB_SEARCH_APPROVED":
            return 0.0
        payload = event.payload or {}
        query = _resolve(payload.get("query"), payload) or payload.get("query", "")
        if not query:
            return 0.5
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "WEB_SEARCH_APPROVED":
            return []
        payload = event.payload or {}
        query = _resolve(payload.get("query"), payload) or payload.get("query", "")
        section = _resolve(payload.get("section"), payload) or payload.get("section", "")
        plan_path = _resolve(payload.get("plan_path"), payload) or payload.get("plan_path", "")
        project_folder = _resolve(payload.get("project_folder"), payload) or payload.get("project_folder", "")
        plan_filename = _resolve(payload.get("plan_filename"), payload) or payload.get("plan_filename", "Plan.md")

        project_root = os.path.expanduser(str(project_folder or "."))
        if not plan_path:
            plan_path = os.path.join(project_root, plan_filename)
        if not os.path.isabs(plan_path):
            plan_path = os.path.join(project_root, plan_path)

        raw_results = self._search_stub(query)
        summary, sources = self._summarize_with_sources(query, raw_results)
        if not summary:
            return []

        to_append = self._format_for_plan(section, summary, sources)
        ok, err = _append_with_retry(plan_path, to_append)
        if not ok:
            print(f"[{self.name}] Plan.md 추가 실패: {plan_path} - {err}")
            return []

        return [
            Event(
                type="PLAN_SECTION_UPDATED",
                payload={
                    "plan_path": plan_path,
                    "section": section,
                    "query": query,
                    "summary_length": len(summary),
                },
                source_module=self.name,
            )
        ]

    def _search_stub(self, query: str) -> str:
        """검색 스텁: 실제 Google Search 연동 전까지 LLM/고정 문구로 대체"""
        if not requests:
            return f"(검색 스텁) 쿼리: {query}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 리서치 비서입니다. 주어진 검색 쿼리에 맞는 요약 가능한 짧은 데이터(시장 규모, 통계, 출처 스타일)를 3~5문장으로 작성하세요. 출처는 [출처 N] 형태로 끝에 붙이세요."},
                {"role": "user", "content": f"검색 쿼리: {query}\n\n이 쿼리로 검색했을 때 나올 법한 핵심 데이터 요약과 출처를 작성해주세요."},
            ],
            "temperature": 0.3,
            "max_tokens": 800,
        }
        try:
            r = requests.post(self.api_url, json=body, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            return text if text else f"(검색 스텁) 쿼리: {query}"
        except Exception as e:
            print(f"[{self.name}] 검색 스텁 LLM 오류: {e}")
        return f"(검색 스텁) 쿼리: {query}"

    def _summarize_with_sources(self, query: str, raw: str) -> tuple:
        """원문 요약 및 출처 명기"""
        if not requests:
            return raw, ["(출처: 스텁)"]
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 데이터 요약 비서입니다. 주어진 내용을 표·차트에 넣기 좋게 요약하고, 출처를 명확히 하세요."},
                {"role": "user", "content": f"쿼리: {query}\n\n원문:\n{raw[:4000]}\n\n요약문과 출처만 출력하세요."},
            ],
            "temperature": 0.2,
            "max_tokens": 1000,
        }
        try:
            r = requests.post(self.api_url, json=body, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or raw
            sources = re.findall(r"\[출처[^\]]*\]|\(출처[^)]*\)", text)
            if not sources:
                sources = ["(출처: 웹 검색 요약)"]
            return text, sources
        except Exception as e:
            print(f"[{self.name}] 요약 LLM 오류: {e}")
        return raw, ["(출처: 요약 실패)"]

    def _format_for_plan(self, section: str, summary: str, sources: List[str]) -> str:
        """Plan.md에 삽입할 블록 포맷"""
        section_label = section or "검색 결과"
        block = f"\n\n## {section_label} (검색 보강)\n\n{summary}\n\n"
        for s in sources:
            block += f"- {s}\n"
        block += "\n"
        return block
