"""
M_UserInterest: 사용자 관심사(user interest) 추론 모듈
- founds_created / founds_updated / founds_deleted 이벤트를 구독
- founds 내용(요약, 태그, 제목)을 바탕으로 LLM으로 사용자 관심사를 추론·갱신
- 결과를 sago/interest/user_interest.md에 저장하고 EVT_USER_INTEREST_UPDATED 발행
"""
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_PROMPT_FILE = _MODULE_DIR / "user_interest.prompt"


def _is_found_event_type(event_type: str) -> bool:
    """founds_created, founds_updated, founds_deleted 여부"""
    return event_type in ("founds_created", "founds_updated", "founds_deleted")


def _load_prompt(prompt_file: Optional[Path] = None) -> str:
    """프롬프트 파일 로드."""
    path = (prompt_file or _DEFAULT_PROMPT_FILE).resolve()
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"[M_UserInterest] ⚠️  프롬프트 로드 실패 ({path}): {e}")
        return ""


class UserInterestModule(Module):
    """founds 이벤트 기반 사용자 관심사 추론 모듈"""

    name = "M_UserInterest"
    description = "founds 이벤트를 기반으로 사용자 관심사(user interest) 추론"
    capabilities = [
        "founds_created",
        "founds_updated",
        "founds_deleted",
        "LLM_PROMPT_RESPONSE",
        "EVT_USER_INTEREST_UPDATED",
    ]

    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root

    def can_handle(self, event: Event) -> float:
        if _is_found_event_type(event.type):
            return 1.0
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "user_interest_update":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if _is_found_event_type(event.type):
            return self._process_found_event(event)
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "user_interest_update":
            return self._process_user_interest_response(event)
        return []

    def _process_found_event(self, event: Event) -> List[Event]:
        """founds 이벤트 수신 시 기존 관심사 + 이번 found 반영하여 LLM_PROMPT 발행."""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or self.vault_root
        relative_path = payload.get("relative_path", "")
        if not watch_dir:
            print(f"[{self.name}] ⚠️  watch_dir가 없습니다")
            return []

        hide_thinking = payload.get("hide_thinking_process", False)
        # 사용자 관심사 저장 경로: sago/interest/interests.md 또는 .sago/.interest/interests.md (sago_writer로 저장)
        sago_folder = ".sago" if hide_thinking else "sago"
        interest_folder = ".interest" if hide_thinking else "interest"
        interest_file_name = "interests.md"
        user_interest_path = Path(watch_dir) / sago_folder / interest_folder / interest_file_name
        rel_path_interest = f"{sago_folder}/{interest_folder}/{interest_file_name}"
        user_interest_path.parent.mkdir(parents=True, exist_ok=True)

        existing_content = ""
        if user_interest_path.exists():
            try:
                existing_content = user_interest_path.read_text(encoding="utf-8")
            except Exception as e:
                print(f"[{self.name}] ⚠️  기존 관심사 파일 읽기 실패: {user_interest_path}, {e}")

        event_kind = "created" if event.type == "founds_created" else "updated" if event.type == "founds_updated" else "deleted"
        event_desc = self._describe_found_event(event_kind, payload)

        prompt_text = _load_prompt()
        if not prompt_text:
            print(f"[{self.name}] ⚠️  유효한 프롬프트를 로드하지 못해 건너뜁니다.")
            return []

        prompt = self._build_user_interest_prompt(prompt_text, existing_content, event_kind, event_desc)

        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": prompt,
                    "intent": "user_interest_update",
                    "user_interest_path": str(user_interest_path),
                    "watch_dir": watch_dir,
                    "relative_path": rel_path_interest,
                    "event_type": event.type,
                },
                source_module=self.name,
            )
        )
        return []

    def _process_user_interest_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE (user_interest_update) 수신 시, 갱신 필요 시에만 파일 저장 및 EVT_USER_INTEREST_UPDATED 발행."""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            return []
        if payload.get("intent") != "user_interest_update":
            return []

        response_text = (payload.get("response") or "").strip()
        user_interest_path = payload.get("user_interest_path", "")
        watch_dir = payload.get("watch_dir", "")

        if not response_text or not user_interest_path:
            return []

        first_line = response_text.split("\n")[0].strip().upper() if response_text else ""

        # NO_CHANGE: 관심사를 바꿀 필요가 없다고 판단된 경우 → 저장·이벤트 없이 종료
        if first_line == "NO_CHANGE":
            return []

        # OVERWRITE: 갱신된 관심사 본문으로 저장 및 이벤트 발행
        lines = [s for s in response_text.split("\n") if s is not None]
        if lines and first_line == "OVERWRITE":
            body = "\n".join(lines[1:]).strip()
        else:
            body = response_text

        if not body:
            return []

        # sago_writer를 통해 저장 (payload의 relative_path 사용: sago/interest/interests.md 또는 .sago/.interest/interests.md)
        rel_path = (payload.get("relative_path") or "").replace("\\", "/") or "sago/interest/interests.md"

        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": rel_path,
                    "content": body + "\n",
                    "intent": "user_interest",
                    "source_file_path": str(Path(watch_dir) / rel_path),
                },
                source_module=self.name,
            )
        )

        return [
            Event(
                type="EVT_USER_INTEREST_UPDATED",
                payload={
                    "watch_dir": watch_dir,
                    "user_interest_path": str(Path(watch_dir) / rel_path),
                    "relative_path": rel_path,
                    "content": body,
                    "summary": body[:500] + ("..." if len(body) > 500 else ""),
                },
                source_module=self.name,
            )
        ]

    def _describe_found_event(self, event_kind: str, payload: Dict[str, Any]) -> str:
        """이벤트 설명 문자열 생성 (제목·요약·태그 위주)."""
        lines = [f"이벤트: founds 파일 {event_kind}"]
        lines.append(f"파일: {payload.get('filename', payload.get('file_path', ''))}")
        lines.append(f"상대 경로: {payload.get('relative_path', '')}")
        if event_kind != "deleted" and payload.get("content"):
            content = payload["content"]
            lines.append(f"내용 (요약·태그 등, 일부):\n{content[:4000]}{'...' if len(content) > 4000 else ''}")
        elif event_kind == "deleted":
            lines.append("(삭제된 파일이므로 내용 없음)")
        return "\n".join(lines)

    def _build_user_interest_prompt(
        self, prompt_template: str, existing_content: str, event_kind: str, event_desc: str
    ) -> str:
        """기존 관심사 + 이번 found 이벤트를 반영한 프롬프트 조립."""
        return f"""{prompt_template}

기존 사용자 관심사 내용:
---
{existing_content.strip() or "(없음)"}
---

{event_desc}

요구사항:
1. 첫 번째 줄에 반드시 OVERWRITE 또는 NO_CHANGE 중 하나만 출력하세요.
   - NO_CHANGE: 이번 founds 변화만으로는 사용자 관심사를 바꿀 필요가 없다고 판단될 때. (기존 관심사가 이미 이 주제를 담고 있거나, 변화가 미미한 경우)
   - OVERWRITE: 사용자 관심사를 실제로 갱신해야 할 때만 사용. 그 다음 줄부터 갱신된 사용자 관심사를 마크다운으로 작성하세요.
2. 바뀔 필요가 없다면 반드시 NO_CHANGE만 출력하고 본문을 출력하지 마세요.

출력 형식 예시 (갱신할 때):
OVERWRITE

# 사용자 관심사
...

출력 형식 예시 (바꿀 필요 없을 때):
NO_CHANGE
"""
