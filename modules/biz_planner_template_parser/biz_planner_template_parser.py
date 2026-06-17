"""
M_TemplateParser: 양식 파일(Template/) 업로드 시 목차·가이드 추출 → Plan.md 뼈대 생성
SagoHub BizPlanner 시나리오 A (명세 4)
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
    """${event.xxx} 형태는 payload.xxx로 치환 (동적 변수 미해석 시 대비)"""
    if not isinstance(val, str) or "${" not in val:
        return val
    m = re.match(r"^\$\{event\.(\w+)\}$", val.strip())
    if m:
        return payload.get(m.group(1))
    return val


def _write_with_retry(path: str, content: str) -> tuple:
    """파일 쓰기 재시도"""
    parent = Path(path).parent
    if parent and not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(WRITE_RETRY_MAX):
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return True, None
        except (PermissionError, OSError) as e:
            if attempt < WRITE_RETRY_MAX - 1:
                time.sleep(WRITE_RETRY_INTERVAL)
            else:
                return False, str(e)
    return False, "write failed"


def _read_file_safe(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


class TemplateParserModule(Module):
    """양식(Template/) 파일 생성 시 목차·가이드 추출 후 Plan.md 초기 뼈대 생성"""

    name = "M_BizPlanner_TemplateParser"
    description = "양식 파일 분석 후 Plan.md 마크다운 뼈대 생성"
    capabilities = ["E_FileCreated"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "E_FileCreated":
            return 0.0
        payload = event.payload or {}
        path = _resolve(payload.get("path"), payload) or payload.get("path", "")
        if not path:
            return 0.0
        path_n = path.replace("\\", "/")
        if "Template" not in path_n and "template" not in path_n:
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_FileCreated":
            return []
        payload = event.payload or {}
        path = _resolve(payload.get("path"), payload) or payload.get("path", "")
        content = _resolve(payload.get("content"), payload) or payload.get("content") or _read_file_safe(path)
        project_folder = _resolve(payload.get("project_folder"), payload) or payload.get("project_folder", "")
        plan_filename = _resolve(payload.get("plan_filename"), payload) or payload.get("plan_filename", "Plan.md")
        template_folder = _resolve(payload.get("template_folder"), payload) or payload.get("template_folder", "Template")

        if not path or not content.strip():
            return []

        project_root = os.path.expanduser(str(project_folder or "."))
        plan_path = os.path.join(project_root, plan_filename)

        skeleton_md = self._extract_skeleton(content, path)
        if not skeleton_md:
            return []

        ok, err = _write_with_retry(plan_path, skeleton_md)
        if not ok:
            print(f"[{self.name}] Plan.md 쓰기 실패: {plan_path} - {err}")
            return []

        return [
            Event(
                type="PLAN_INITIALIZED",
                payload={
                    "plan_path": plan_path,
                    "source_template_path": path,
                    "project_folder": project_root,
                },
                source_module=self.name,
            )
        ]

    def _extract_skeleton(self, content: str, file_path: str) -> str:
        """LLM으로 목차·가이드 추출 후 마크다운 뼈대 생성"""
        if not requests:
            return self._fallback_skeleton(content)
        prompt = f"""다음 문서(양식/공고문)의 목차를 계층구조로 추출하고, 각 항목의 작성 가이드를 주석으로 만들어주세요.
출력은 반드시 마크다운만 출력하세요. 각 섹션은 # 1. 제목 형식으로 하고, 그 다음 줄에 작성 가이드를 <!-- 가이드 내용 --> 형태의 HTML 주석으로 넣어주세요.

문서 내용:
{content[:12000]}

예시 형식:
# 1. 문제 인식 (Problem)
<!-- 여기에 작성 가이드: 문제 정의, 타겟 고객의 페인 포인트 등 -->

# 2. 실현 가능성 (Solution)
<!-- 작성 가이드 -->

마크다운 뼈대만 출력하세요."""

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 문서에서 목차와 작성 가이드를 추출해 마크다운 뼈대를 만드는 비서입니다. 지정된 형식으로만 출력하세요."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 4000,
        }
        try:
            r = requests.post(self.api_url, json=body, headers=headers, timeout=120)
            r.raise_for_status()
            data = r.json()
            text = self._extract_content(data)
            if text and text.strip():
                return text.strip()
        except Exception as e:
            print(f"[{self.name}] LLM API 오류: {e}")
        return self._fallback_skeleton(content)

    def _extract_content(self, data: Dict[str, Any]) -> str:
        """OpenAI 호환 응답에서 content 추출"""
        choices = data.get("choices") or []
        if not choices:
            return ""
        msg = choices[0].get("message") or {}
        return msg.get("content") or ""

    def _fallback_skeleton(self, content: str) -> str:
        """LLM 없을 때 단순 헤더 추출"""
        lines = []
        for line in content.split("\n"):
            line = line.strip()
            if re.match(r"^#+\s+", line) or re.match(r"^[\d.]+\s+", line):
                lines.append(line if line.startswith("#") else f"# {line}")
            elif line and len(lines) < 30:
                lines.append(f"<!-- {line[:80]} -->")
        if not lines:
            lines = ["# 1. 개요", "<!-- 내용을 입력하세요 -->", "# 2. 시장 분석", "<!-- 내용을 입력하세요 -->"]
        return "\n\n".join(lines)
