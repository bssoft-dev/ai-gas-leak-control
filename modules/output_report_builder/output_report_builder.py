"""
M_OutputReportBuilder: output_index 기반 output_report 생성 모듈
- EVT_OUTPUT_REPORT_REQUEST 또는 EVT_WRITE_COMPLETE(intent=output_index) 수신 시 output_index.md 로드
- output_index를 기준으로 챕터 단위로 나누고, 챕터별 500~3,000자 본문 생성 (LLM)
- output_index + analysis_result + interest + todo_result + 기존 output_report를 컨텍스트로 사용
- 생성/갱신된 챕터를 챕터명 + 컨텐츠 형태로 output_report.md에 작성 (EVT_WRITE_REQUEST)
- output_index 변경 시 추가/삭제/변경된 챕터만 재생성하거나, 필요 시 전체 재생성
"""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from SagoHub.core.event import Event
from SagoHub.core.module import Module

_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_CONFIG = _MODULE_DIR / "config.yaml"

_OUTPUT_INDEX_REL = "sago/output/output_index.md"
_OUTPUT_INDEX_HIDDEN = ".sago/.output/output_index.md"
_OUTPUT_REPORT_REL = "sago/output/output_report.md"
_OUTPUT_REPORT_HIDDEN = ".sago/.output/output_report.md"
_ANALYSIS_RESULT_REL = "sago/analysis/analysis_result.md"
_ANALYSIS_RESULT_HIDDEN = ".sago/.analysis/analysis_result.md"
_INTEREST_REL = "sago/interest/interests.md"
_INTEREST_HIDDEN = ".sago/.interest/interests.md"
_TODO_RESULT_DIR = "sago/todo_result"
_TODO_RESULT_DIR_HIDDEN = ".sago/.todo_result"

_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$", re.MULTILINE)


def _load_config(config_file: Optional[Path] = None) -> Dict[str, Any]:
    path = (config_file or _DEFAULT_CONFIG).resolve()
    try:
        raw = path.read_text(encoding="utf-8")
        return yaml.safe_load(raw) or {}
    except Exception as e:
        print(f"[OutputReportBuilder] ⚠️  설정 로드 실패 ({path}): {e}")
        return {}


def _parse_chapters_from_index(content: str) -> List[str]:
    """마크다운 목차에서 ## 또는 # 헤딩만 추출해 챕터명 리스트(순서 유지) 반환."""
    chapters: List[str] = []
    for line in content.splitlines():
        m = _HEADING_RE.match(line.strip())
        if m:
            chapters.append(m.group(1).strip())
    return chapters


def _parse_chapters_from_report(content: str) -> Dict[str, str]:
    """output_report.md 본문에서 ## 챕터명과 그 아래 본문을 추출해 { 챕터명: 본문 } 반환."""
    result: Dict[str, str] = {}
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        m = _HEADING_RE.match(lines[i].strip())
        if m:
            title = m.group(1).strip()
            i += 1
            body_lines: List[str] = []
            while i < len(lines):
                if _HEADING_RE.match(lines[i].strip()):
                    break
                body_lines.append(lines[i])
                i += 1
            result[title] = "\n".join(body_lines).strip()
            continue
        i += 1
    return result


def _read_file(watch_dir: str, rel_path: str) -> str:
    path = Path(watch_dir) / rel_path
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"[OutputReportBuilder] ⚠️  읽기 실패: {path}, {e}")
        return ""


def _read_todo_results(watch_dir: str, use_hidden: bool) -> str:
    base = Path(watch_dir)
    dir_rel = _TODO_RESULT_DIR_HIDDEN if use_hidden else _TODO_RESULT_DIR
    dir_path = base / dir_rel
    if not dir_path.exists():
        return ""
    parts: List[str] = []
    for p in sorted(dir_path.glob("*.md")):
        try:
            parts.append(p.read_text(encoding="utf-8").strip())
        except Exception:
            continue
    return "\n\n---\n\n".join(parts)


def _build_report_content(index_chapters: List[str], existing_contents: Dict[str, str], generated: Dict[str, str]) -> str:
    """index 순서대로 챕터 제목 + 본문을 이어 붙여 최종 output_report 본문 생성."""
    lines: List[str] = ["# 출력 보고서", ""]
    for title in index_chapters:
        body = generated.get(title) or existing_contents.get(title) or ""
        if not body.strip():
            body = "(본문 없음)"
        lines.append(f"## {title}")
        lines.append("")
        lines.append(body.strip())
        lines.append("")
    return "\n".join(lines).strip() + "\n"


class OutputReportBuilderModule(Module):
    """output_index.md 생성 완료 시 챕터별 본문 생성 후 output_report.md 작성"""

    name = "M_OutputReportBuilder"
    description = "output_index 기반 챕터별 본문 생성 후 output_report.md 작성"
    capabilities = [
        "EVT_OUTPUT_REPORT_REQUEST",
        "EVT_WRITE_COMPLETE",
        "LLM_PROMPT",
        "LLM_PROMPT_RESPONSE",
        "EVT_WRITE_REQUEST",
    ]

    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root

    def can_handle(self, event: Event) -> float:
        if event.type == "EVT_OUTPUT_REPORT_REQUEST":
            return 1.0
        if event.type == "EVT_WRITE_COMPLETE":
            return 1.0 if (event.payload or {}).get("intent") == "output_index" else 0.0
        if event.type == "LLM_PROMPT_RESPONSE":
            return 1.0 if (event.payload or {}).get("intent") == "output_report_chapter" else 0.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "EVT_OUTPUT_REPORT_REQUEST":
            return self._handle_report_request(event)
        if event.type == "EVT_WRITE_COMPLETE":
            return self._handle_output_index_written(event)
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "output_report_chapter":
            return self._handle_chapter_response(event)
        return []

    def _handle_report_request(self, event: Event) -> List[Event]:
        """EVT_OUTPUT_REPORT_REQUEST: watch_dir 기준으로 output_report 생성 플로우 실행."""
        payload = event.payload or {}
        watch_dir = (payload.get("watch_dir") or payload.get("vault_root") or self.vault_root).strip()
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []
        use_hidden = payload.get("hide_thinking_process", False)
        return self._run_report_build(watch_dir, use_hidden)

    def _handle_output_index_written(self, event: Event) -> List[Event]:
        """EVT_WRITE_COMPLETE(output_index): output_index 로드 후 챕터 목록 결정, 필요 시 LLM 요청 또는 바로 보고서 작성."""
        payload = event.payload or {}
        watch_dir = (payload.get("watch_dir") or self.vault_root).strip()
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []
        relative_path = (payload.get("relative_path") or "").strip()
        use_hidden = relative_path.startswith(".sago") or payload.get("hide_thinking_process", False)
        return self._run_report_build(watch_dir, use_hidden)

    def _run_report_build(self, watch_dir: str, use_hidden: bool) -> List[Event]:
        """output_index 로드 → 챕터 목록 결정 → 필요 시 LLM 챕터 생성 또는 바로 보고서 저장."""
        index_rel = _OUTPUT_INDEX_HIDDEN if use_hidden else _OUTPUT_INDEX_REL
        report_rel = _OUTPUT_REPORT_HIDDEN if use_hidden else _OUTPUT_REPORT_REL
        analysis_rel = _ANALYSIS_RESULT_HIDDEN if use_hidden else _ANALYSIS_RESULT_REL
        interest_rel = _INTEREST_HIDDEN if use_hidden else _INTEREST_REL

        index_content = _read_file(watch_dir, index_rel)
        if not index_content:
            print(f"[{self.name}] ⚠️  output_index 없음: {index_rel}")
            return []

        index_chapters = _parse_chapters_from_index(index_content)
        if not index_chapters:
            print(f"[{self.name}] ⚠️  output_index에서 챕터를 추출할 수 없습니다")
            return []

        existing_report = _read_file(watch_dir, report_rel)
        existing_contents = _parse_chapters_from_report(existing_report) if existing_report else {}
        analysis_content = _read_file(watch_dir, analysis_rel)
        interest_content = _read_file(watch_dir, interest_rel)
        todo_content = _read_todo_results(watch_dir, use_hidden)

        config = _load_config()
        limit = int(config.get("context_length_limit") or 18000)
        chapter_prompt_tpl = (config.get("chapter_prompt") or "").strip()
        if not chapter_prompt_tpl:
            chapter_prompt_tpl = "다음 컨텍스트를 바탕으로 '[챕터명]' 챕터 본문을 500자 이상 3000자 이하로 한글로 작성하세요."

        # 생성이 필요한 챕터: index에는 있지만 기존 보고서에 없거나 본문이 비어 있는 경우
        to_generate = [t for t in index_chapters if not (existing_contents.get(t) or "").strip()]

        if not to_generate:
            # 모두 기존 내용으로 채울 수 있음
            content = _build_report_content(index_chapters, existing_contents, {})
            return self._write_report(watch_dir, content, report_rel)
        # 첫 번째로 생성할 챕터로 LLM 요청
        chapter_title = to_generate[0]
        context = self._build_chapter_context(
            index_content, analysis_content, interest_content, todo_content, existing_report, limit
        )
        prompt = chapter_prompt_tpl.replace("[챕터명]", chapter_title)
        state = {
            "watch_dir": watch_dir,
            "report_rel": report_rel,
            "use_hidden": use_hidden,
            "index_chapters": index_chapters,
            "existing_contents": existing_contents,
            "generated_so_far": {},
            "chapters_to_generate": to_generate,
        }
        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": prompt,
                    "context": context,
                    "intent": "output_report_chapter",
                    "watch_dir": watch_dir,
                    "chapter_title": chapter_title,
                    "state": state,
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] 챕터 생성 요청: {chapter_title} (총 {len(to_generate)}개 생성 예정)")
        return []

    def _get_context_content_limits(self) -> Dict[str, int]:
        """todo_planner/config.yaml의 context_content_limits 로드 (없으면 기본값)."""
        todo_planner_config = _MODULE_DIR.parent / "todo_planner" / "config.yaml"
        limits: Dict[str, int] = {}
        if todo_planner_config.exists():
            try:
                raw = todo_planner_config.read_text(encoding="utf-8")
                data = yaml.safe_load(raw) or {}
                limits = dict(data.get("context_content_limits") or {})
            except Exception as e:
                print(f"[{self.name}] ⚠️  todo_planner config 로드 실패: {e}")
        defaults = {"output_index": 30000, "analysis_result": 50000, "interest": 20000, "todo_result": 40000, "existing_report": 30000}
        return {k: int(limits.get(k) or defaults[k]) for k in defaults}

    def _build_chapter_context(
        self,
        index_content: str,
        analysis_content: str,
        interest_content: str,
        todo_content: str,
        existing_report: str,
        limit: int,
    ) -> str:
        limits = self._get_context_content_limits()

        def _truncate(text: str, max_len: int, default: str = "(없음)") -> str:
            s = (text or "").strip() or default
            return s[:max_len] + "..." if len(s) > max_len else s

        parts = [
            "[output_index]\n---\n" + _truncate(index_content, limits["output_index"], ""),
            "[analysis_result]\n---\n" + _truncate(analysis_content, limits["analysis_result"]),
            "[사용자 관심사]\n---\n" + _truncate(interest_content, limits["interest"]),
            "[todo_result]\n---\n" + _truncate(todo_content, limits["todo_result"]),
            "[이전 보고서 초안]\n---\n" + _truncate(existing_report, limits["existing_report"]),
        ]
        combined = "\n\n".join(parts)
        if len(combined) > limit:
            combined = combined[:limit] + "\n...(생략)"
        return combined

    def _handle_chapter_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(output_report_chapter): 생성된 챕터 반영 후 다음 챕터 요청 또는 보고서 저장."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  챕터 생성 LLM 응답이 없습니다")
            return []
        chapter_title = (payload.get("chapter_title") or "").strip()
        response = (payload.get("response") or "").strip()
        state = payload.get("state") or {}
        watch_dir = state.get("watch_dir") or self.vault_root
        report_rel = state.get("report_rel") or _OUTPUT_REPORT_REL
        index_chapters = state.get("index_chapters") or []
        existing_contents = state.get("existing_contents") or {}
        generated_so_far = dict(state.get("generated_so_far") or {})
        chapters_to_generate = list(state.get("chapters_to_generate") or [])

        if chapter_title:
            generated_so_far[chapter_title] = response
            #현재 챕터를 output_report.md에 추가(Event 발생)
            self.publish(
                Event(
                    type="EVT_WRITE_REQUEST",
                    payload={
                        "watch_dir": watch_dir,
                        "relative_path": report_rel,
                        "content": response,
                        "method": "append",
                        "intent": "output_report_chapter",
                    },
                )
            )
        if chapter_title in chapters_to_generate:
            chapters_to_generate = [t for t in chapters_to_generate if t != chapter_title]

        if not chapters_to_generate:
            content = _build_report_content(index_chapters, existing_contents, generated_so_far)
            return self._write_report(watch_dir, content, report_rel)
        # 다음 챕터 생성 요청
        next_title = chapters_to_generate[0]
        config = _load_config()
        limit = int(config.get("context_length_limit") or 18000)
        chapter_prompt_tpl = (config.get("chapter_prompt") or "").strip()
        if not chapter_prompt_tpl:
            chapter_prompt_tpl = "다음 컨텍스트를 바탕으로 '[챕터명]' 챕터 본문을 500자 이상 3000자 이하로 한글로 작성하세요."
        existing_report = _read_file(watch_dir, report_rel)
        analysis_rel = _ANALYSIS_RESULT_HIDDEN if state.get("use_hidden") else _ANALYSIS_RESULT_REL
        interest_rel = _INTEREST_HIDDEN if state.get("use_hidden") else _INTEREST_REL
        analysis_content = _read_file(watch_dir, analysis_rel)
        interest_content = _read_file(watch_dir, interest_rel)
        todo_content = _read_todo_results(watch_dir, state.get("use_hidden", False))
        index_content = _read_file(watch_dir, _OUTPUT_INDEX_HIDDEN if state.get("use_hidden") else _OUTPUT_INDEX_REL)
        context = self._build_chapter_context(
            index_content, analysis_content, interest_content, todo_content, existing_report, limit
        )
        prompt = chapter_prompt_tpl.replace("[챕터명]", next_title)
        new_state = {
            "watch_dir": watch_dir,
            "report_rel": report_rel,
            "use_hidden": state.get("use_hidden", False),
            "index_chapters": index_chapters,
            "existing_contents": existing_contents,
            "generated_so_far": generated_so_far,
            "chapters_to_generate": chapters_to_generate,
        }
        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": prompt,
                    "context": context,
                    "intent": "output_report_chapter",
                    "watch_dir": watch_dir,
                    "chapter_title": next_title,
                    "state": new_state,
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] 챕터 생성 요청: {next_title} (남은 {len(chapters_to_generate) - 1}개)")
        return []

    def _write_report(self, watch_dir: str, content: str, report_rel: str) -> List[Event]:
        """EVT_WRITE_REQUEST로 output_report.md 저장."""
        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": report_rel,
                    "content": content,
                    "intent": "output_report",
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] output_report 저장 요청: {report_rel}")
        return []
