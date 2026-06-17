"""
M_OutputIndexBuilder: output_index 생성 모듈
- EVT_OUTPUT_INDEX_REQUEST 수신 시 payload.target_file(또는 source_file)로 인덱스 추출 대상 파일 지정 가능.
  대상이 지정되지 않으면 보관소 내 .md 스캔 → LLM 출력 양식 탐색 후, 최종적으로 analysis_result.md를 대상으로 목차(인덱스) 추출.
- EVT_FILE_SCANNED, E_FileCreated 수신 시에도 동일 플로우(미지정 시 analysis_result.md 기준).
- 적합한 양식이 없으면 현재 폴더 파일들(경로+헤딩)에서 LLM 목차 추출 시도 → 없으면 analysis_result 기준 목차 생성 (LLM).
- 생성된 양식을 sago/output/output_index.md에 저장 (EVT_WRITE_REQUEST → sago_writer).
"""
import os
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
_ANALYSIS_RESULT_REL = "sago/analysis/analysis_result.md"
_ANALYSIS_RESULT_HIDDEN = ".sago/.analysis/analysis_result.md"
_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$", re.MULTILINE)
_NONE_PREFIX = "NONE"


def _load_config(config_file: Optional[Path] = None) -> Dict[str, Any]:
    path = (config_file or _DEFAULT_CONFIG).resolve()
    try:
        raw = path.read_text(encoding="utf-8")
        return yaml.safe_load(raw) or {}
    except Exception as e:
        print(f"[OutputIndexBuilder] ⚠️  설정 로드 실패 ({path}): {e}")
        return {}


def _extract_headings(content: str, max_lines: int = 50) -> List[str]:
    """마크다운 본문에서 # ~ ###### 헤딩만 추출 (앞 max_lines 줄만)."""
    lines = content.splitlines()[:max_lines]
    headings: List[str] = []
    for line in lines:
        m = _HEADING_RE.match(line.strip())
        if m:
            headings.append(m.group(1).strip())
    return headings


def _scan_md_files(watch_dir: str, pattern: str, max_files: int, exclude_dirs: Optional[List[str]] = None) -> List[Tuple[str, List[str]]]:
    """watch_dir 아래 pattern에 맞는 .md 파일을 스캔해 (relative_path, headings) 리스트 반환."""
    base = Path(watch_dir)
    if not base.exists():
        return []
    exclude = set(exclude_dirs or [])
    exclude |= {".sago", ".git", "node_modules", "__pycache__"}
    collected: List[Tuple[str, List[str]]] = []
    try:
        for path in sorted(base.glob(pattern))[: max_files * 2]:
            if not path.is_file() or path.suffix.lower() != ".md":
                continue
            try:
                rel = path.relative_to(base)
                if any(part in exclude for part in rel.parts):
                    continue
            except ValueError:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
                headings = _extract_headings(text)
                collected.append((str(rel).replace("\\", "/"), headings))
            except Exception:
                continue
            if len(collected) >= max_files:
                break
    except Exception as e:
        print(f"[OutputIndexBuilder] ⚠️  스캔 실패: {e}")
    return collected


def _read_analysis_result(watch_dir: str, use_hidden: bool = False) -> str:
    rel = _ANALYSIS_RESULT_HIDDEN if use_hidden else _ANALYSIS_RESULT_REL
    path = Path(watch_dir) / rel
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"[OutputIndexBuilder] ⚠️  analysis_result 읽기 실패: {path}, {e}")
        return ""


def _read_target_file(watch_dir: str, target_file: str) -> str:
    """watch_dir 기준 상대 경로 target_file 내용 읽기. 없거나 실패 시 빈 문자열."""
    path = Path(watch_dir) / target_file.lstrip("/")
    if not path.exists() or not path.is_file():
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except Exception as e:
        print(f"[OutputIndexBuilder] ⚠️  대상 파일 읽기 실패: {path}, {e}")
        return ""


class OutputIndexBuilderModule(Module):
    """EVT_OUTPUT_INDEX_REQUEST 시 파일 스캔 → LLM으로 양식 탐색/생성 → output_index.md 저장"""

    name = "M_OutputIndexBuilder"
    description = "출력 양식 탐색 또는 analysis_result 기반 목차 생성 후 output_index.md 저장"
    capabilities = [
        "EVT_OUTPUT_INDEX_REQUEST",
        "EVT_FILE_SCANNED",
        "E_FileCreated",
        "LLM_PROMPT",
        "LLM_PROMPT_RESPONSE",
        "EVT_WRITE_REQUEST",
    ]

    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root

    def can_handle(self, event: Event) -> float:
        if event.type in ("EVT_OUTPUT_INDEX_REQUEST", "EVT_FILE_SCANNED", "E_FileCreated"):
            return 1.0
        if event.type == "LLM_PROMPT_RESPONSE":
            p = event.payload or {}
            if p.get("intent") in ("output_index_find", "output_index_extract_toc", "output_index_create"):
                return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "EVT_OUTPUT_INDEX_REQUEST":
            return self._handle_request(event)
        if event.type == "EVT_FILE_SCANNED":
            return self._handle_file_scanned(event)
        if event.type == "E_FileCreated":
            return self._handle_file_created(event)
        if event.type == "LLM_PROMPT_RESPONSE":
            p = event.payload or {}
            if p.get("intent") == "output_index_find":
                return self._handle_find_response(event)
            if p.get("intent") == "output_index_extract_toc":
                return self._handle_extract_toc_response(event)
            if p.get("intent") == "output_index_create":
                return self._handle_create_response(event)
        return []

    def _handle_file_scanned(self, event: Event) -> List[Event]:
        """EVT_FILE_SCANNED: watch_dir만 추출해 동일한 index 생성 플로우 실행 (스캔 완료 후 파이프라인 디바운스로 1회 호출)."""
        payload = event.payload or {}
        watch_dir = (payload.get("watch_dir") or "").strip()
        if not watch_dir:
            return []
        return self._run_index_build(watch_dir, payload.get("hide_thinking_process", False))

    def _handle_file_created(self, event: Event) -> List[Event]:
        """E_FileCreated: watch_dir 추출 후 index 생성 플로우 실행 (watch_dir 없으면 path/dir의 부모 디렉터리 사용)."""
        payload = event.payload or {}
        watch_dir = (
            payload.get("watch_dir")
            or payload.get("vault_root")
            or payload.get("dir")
            or payload.get("dirname")
            or ""
        )
        if isinstance(watch_dir, str):
            watch_dir = watch_dir.strip()
        else:
            watch_dir = ""
        if not watch_dir and payload.get("path"):
            watch_dir = str(Path(payload["path"]).resolve().parent)
        if not watch_dir:
            return []
        if Path(watch_dir).is_file():
            watch_dir = str(Path(watch_dir).resolve().parent)
        return self._run_index_build(watch_dir, payload.get("hide_thinking_process", False))

    def _handle_request(self, event: Event) -> List[Event]:
        """EVT_OUTPUT_INDEX_REQUEST: payload에 target_file이 있으면 해당 파일로 인덱스 추출, 없으면 전체 스캔 후 최종적으로 analysis_result.md 기준."""
        payload = event.payload or {}
        watch_dir = (payload.get("watch_dir") or payload.get("vault_root") or self.vault_root).strip()
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []
        hide_thinking = payload.get("hide_thinking_process", False)
        use_hidden = hide_thinking

        target_file = (payload.get("target_file") or payload.get("source_file") or "").strip()
        if target_file:
            content = _read_target_file(watch_dir, target_file)
            if not content:
                print(f"[{self.name}] ⚠️  대상 파일 없음 또는 비어 있음: {target_file}")
                return []
            print(f"[{self.name}] 대상 파일로 인덱스 추출: {target_file}")
            return self._request_index_from_content(watch_dir, content, use_hidden, hide_thinking)

        return self._run_index_build(watch_dir, hide_thinking)

    def _run_index_build(self, watch_dir: str, hide_thinking: bool) -> List[Event]:
        """watch_dir 기준으로 파일 스캔 후 LLM 양식 탐색 요청 (공통 로직)."""
        config = _load_config()
        pattern = config.get("scan_pattern") or "**/*.md"
        max_files = int(config.get("max_files_for_scan") or 80)
        find_prompt = (config.get("find_format_prompt") or "").strip()
        if not find_prompt:
            find_prompt = "다음 파일 목록에서 최종 출력 보고서용 목차 양식이 있으면 ## 챕터명 형식으로 추출하세요. 없으면 NONE만 출력하세요."

        files_with_headings = _scan_md_files(watch_dir, pattern, max_files)
        context_parts: List[str] = []
        for rel_path, headings in files_with_headings:
            context_parts.append(f"파일: {rel_path}")
            if headings:
                context_parts.append("헤딩: " + " | ".join(headings[:15]))
            else:
                context_parts.append("헤딩: (없음)")
            context_parts.append("")
        context = "\n".join(context_parts).strip()
        limit = int(config.get("context_length_limit") or 12000)
        if len(context) > limit:
            context = context[:limit] + "\n...(생략)"

        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": find_prompt,
                    "context": context,
                    "intent": "output_index_find",
                    "watch_dir": watch_dir,
                    "hide_thinking_process": hide_thinking,
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] 출력 양식 탐색 요청 (파일 {len(files_with_headings)}개)")
        return []

    def _handle_find_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(output_index_find): NONE이면 폴더 파일에서 목차 추출 시도 → 그래도 없으면 analysis_result 기준."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  양식 탐색 LLM 응답이 없습니다")
            return []
        response = (payload.get("response") or "").strip()
        watch_dir = payload.get("watch_dir") or self.vault_root
        hide_thinking = payload.get("hide_thinking_process", False)
        use_hidden = hide_thinking

        first_line = response.split("\n")[0].strip().upper() if response else ""
        if first_line == _NONE_PREFIX or len(response) < 20:
            # 1단계: 현재 폴더 파일들(sago_scanner와 동일한 스캔)에서 목차 추출 시도
            config = _load_config()
            pattern = config.get("scan_pattern") or "**/*.md"
            max_files = int(config.get("max_files_for_scan") or 80)
            files_with_headings = _scan_md_files(watch_dir, pattern, max_files)
            if not files_with_headings:
                return self._fallback_to_analysis_result(watch_dir, use_hidden, hide_thinking)

            extract_prompt = (config.get("extract_toc_prompt") or "").strip()
            if not extract_prompt:
                extract_prompt = "다음 파일들의 헤딩을 보고 하나의 보고서 목차를 ## 챕터명 형식으로 추출하세요. 불가능하면 NONE만 출력하세요."
            context_parts: List[str] = []
            for rel_path, headings in files_with_headings:
                context_parts.append(f"파일: {rel_path}")
                context_parts.append("헤딩: " + (" | ".join(headings[:15]) if headings else "(없음)"))
                context_parts.append("")
            context = "\n".join(context_parts).strip()
            limit = int(config.get("context_length_limit") or 12000)
            if len(context) > limit:
                context = context[:limit] + "\n...(생략)"

            self.publish(
                Event(
                    type="LLM_PROMPT",
                    payload={
                        "prompt": extract_prompt,
                        "context": context,
                        "intent": "output_index_extract_toc",
                        "watch_dir": watch_dir,
                        "hide_thinking_process": hide_thinking,
                    },
                    source_module=self.name,
                )
            )
            print(f"[{self.name}] 폴더 파일에서 목차 추출 요청 (파일 {len(files_with_headings)}개)")
            return []
        # 적합한 양식 있음 → 그대로 저장
        index_content = response if response.endswith("\n") else response + "\n"
        return self._write_output_index(watch_dir, index_content, use_hidden)

    def _handle_extract_toc_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(output_index_extract_toc): NONE/부적합이면 analysis_result 기준으로, 아니면 추출 목차 저장."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  목차 추출 LLM 응답이 없습니다")
            return []
        response = (payload.get("response") or "").strip()
        watch_dir = payload.get("watch_dir") or self.vault_root
        hide_thinking = payload.get("hide_thinking_process", False)
        use_hidden = hide_thinking

        first_line = response.split("\n")[0].strip().upper() if response else ""
        if first_line == _NONE_PREFIX or len(response) < 20:
            return self._fallback_to_analysis_result(watch_dir, use_hidden, hide_thinking)
        index_content = response if response.endswith("\n") else response + "\n"
        return self._write_output_index(watch_dir, index_content, use_hidden)

    def _request_index_from_content(
        self, watch_dir: str, content: str, use_hidden: bool, hide_thinking: bool
    ) -> List[Event]:
        """주어진 본문(content)을 기준으로 LLM에 목차 생성 요청."""
        config = _load_config()
        create_prompt = (config.get("create_index_prompt") or "").strip()
        if not create_prompt:
            create_prompt = "다음 내용을 기준으로 출력 보고서 혹은 계획서 목차를 ## 챕터명 형식으로 작성하세요."
        limit = 10000
        context = f"[content]\n---\n{content[:limit]}{'...' if len(content) > limit else ''}\n---"
        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": create_prompt,
                    "context": context,
                    "intent": "output_index_create",
                    "watch_dir": watch_dir,
                    "hide_thinking_process": hide_thinking,
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] 본문 기준 목차 생성 요청")
        return []

    def _fallback_to_analysis_result(self, watch_dir: str, use_hidden: bool, hide_thinking: bool) -> List[Event]:
        """analysis_result 기반 목차 생성 요청 또는 기본 목차 저장."""
        analysis_content = _read_analysis_result(watch_dir, use_hidden)
        if not analysis_content:
            print(f"[{self.name}] ⚠️  analysis_result 없음, 기본 목차로 저장")
            index_content = "# 출력 보고서\n\n## 개요\n## 분석 요약\n## 결론\n"
            return self._write_output_index(watch_dir, index_content, use_hidden)
        return self._request_index_from_content(watch_dir, analysis_content, use_hidden, hide_thinking)

    def _handle_create_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(output_index_create): 생성된 목차를 output_index.md로 저장."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  목차 생성 LLM 응답이 없습니다")
            return []
        response = (payload.get("response") or "").strip()
        watch_dir = payload.get("watch_dir") or self.vault_root
        hide_thinking = payload.get("hide_thinking_process", False)
        use_hidden = hide_thinking
        index_content = response if response.endswith("\n") else response + "\n"
        return self._write_output_index(watch_dir, index_content, use_hidden)

    def _write_output_index(self, watch_dir: str, content: str, use_hidden: bool) -> List[Event]:
        """EVT_WRITE_REQUEST로 output_index.md 저장."""
        relative_path = _OUTPUT_INDEX_HIDDEN if use_hidden else _OUTPUT_INDEX_REL
        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": relative_path,
                    "content": content,
                    "intent": "output_index",
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] output_index 저장 요청: {relative_path}")
        return []
