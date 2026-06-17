"""
M_TodoPlanner: analysis 폴더 이벤트 기반 Todo 목록 통합 모듈
- analysis_created / analysis_updated / analysis_deleted 수신
- LLM_PROMPT로 분석 본문에서 할 일(todo) 목록 추출 요청 → LLM_PROMPT_RESPONSE 수신 후 통합 목록 갱신
- sago/todo/todo_list.md (또는 .sago/.todo/) 통합 목록: 소스별 섹션 추가·수정·삭제
- 저장은 EVT_WRITE_REQUEST로 sago_writer에 위임
- 프롬프트와 콘텐츠 길이 제한은 config.yaml에서 그때그때 로드
"""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 모듈 디렉터리 기준 설정 파일 경로
_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_CONFIG_FILE = _MODULE_DIR / "config.yaml"

# LLM 응답에서 마크다운 체크박스 파싱용
_TODO_LINE = re.compile(r"^\s*[-*]\s*\[([ xX])\]\s*(.*)$", re.MULTILINE)
# ## source: ... 형태 섹션
_SECTION_HEADER = re.compile(r"^##\s+source:\s*(.+)$", re.MULTILINE)

# 기본값 (설정 파일 없거나 키 없을 때)
_DEFAULT_TODO_EXTRACT_PROMPT = """다음 분석/문서 내용에서 "할 일(to-do)" 항목만 추출하세요.
- 완료된 일: - [x] 로 시작하는 한 줄
- 미완료 일: - [ ] 로 시작하는 한 줄
- 다른 설명이나 헤더 없이, 위 형식의 줄만 출력하세요. 한 줄에 한 항목.

내용:
"""
_DEFAULT_CONTENT_LENGTH_LIMIT = 12000

# "할 일 없음"일 때 빈 목록으로 처리
_EMPTY_MARKER = "할 일 없음"


def _load_config(config_file: Optional[Path] = None) -> Tuple[str, int]:
    """설정 파일에서 todo_extract_prompt, content_length_limit 로드. (prompt, limit) 반환."""
    path = (config_file or _DEFAULT_CONFIG_FILE).resolve()
    try:
        raw = path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw) or {}
        prompt = (data.get("todo_extract_prompt") or "").strip()
        if not prompt:
            prompt = _DEFAULT_TODO_EXTRACT_PROMPT
        limit = data.get("content_length_limit")
        if limit is None or (isinstance(limit, int) and limit <= 0):
            limit = _DEFAULT_CONTENT_LENGTH_LIMIT
        else:
            limit = int(limit)
        return prompt, limit
    except Exception as e:
        print(f"[M_TodoPlanner] ⚠️  설정 로드 실패 ({path}): {e}, 기본값 사용")
        return _DEFAULT_TODO_EXTRACT_PROMPT, _DEFAULT_CONTENT_LENGTH_LIMIT


class TodoPlannerModule(Module):
    """analysis 폴더 변경 시 LLM으로 할 일 추출 후 통합 todo_list 갱신"""

    name = "M_TodoPlanner"
    description = "LLM으로 analysis 파일의 할 일 목록 추출 및 통합 todo_list.md 갱신"
    capabilities = [
        "analysis_created", "analysis_updated", "analysis_deleted",
        "LLM_PROMPT_RESPONSE", "EVT_WRITE_REQUEST", "EVT_TODO_UPDATED",
    ]

    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root

    def can_handle(self, event: Event) -> float:
        if event.type in ("analysis_created", "analysis_updated", "analysis_deleted"):
            return 1.0
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "todo_extract":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "analysis_deleted":
            return self._handle_deleted(event)
        if event.type in ("analysis_created", "analysis_updated"):
            return self._handle_created_or_updated(event)
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "todo_extract":
            return self._handle_todo_extract_response(event)
        return []

    def _handle_created_or_updated(self, event: Event) -> List[Event]:
        """analysis_created/updated: LLM_PROMPT 발행하여 todo 추출 요청 (응답은 _handle_todo_extract_response에서 처리)"""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or self.vault_root
        content = payload.get("content", "")
        file_path = payload.get("file_path", "")
        relative_path = payload.get("relative_path", "")
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []
        source_key = self._source_key(file_path, relative_path, payload.get("filename", ""))
        use_hidden = relative_path.startswith(".sago")

        todo_prompt, content_limit = _load_config()
        truncated = (content[:content_limit] or "(내용 없음)")
        prompt = todo_prompt + truncated
        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": prompt,
                    "context": "",
                    "intent": "todo_extract",
                    "watch_dir": watch_dir,
                    "source_key": source_key,
                    "relative_path": relative_path,
                    "file_path": file_path,
                    "use_hidden": use_hidden,
                },
                source_module=self.name,
            )
        )
        return []

    def _handle_todo_extract_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(intent=todo_extract) 수신 시 응답에서 todo 파싱 후 통합 목록 갱신"""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  todo 추출 LLM 응답이 없습니다")
            return []
        if payload.get("intent") != "todo_extract":
            return []

        watch_dir = payload.get("watch_dir") or self.vault_root
        source_key = payload.get("source_key", "")
        use_hidden = payload.get("use_hidden", False)
        response_text = (payload.get("response") or "").strip()

        if _EMPTY_MARKER in response_text and not _TODO_LINE.search(response_text):
            new_todos: List[Tuple[bool, str]] = []
        else:
            new_todos = self._extract_todos_from_text(response_text)

        _, existing_content = self._read_todo_list(watch_dir, use_hidden)
        sections = self._parse_todo_list(existing_content)
        # 기존 완료 여부 반영 + 새 항목만 하단 추가 (덮어쓰지 않음)
        sections[source_key] = self._merge_todos_for_source(
            sections.get(source_key, []),
            new_todos,
        )
        new_content = self._render_todo_list(sections)
        rel_write = ".sago/.todo/todo_list.md" if use_hidden else "sago/todo/todo_list.md"
        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": rel_write,
                    "content": new_content,
                    "intent": "todo_list",
                    "source_file_path": payload.get("file_path", ""),
                },
                source_module=self.name,
            )
        )
        return [
            Event(
                type="EVT_TODO_UPDATED",
                payload={
                    "watch_dir": watch_dir,
                    "todo_list_path": str(Path(watch_dir) / rel_write),
                    "source_key": source_key,
                    "todos_count": len(sections[source_key]),
                },
                source_module=self.name,
            )
        ]

    def _handle_deleted(self, event: Event) -> List[Event]:
        """analysis_deleted: 해당 소스 섹션 제거 후 목록 저장"""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or self.vault_root
        file_path = payload.get("file_path", "")
        relative_path = payload.get("relative_path", "")
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []
        source_key = self._source_key(file_path, relative_path, payload.get("filename", ""))
        use_hidden = relative_path.startswith(".sago")
        _, existing_content = self._read_todo_list(watch_dir, use_hidden)
        sections = self._parse_todo_list(existing_content)
        sections.pop(source_key, None)
        new_content = self._render_todo_list(sections)
        rel_write = ".sago/.todo/todo_list.md" if use_hidden else "sago/todo/todo_list.md"
        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": rel_write,
                    "content": new_content,
                    "intent": "todo_list",
                    "source_file_path": file_path,
                },
                source_module=self.name,
            )
        )
        return [
            Event(
                type="EVT_TODO_UPDATED",
                payload={
                    "watch_dir": watch_dir,
                    "todo_list_path": str(Path(watch_dir) / rel_write),
                    "source_key": source_key,
                    "deleted": True,
                },
                source_module=self.name,
            )
        ]

    def _merge_todos_for_source(
        self,
        existing: List[Tuple[bool, str]],
        new_todos: List[Tuple[bool, str]],
    ) -> List[Tuple[bool, str]]:
        """
        기존 todo: 완료 여부만 새 추출 결과로 갱신.
        새 추출에만 있는 항목은 기존 목록 하단에 추가.
        (기존 항목 삭제·재배치 없음)
        """
        # 새 추출 결과를 텍스트 → 완료 여부로 매핑
        new_by_text: Dict[str, bool] = {text.strip(): checked for checked, text in new_todos if text.strip()}
        existing_texts = {text.strip() for _, text in existing if text.strip()}

        merged: List[Tuple[bool, str]] = []
        # 1) 기존 항목 유지, 완료 여부만 새 추출에서 있으면 반영
        for checked, text in existing:
            t = text.strip()
            if not t:
                continue
            if t in new_by_text:
                merged.append((new_by_text[t], text))
            else:
                merged.append((checked, text))

        # 2) 새 항목만 하단에 추가 (기존에 없던 텍스트)
        for checked, text in new_todos:
            t = text.strip()
            if t and t not in existing_texts:
                merged.append((checked, text))
                existing_texts.add(t)

        return merged

    def _source_key(self, file_path: str, relative_path: str, filename: str) -> str:
        """통합 목록에서 소스 구분용 키 (상대 경로 또는 파일명)"""
        if relative_path:
            return relative_path.replace("\\", "/")
        if file_path:
            return Path(file_path).name
        return filename or "unknown"

    def _extract_todos_from_text(self, content: str) -> List[Tuple[bool, str]]:
        """LLM 응답 등 텍스트에서 마크다운 체크박스(- [ ] / - [x] 등) 추출. 반환: [(checked, text), ...]"""
        out: List[Tuple[bool, str]] = []
        for m in _TODO_LINE.finditer(content):
            checked = m.group(1).lower() == "x"
            text = m.group(2).strip()
            if text:
                out.append((checked, text))
        return out

    def _read_todo_list(self, watch_dir: str, use_hidden: bool) -> Tuple[Path, str]:
        """기존 todo_list.md 경로와 내용 반환. 없으면 빈 문자열."""
        base = Path(watch_dir)
        path = base / ".sago/.todo/todo_list.md" if use_hidden else base / "sago/todo/todo_list.md"
        if path.exists():
            try:
                return path, path.read_text(encoding="utf-8")
            except Exception as e:
                print(f"[{self.name}] ⚠️  todo_list 읽기 실패: {path}, {e}")
        return path, ""

    def _parse_todo_list(self, content: str) -> Dict[str, List[Tuple[bool, str]]]:
        """todo_list.md 본문을 소스별 섹션 딕셔너리로 파싱."""
        sections: Dict[str, List[Tuple[bool, str]]] = {}
        current_key: Optional[str] = None
        for line in content.splitlines():
            m = _SECTION_HEADER.match(line.strip())
            if m:
                current_key = m.group(1).strip()
                sections[current_key] = []
                continue
            if current_key is None:
                continue
            tm = _TODO_LINE.match(line)
            if tm:
                checked = tm.group(1).lower() == "x"
                text = tm.group(2).strip()
                if text:
                    sections[current_key].append((checked, text))
        return sections

    def _render_todo_list(self, sections: Dict[str, List[Tuple[bool, str]]]) -> str:
        """소스별 섹션을 마크다운 문자열로 렌더링."""
        lines = ["# Todo 목록 (통합)", ""]
        for source_key in sorted(sections.keys()):
            items = sections[source_key]
            if not items:
                continue
            lines.append(f"## source: {source_key}")
            lines.append("")
            for checked, text in items:
                box = "[x]" if checked else "[ ]"
                lines.append(f"- {box} {text}")
            lines.append("")
        return "\n".join(lines).strip() + "\n"
