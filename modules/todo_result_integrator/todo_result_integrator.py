"""
M_TodoResultIntegrator: todo_result 추가 시 analysis_result 통합 모듈
- EVT_WRITE_COMPLETE(intent=todo_result) 수신 시 해당 파일 읽기
- interests + analysis_result를 기반으로 취합 적합 여부 LLM 판단
- 적합 시 analysis_result에 통합(merge) 후 EVT_WRITE_REQUEST로 저장
"""
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from SagoHub.core.event import Event
from SagoHub.core.module import Module

_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_CONFIG_FILE = _MODULE_DIR / "config.yaml"

_JUDGE_SUITABLE = re.compile(r"^\s*SUITABLE\s*$", re.IGNORECASE | re.MULTILINE)
_DEFAULT_ANALYSIS_REL = "sago/analysis/founds/analysis_result.md"  # source_analysis 없을 때 사용


def _load_config(config_file: Optional[Path] = None) -> Dict[str, Any]:
    """설정 로드."""
    path = (config_file or _DEFAULT_CONFIG_FILE).resolve()
    try:
        raw = path.read_text(encoding="utf-8")
        return yaml.safe_load(raw) or {}
    except Exception as e:
        print(f"[M_TodoResultIntegrator] ⚠️  설정 로드 실패 ({path}): {e}")
        return {}


def _parse_frontmatter(content: str) -> Tuple[Dict[str, str], str]:
    """YAML frontmatter(--- ... ---) 파싱. (frontmatter_dict, body_after_frontmatter) 반환."""
    if not content.strip().startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    try:
        data = yaml.safe_load(parts[1].strip()) or {}
        return {k: str(v).strip() for k, v in data.items() if v}, parts[2].strip()
    except Exception:
        return {}, content


def _read_interest(watch_dir: str, use_hidden: bool = False) -> str:
    """sago/interest/interests.md 또는 .sago/.interest/interests.md 내용 반환."""
    base = Path(watch_dir)
    sago = ".sago" if use_hidden else "sago"
    path = base / sago / "interest" / "interests.md"
    if path.exists():
        try:
            return path.read_text(encoding="utf-8").strip()
        except Exception as e:
            print(f"[M_TodoResultIntegrator] ⚠️  interests 읽기 실패: {path}, {e}")
    return ""


class TodoResultIntegratorModule(Module):
    """todo_result 파일 추가 시 interests·analysis_result 기반으로 취합 적합 여부 판단 후 analysis_result 통합"""

    name = "M_TodoResultIntegrator"
    description = "todo_result 추가 시 interests·analysis_result 기반 판단 후 analysis_result 통합"
    capabilities = [
        "EVT_WRITE_COMPLETE",
        "LLM_PROMPT",
        "LLM_PROMPT_RESPONSE",
        "EVT_WRITE_REQUEST",
    ]

    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root

    def can_handle(self, event: Event) -> float:
        if event.type == "EVT_WRITE_COMPLETE":
            if (event.payload or {}).get("intent") == "todo_result":
                return 1.0
            return 0.0
        if event.type == "LLM_PROMPT_RESPONSE":
            p = event.payload or {}
            if p.get("intent") in ("todo_result_judge", "todo_result_merge"):
                return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "EVT_WRITE_COMPLETE":
            return self._handle_todo_result_written(event)
        if event.type == "LLM_PROMPT_RESPONSE":
            p = event.payload or {}
            if p.get("intent") == "todo_result_judge":
                return self._handle_judge_response(event)
            if p.get("intent") == "todo_result_merge":
                return self._handle_merge_response(event)
        return []

    def _handle_todo_result_written(self, event: Event) -> List[Event]:
        """EVT_WRITE_COMPLETE(todo_result): 파일 읽고 source_analysis·interests·analysis_result 로드 후 판단 LLM 발행."""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or self.vault_root
        relative_path = (payload.get("relative_path") or "").lstrip("/")
        report_path = payload.get("report_path", "")
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []
        path = Path(report_path) if report_path else Path(watch_dir) / relative_path
        if not path.exists():
            print(f"[{self.name}] ⚠️  todo_result 파일 없음: {path}")
            return []
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"[{self.name}] ⚠️  읽기 실패: {path}, {e}")
            return []

        fm, body = _parse_frontmatter(raw)
        source_analysis = (fm.get("source_analysis") or "").strip().replace("\\", "/")
        if not source_analysis:
            source_analysis = _DEFAULT_ANALYSIS_REL
        analysis_path = Path(watch_dir) / source_analysis
        if not analysis_path.exists():
            print(f"[{self.name}] ⚠️  analysis_result 없음: {analysis_path}, 통합 스킵")
            return []

        try:
            analysis_content = analysis_path.read_text(encoding="utf-8").strip()
        except Exception as e:
            print(f"[{self.name}] ⚠️  analysis_result 읽기 실패: {analysis_path}, {e}")
            return []
        use_hidden = source_analysis.startswith(".sago")
        interest_content = _read_interest(watch_dir, use_hidden)

        config = _load_config()
        judge_prompt = (config.get("judge_prompt") or "").strip()
        if not judge_prompt:
            judge_prompt = """다음 [todo_result]가 [사용자 관심사]와 [현재 분석 결과(analysis_result)]를 고려할 때, analysis_result에 통합하기 적합한지 판단해 주세요.
- 적합하면 SUITABLE, 부적합하면 NOT_SUITABLE 한 줄만 출력하고, 그 다음 줄부터 이유를 간단히 작성하세요.
- 사용자 관심사·분석 맥락과 맞고, 분석 결과를 보강할 수 있는 실질적 내용이면 SUITABLE로 판단하세요."""

        context = f"""[사용자 관심사]
---
{interest_content or '(없음)'}
---

[현재 분석 결과]
---
{analysis_content[:8000]}{"..." if len(analysis_content) > 8000 else ""}
---

[todo_result]
---
{body[:6000]}{"..." if len(body) > 6000 else ""}
---"""

        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": judge_prompt,
                    "context": context,
                    "intent": "todo_result_judge",
                    "watch_dir": watch_dir,
                    "source_analysis": source_analysis,
                    "analysis_content": analysis_content,
                    "todo_result_content": body,
                    "interest_content": interest_content,
                    "report_path": str(path),
                    "relative_path": relative_path,
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] todo_result 취합 적합 여부 판단 요청: {path.name} → {source_analysis}")
        return []

    def _handle_judge_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(todo_result_judge): SUITABLE이면 통합(merge) LLM 발행."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            return []
        if payload.get("intent") != "todo_result_judge":
            return []
        response = (payload.get("response") or "").strip()
        if not _JUDGE_SUITABLE.search(response):
            print(f"[{self.name}] 판단 결과: 통합 부적합 → 스킵")
            # 부적합한 todo_result 파일 삭제
            watch_dir = payload.get("watch_dir") or self.vault_root
            report_path = payload.get("report_path", "").strip()
            relative_path = (payload.get("relative_path") or "").lstrip("/")
            path = Path(report_path) if report_path else (Path(watch_dir) / relative_path if watch_dir and relative_path else None)
            if path and path.exists():
                try:
                    path.unlink()
                    print(f"[{self.name}] 부적합 todo_result 파일 삭제: {path}")
                except Exception as e:
                    print(f"[{self.name}] ⚠️  todo_result 파일 삭제 실패: {path}, {e}")
            return []

        watch_dir = payload.get("watch_dir") or self.vault_root
        source_analysis = (payload.get("source_analysis") or "").strip().replace("\\", "/")
        analysis_content = payload.get("analysis_content") or ""
        todo_result_content = payload.get("todo_result_content") or ""
        interest_content = payload.get("interest_content") or ""
        if not watch_dir or not source_analysis:
            return []

        config = _load_config()
        merge_prompt = (config.get("merge_prompt") or "").strip()
        if not merge_prompt:
            merge_prompt = """다음 [현재 analysis_result]와 [새 todo_result]를 통합하여 analysis_result.md에 쓸 새 본문을 작성하세요.
- 첫 줄에 반드시 OVERWRITE만 출력하고, 그 다음 줄부터 통합된 분석 본문을 마크다운으로 작성하세요.
- 기존 분석의 구조와 맥락을 유지하면서 todo_result의 핵심 내용을 적절한 섹션에 반영하세요. 중복은 정리하고 흐름을 맞추세요."""

        context = f"""[현재 analysis_result]
---
{analysis_content}
---

[todo_result (통합할 내용)]
---
{todo_result_content}
---

[참고: 사용자 관심사]
---
{interest_content[:2000] or "(없음)"}
---"""

        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": merge_prompt,
                    "context": context,
                    "intent": "todo_result_merge",
                    "watch_dir": watch_dir,
                    "source_analysis": source_analysis,
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] analysis_result 통합(merge) 요청: {source_analysis}")
        return []

    def _handle_merge_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE(todo_result_merge): OVERWRITE + 본문 파싱 후 EVT_WRITE_REQUEST 발행."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            return []
        if payload.get("intent") != "todo_result_merge":
            return []
        response = (payload.get("response") or "").strip()
        watch_dir = payload.get("watch_dir") or self.vault_root
        source_analysis = (payload.get("source_analysis") or "").strip().replace("\\", "/")
        if not watch_dir or not source_analysis:
            return []

        lines = [s for s in response.split("\n") if s is not None]
        if not lines or lines[0].strip().upper() != "OVERWRITE":
            print(f"[{self.name}] ⚠️  merge 응답에 OVERWRITE가 없습니다")
            return []
        body = "\n".join(lines[1:]).strip()
        if not body:
            print(f"[{self.name}] ⚠️  merge 본문이 비어 있습니다")
            return []

        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": source_analysis,
                    "content": body + "\n",
                    "intent": "analysis_result",
                },
                source_module=self.name,
            )
        )
        print(f"[{self.name}] analysis_result 통합 저장 요청: {source_analysis}")
        return []
