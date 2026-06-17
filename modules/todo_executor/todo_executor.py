"""
M_TodoExecutor: TODO 목록 수행 모듈
- EVT_TODO_UPDATED 수신 시 todo_list.md에서 할 일 목록 로드
- 필요한 경우 EVT_WEB_SEARCH_REQUEST 발행 → EVT_WEB_SEARCH_RESPONSE 수신 후 검색 결과를 RAG 컨텍스트로 활용
- 각 할 일에 대해 LLM으로 "수행 결과" 생성 요청 (LLM_PROMPT)
- LLM_PROMPT_RESPONSE(intent=todo_execute) 수신 시 todo_result 폴더에 .md 파일로 저장
"""
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 웹 검색 이벤트 타입 (web_search 모듈과 약속)
EVT_WEB_SEARCH_REQUEST = "EVT_WEB_SEARCH_REQUEST"
EVT_WEB_SEARCH_RESPONSE = "EVT_WEB_SEARCH_RESPONSE"

_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_CONFIG_FILE = _MODULE_DIR / "config.yaml"

_TODO_LINE = re.compile(r"^\s*[-*]\s*\[([ xX])\]\s*(.*)$", re.MULTILINE)
_SECTION_HEADER = re.compile(r"^##\s+source:\s*(.+)$", re.MULTILINE)

_DEFAULT_EXECUTE_PROMPT = """다음 할 일을 수행한 결과를 마크다운으로 정리해 주세요.
- 아래 [현재 분석 결과], [사용자 관심사], [웹 검색 참고 자료]를 컨텍스트로 참고하여, 할 일과 관련된 실행 계획·단계·완료 시 기록할 내용을 작성해 주세요.
- 컨텍스트와 무관한 일반론이 아니라, 해당 분석·관심사·검색 자료를 반영한 실용적인 결과를 한글로 작성해 주세요.

할 일: """
_RESULT_DIR = "sago/todo_result"
_CONTEXT_LENGTH_LIMIT = 14000  # analysis + interests + web 검색 합산 제한


def _load_config(config_file: Optional[Path] = None) -> Tuple[str, int]:
    """설정에서 todo_execute_prompt 로드."""
    path = (config_file or _DEFAULT_CONFIG_FILE).resolve()
    try:
        raw = path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw) or {}
        prompt = (data.get("todo_execute_prompt") or "").strip()
        prompt = prompt or _DEFAULT_EXECUTE_PROMPT
        limit = data.get("context_length_limit")
        if limit is None or (isinstance(limit, int) and limit <= 0):
            limit = _CONTEXT_LENGTH_LIMIT
        else:
            limit = int(limit)
        return prompt, limit
    except Exception as e:
        print(f"[M_TodoExecutor] ⚠️  설정 로드 실패 ({path}): {e}, 기본값 사용")
        return _DEFAULT_EXECUTE_PROMPT, _CONTEXT_LENGTH_LIMIT


def _parse_todo_list(content: str) -> List[Tuple[str, bool, str]]:
    """todo_list.md 본문을 (source_key, checked, text) 리스트로 평탄화. 순서 유지."""
    result: List[Tuple[str, bool, str]] = []
    current_key: Optional[str] = None
    for line in content.splitlines():
        m = _SECTION_HEADER.match(line.strip())
        if m:
            current_key = m.group(1).strip()
            continue
        if current_key is None:
            continue
        tm = _TODO_LINE.match(line)
        if tm:
            checked = tm.group(1).lower() == "x"
            text = tm.group(2).strip()
            if text:
                result.append((current_key, checked, text))
    return result


def _sanitize_filename(text: str, max_len: int = 60) -> str:
    """파일명으로 쓸 수 있게 문자 치환 및 길이 제한."""
    s = re.sub(r'[/\\:*?"<>|\n\r]+', "_", text)
    s = re.sub(r"\s+", "_", s).strip("_")
    if len(s) > max_len:
        s = s[:max_len].rstrip("_")
    return s or "todo"


def _load_analysis_and_interest(watch_dir: str, source_key: str, context_limit: int) -> str:
    """analysis_result + interests 본문을 로드해 하나의 컨텍스트 문자열로 반환. 길이 제한 적용."""
    base = Path(watch_dir)
    use_hidden = source_key.startswith(".sago")
    parts: List[str] = []

    # analysis_result (source_key가 해당 파일 경로, 예: sago/analysis/founds/analysis_result.md)
    analysis_path = base / source_key.replace("\\", "/")
    if analysis_path.exists():
        try:
            analysis_content = analysis_path.read_text(encoding="utf-8").strip()
            if analysis_content:
                parts.append("[현재 분석 결과]\n" + analysis_content)
        except Exception as e:
            print(f"[M_TodoExecutor] ⚠️  analysis_result 읽기 실패: {analysis_path}, {e}")

    # interests (sago/interest/interests.md 또는 .sago/.interest/interests.md)
    sago = ".sago" if use_hidden else "sago"
    interest_path = base / sago / "interest" / "interests.md"
    if interest_path.exists():
        try:
            interest_content = interest_path.read_text(encoding="utf-8").strip()
            if interest_content:
                parts.append("[사용자 관심사]\n" + interest_content)
        except Exception as e:
            print(f"[M_TodoExecutor] ⚠️  interests 읽기 실패: {interest_path}, {e}")

    combined = "\n\n".join(parts)
    if len(combined) > context_limit:
        combined = combined[:context_limit] + "\n...(생략)"
    return combined


class TodoExecutorModule(Module):
    """EVT_TODO_UPDATED 시 todo 목록을 읽어 각 할 일을 차례대로 수행하고 결과를 todo_result/*.md로 저장"""

    name = "M_TodoExecutor"
    description = "TODO 추가/업데이트 시 각 할 일을 순차 수행하고 todo_result 폴더에 .md로 저장"
    capabilities = [
        "EVT_TODO_UPDATED",
        "EVT_WEB_SEARCH_REQUEST",
        "EVT_WEB_SEARCH_RESPONSE",
        "LLM_PROMPT",
        "LLM_PROMPT_RESPONSE",
        "EVT_WRITE_REQUEST",
    ]

    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root

    def can_handle(self, event: Event) -> float:
        if event.type == "EVT_TODO_UPDATED":
            return 1.0
        if event.type == EVT_WEB_SEARCH_RESPONSE:
            p = event.payload or {}
            if p.get("intent") == "todo_execute" and "request_id" in p:
                return 1.0
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "todo_execute":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "EVT_TODO_UPDATED":
            return self._handle_todo_updated(event)
        if event.type == EVT_WEB_SEARCH_RESPONSE:
            return self._handle_web_search_response(event)
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "todo_execute":
            return self._handle_execute_response(event)
        return []

    def _handle_todo_updated(self, event: Event) -> List[Event]:
        """EVT_TODO_UPDATED: todo_list 읽어서 각 항목마다 LLM_PROMPT(todo_execute) 발행."""
        payload = event.payload or {}
        if payload.get("deleted"):
            return []
        watch_dir = payload.get("watch_dir") or self.vault_root
        todo_list_path = payload.get("todo_list_path", "")
        if not watch_dir or not todo_list_path:
            print(f"[{self.name}] ⚠️  watch_dir 또는 todo_list_path가 없습니다")
            return []
        path = Path(todo_list_path)
        if not path.exists():
            print(f"[{self.name}] ⚠️  todo 목록 파일 없음: {path}")
            return []
        try:
            content = path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"[{self.name}] ⚠️  todo 목록 읽기 실패: {path}, {e}")
            return []
        items = _parse_todo_list(content)
        if not items:
            return []
        out: List[Event] = []
        for idx, (source_key, checked, task_text) in enumerate(items, start=1):
            request_id = f"todo_execute_{idx}_{uuid.uuid4().hex[:8]}"
            out.append(
                Event(
                    type=EVT_WEB_SEARCH_REQUEST,
                    payload={
                        "query": task_text,
                        "request_id": request_id,
                        "max_results": 5,
                        "intent": "todo_execute",
                        "watch_dir": watch_dir,
                        "todo_index": idx,
                        "total_count": len(items),
                        "source_key": source_key,
                        "task_text": task_text,
                        "checked": checked,
                    },
                    source_module=self.name,
                )
            )
        print(f"[{self.name}] 할 일 {len(items)}건 웹검색 요청 발행 (검색 결과 반영 후 todo_result 저장 예정)")
        return out

    def _format_search_context(self, results: List[Dict[str, Any]], max_snippets: int = 5) -> str:
        """검색 결과를 LLM context 문자열로 포맷."""
        if not results:
            return ""
        lines: List[str] = ["[웹 검색 참고 자료]", ""]
        for i, r in enumerate(results[:max_snippets], 1):
            title = (r.get("title") or "").strip()
            body = (r.get("body") or "").strip()
            href = (r.get("href") or "").strip()
            if title or body:
                lines.append(f"### {i}. {title or '(제목 없음)'}")
                if body:
                    lines.append(body[:400] + ("..." if len(body) > 400 else ""))
                if href:
                    lines.append(f"출처: {href}")
                lines.append("")
        return "\n".join(lines).strip()

    def _handle_web_search_response(self, event: Event) -> List[Event]:
        """EVT_WEB_SEARCH_RESPONSE 수신 시 analysis_result + interests + 검색 결과를 컨텍스트로 LLM_PROMPT 발행."""
        payload = event.payload or {}
        if payload.get("intent") != "todo_execute":
            return []
        results = payload.get("results") or []
        prompt_template, context_limit = _load_config()
        task_text = payload.get("task_text", "")
        watch_dir = payload.get("watch_dir") or self.vault_root
        todo_index = payload.get("todo_index", 0)
        total_count = payload.get("total_count", 0)
        source_key = payload.get("source_key", "")
        checked = payload.get("checked", False)

        # analysis_result + interests 로드 (길이 제한 내에서), 그 다음 웹 검색 결과
        analysis_interest = _load_analysis_and_interest(watch_dir, source_key, context_limit)
        web_part = self._format_search_context(results)
        if analysis_interest and web_part:
            context = analysis_interest + "\n\n" + web_part
        elif analysis_interest:
            context = analysis_interest
        else:
            context = web_part
        if len(context) > context_limit:
            context = context[:context_limit] + "\n...(생략)"

        prompt = prompt_template + task_text
        return [
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": prompt,
                    "context": context,
                    "intent": "todo_execute",
                    "watch_dir": watch_dir,
                    "todo_index": todo_index,
                    "total_count": total_count,
                    "source_key": source_key,
                    "task_text": task_text,
                    "checked": checked,
                },
                source_module=self.name,
            )
        ]

    def _handle_execute_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(intent=todo_execute): 응답 내용을 todo_result/{index:03d}_{title}.md로 저장."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  todo 수행 LLM 응답이 없습니다")
            return []
        if payload.get("intent") != "todo_execute":
            return []
        watch_dir = payload.get("watch_dir") or self.vault_root
        todo_index = payload.get("todo_index", 0)
        task_text = payload.get("task_text", "")
        response_text = (payload.get("response") or "").strip()
        if not watch_dir:
            return []
        safe_name = _sanitize_filename(task_text)
        filename = f"{todo_index:03d}_{safe_name}.md"
        relative_path = f"{_RESULT_DIR}/{filename}"
        # source_analysis: todo_result_integrator가 analysis_result 통합 시 참조
        source_key = (payload.get("source_key") or "").replace("\\", "/")
        frontmatter = ""
        if source_key:
            frontmatter = f"---\nsource_analysis: {source_key}\n---\n\n"
        # 결과 본문: frontmatter + 할 일 제목 + 구분선 + LLM 응답
        content = frontmatter + f"# 할 일: {task_text}\n\n---\n\n{response_text}\n"
        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": relative_path,
                    "content": content,
                    "intent": "todo_result",
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] todo_result 저장 요청: {relative_path}")
        return []
