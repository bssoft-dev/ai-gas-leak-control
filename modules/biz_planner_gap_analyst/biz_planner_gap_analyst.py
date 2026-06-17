"""
M_GapAnalyst: CHAT_REQUEST 시 Plan.md·References 검토 → 정보 충분/부족 판단 → WRITE/ASK 제안
SagoHub BizPlanner 시나리오 B·C (명세 4, 갭 분석)
"""
import os
import re
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


class GapAnalystModule(Module):
    """작성 요청 시 갭 분석: 정보 충분이면 [WRITE], 부족하면 [ASK] 또는 검색 제안"""

    name = "M_BizPlanner_GapAnalyst"
    description = "갭 분석 및 WRITE/ASK 제안"
    capabilities = ["CHAT_REQUEST"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "CHAT_REQUEST":
            return 0.0
        payload = event.payload or {}
        if not payload.get("user_message") and not payload.get("section"):
            return 0.5
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "CHAT_REQUEST":
            return []
        payload = event.payload or {}
        section = _resolve(payload.get("section"), payload) or payload.get("section", "")
        user_message = _resolve(payload.get("user_message"), payload) or payload.get("user_message", "")
        plan_path = _resolve(payload.get("plan_path"), payload) or payload.get("plan_path", "")
        project_folder = _resolve(payload.get("project_folder"), payload) or payload.get("project_folder", "")
        plan_filename = _resolve(payload.get("plan_filename"), payload) or payload.get("plan_filename", "Plan.md")
        references_folder = _resolve(payload.get("references_folder"), payload) or payload.get("references_folder", "References")

        project_root = os.path.expanduser(str(project_folder or "."))
        if not plan_path:
            plan_path = os.path.join(project_root, plan_filename)
        if not os.path.isabs(plan_path):
            plan_path = os.path.join(project_root, plan_path)
        ref_path = os.path.join(project_root, references_folder)

        plan_content = _read_file_safe(plan_path)
        ref_context = self._gather_ref_context(ref_path)

        mode, message, suggest_search = self._analyze_gap(
            section=section,
            user_message=user_message,
            plan_content=plan_content,
            ref_context=ref_context,
        )

        return [
            Event(
                type="GAP_ANALYSIS_RESULT",
                payload={
                    "mode": mode,
                    "message": message,
                    "suggest_search": suggest_search,
                    "section": section,
                    "plan_path": plan_path,
                    "user_message": user_message,
                },
                source_module=self.name,
            )
        ]

    def _gather_ref_context(self, ref_path: str, max_chars: int = 6000) -> str:
        """References 폴더에서 텍스트 수집 (RAG 스텁)"""
        if not os.path.isdir(ref_path):
            return ""
        parts = []
        for root, _, files in os.walk(ref_path):
            for f in files:
                if not f.endswith((".txt", ".md")):
                    continue
                path = os.path.join(root, f)
                parts.append(_read_file_safe(path))
                if sum(len(p) for p in parts) >= max_chars:
                    break
            if sum(len(p) for p in parts) >= max_chars:
                break
        return "\n\n".join(parts)[:max_chars]

    def _analyze_gap(
        self,
        section: str,
        user_message: str,
        plan_content: str,
        ref_context: str,
    ) -> tuple:
        """LLM으로 정보 충분/부족 판단 → WRITE / ASK / 제안(검색)"""
        if not requests:
            return "ASK", "시장 규모 등 데이터가 없을 수 있습니다. 검색을 통해 채우시겠어요?", True
        prompt = f"""사용자가 사업계획서의 특정 섹션을 작성하려 합니다.
현재 Plan.md 내용과 참고자료(References)를 보고, 해당 섹션을 쓰기에 **정보가 충분한지** 판단해주세요.

요청 섹션: {section or '(전체)'}
사용자 메시지: {user_message or '(작성해줘)'}

--- Plan.md (일부) ---
{plan_content[:5000]}

--- 참고자료 (일부) ---
{ref_context[:3000] if ref_context else "(없음)"}

다음 중 하나로만 답변하세요:
- [WRITE]: 정보가 충분함. 바로 작성 가능.
- [ASK]: 정보 부족. 사용자에게 질문해서 보완 필요.
- [SEARCH]: 수치/데이터가 부족. 웹 검색 제안.

형식 (한 줄):
MODE: [WRITE 또는 ASK 또는 SEARCH]
MESSAGE: (사용자에게 전달할 한글 메시지, 질문이거나 검색 제안 등)
"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 사업계획서 작성 참모입니다. 정보 충분 여부만 판단하고 MODE와 MESSAGE만 출력하세요."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 500,
        }
        try:
            r = requests.post(self.api_url, json=body, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            mode, message, suggest_search = self._parse_llm_response(text)
            return mode, message, suggest_search
        except Exception as e:
            print(f"[{self.name}] LLM 오류: {e}")
        return "ASK", "정보를 확인했습니다. 필요하면 검색으로 데이터를 채울 수 있어요.", True

    def _parse_llm_response(self, text: str) -> tuple:
        mode = "ASK"
        message = ""
        suggest_search = False
        for line in text.split("\n"):
            line = line.strip()
            if line.upper().startswith("MODE:"):
                rest = line[5:].strip().upper()
                if "WRITE" in rest:
                    mode = "WRITE"
                elif "SEARCH" in rest:
                    mode = "SEARCH"
                    suggest_search = True
                else:
                    mode = "ASK"
            elif line.upper().startswith("MESSAGE:"):
                message = line[8:].strip()
        if not message:
            message = "시장 규모 데이터가 없습니다. 웹 검색으로 채울까요?" if suggest_search else "해당 섹션을 작성할 수 있습니다."
        return mode, message, suggest_search
