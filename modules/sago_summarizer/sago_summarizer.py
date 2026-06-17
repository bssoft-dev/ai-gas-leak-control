"""
M_SagoSummarizer: 파일 요약 모듈 (llm_prompt 연동)
- EVT_FILE_SCANNED/EVT_FILE_CHANGE 수신 시 LLM_PROMPT 발행
- LLM_PROMPT_RESPONSE 수신 시 EVT_WRITE_REQUEST 발행 → sago_writer가 sago/founds/에 저장
- 프롬프트 텍스트는 .prompt 파일을 그때그때 로드하여 사용
"""
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 모듈 디렉터리 기준 .prompt 파일 경로
_MODULE_DIR = Path(__file__).resolve().parent
_DEFAULT_PROMPT_FILE = _MODULE_DIR / "summary.prompt"


def _load_prompt(prompt_file: Optional[Path] = None) -> str:
    """지정한 .prompt 파일을 로드. 없으면 기본 summary.prompt 사용."""
    path = (prompt_file or _DEFAULT_PROMPT_FILE).resolve()
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"[M_SagoSummarizer] ⚠️  프롬프트 로드 실패 ({path}): {e}")
        return ""


class SagoSummarizerModule(Module):
    """파일 요약 모듈 (llm_prompt 사용). 사용자 관심사 이벤트를 반영해 관심사 측면에서 요약."""
    
    name = "M_SagoSummarizer"
    description = "LLM으로 파일 요약 후 sago/founds 폴더에 저장"
    capabilities = [
        "EVT_FILE_SCANNED",
        "EVT_FILE_CHANGE",
        "LLM_PROMPT_RESPONSE",
        "EVT_WRITE_REQUEST",
        "EVT_SUMMARY_DONE",
        "EVT_USER_INTEREST_UPDATED",
    ]
    
    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root
        # watch_dir -> 최신 사용자 관심사 본문 (EVT_USER_INTEREST_UPDATED 수신 시 갱신)
        self._user_interest_cache: Dict[str, str] = {}
    
    def can_handle(self, event: Event) -> float:
        if event.type in ["EVT_FILE_SCANNED", "EVT_FILE_CHANGE", "LLM_PROMPT_RESPONSE", "EVT_USER_INTEREST_UPDATED"]:
            return 1.0
        return 0.0
    
    def process(self, event: Event) -> List[Event]:
        if event.type in ["EVT_FILE_SCANNED", "EVT_FILE_CHANGE"]:
            return self._request_summary(event)
        if event.type == "LLM_PROMPT_RESPONSE":
            return self._save_summary_response(event)
        if event.type == "EVT_USER_INTEREST_UPDATED":
            return self._on_user_interest_updated(event)
        return []
    
    def _on_user_interest_updated(self, event: Event) -> List[Event]:
        """사용자 관심사 갱신 이벤트 수신 시 캐시 업데이트 (다음 요약부터 반영)."""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir", "").strip()
        # 전체 본문(content) 우선, 없으면 요약(summary)으로 캐시
        content = payload.get("content") or payload.get("summary", "")
        if watch_dir:
            self._user_interest_cache[watch_dir] = (content or "").strip()
        return []
    
    def _request_summary(self, event: Event) -> List[Event]:
        """파일 내용으로 LLM_PROMPT 발행 (llm_prompt 모듈이 처리)"""
        payload = event.payload or {}
        file_path = payload.get("file_path")
        content = payload.get("content", "")
        vault_root = payload.get("watch_dir") or self.vault_root
        hide_thinking = payload.get("hide_thinking_process", False)
        
        if not file_path or not content or not vault_root:
            print(f"[{self.name}] ⚠️  필수 정보가 없습니다: file_path={file_path}, vault_root={vault_root}")
            return []
        
        # 그때그때 .prompt 파일에서 프롬프트 로드
        prompt_path = payload.get("prompt_file")
        prompt_text = _load_prompt(Path(prompt_path) if prompt_path else None)
        if not prompt_text:
            print(f"[{self.name}] ⚠️  유효한 프롬프트를 로드하지 못해 요약 요청을 건너뜁니다.")
            return []
        
        # 사용자 관심사 반영: 캐시 또는 .interest/interests.md에서 로드
        user_interest = self._get_user_interest(vault_root, hide_thinking)
        if user_interest:
            prompt_text = prompt_text.rstrip() + "\n\n[사용자 관심사 (이 관점에서 요약할 것)]\n" + user_interest[:4000] + "\n\n위 관심사를 반영하여, 사용자 관심사 측면에서 요약해주세요."
        
        # LLM_PROMPT 발행 (context=원문, prompt=요약 지시, 메타데이터 pass-through)
        prompt_payload = {
            "context": content[:8000],  # 토큰 제한 고려
            "prompt": prompt_text,
            "file_path": file_path,
            "watch_dir": vault_root,
            "hide_thinking_process": hide_thinking,
            "relative_path": payload.get("relative_path", ""),
        }
        self.publish(Event(type="LLM_PROMPT", payload=prompt_payload, source_module=self.name))
        return []
    
    def _get_user_interest(self, vault_root: str, hide_thinking: bool = False) -> str:
        """캐시 또는 sago/interest/interests.md(.sago/.interest)에서 사용자 관심사 본문 반환."""
        if not vault_root:
            return ""
        # 1) 캐시에 있으면 사용
        cached = self._user_interest_cache.get(vault_root, "").strip()
        if cached:
            return cached
        # 2) 디스크에서 로드 (user_interest 모듈이 sago_writer로 저장한 파일)
        sago = ".sago" if hide_thinking else "sago"
        interest_folder = ".interest" if hide_thinking else "interest"
        interest_path = Path(vault_root) / sago / interest_folder / "interests.md"
        if interest_path.exists():
            try:
                return interest_path.read_text(encoding="utf-8").strip()
            except Exception as e:
                print(f"[{self.name}] ⚠️  사용자 관심사 파일 읽기 실패: {interest_path}, {e}")
        return ""
    
    def _save_summary_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE 수신 시 founds에 저장 후 EVT_SUMMARY_DONE 발행"""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            return []
        file_path = payload.get("file_path")
        vault_root = payload.get("watch_dir", "")
        hide_thinking = payload.get("hide_thinking_process", False)
        if not file_path or not vault_root:
            return []
        
        summary = payload.get("response", "")
        summary_path = self._save_summary(vault_root, file_path, summary, hide_thinking)
        if not summary_path:
            return []
        
        return [
            Event(
                type="EVT_SUMMARY_DONE",
                payload={
                    "file_path": file_path,
                    "relative_path": payload.get("relative_path", ""),
                    "summary_path": summary_path,
                    "summary": summary,
                    "watch_dir": vault_root,
                },
                source_module=self.name,
            )
        ]
    
    def _save_summary(self, vault_root: str, file_path: str, summary: str, hide_thinking: bool = False) -> Optional[str]:
        """EVT_WRITE_REQUEST 발행 → sago_writer가 sago/founds/ (또는 .sago/.founds/)에 저장"""
        sago_folder = ".sago" if hide_thinking else "sago"
        founds_folder = ".founds" if hide_thinking else "founds"
        original_name = Path(file_path).name
        relative_path = f"{sago_folder}/{founds_folder}/{original_name}"
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        content = f"**원본**: `{file_path}`\n**요약 시각**: {timestamp}\n\n{summary}\n"

        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": vault_root,
                    "relative_path": relative_path,
                    "content": content,
                    "intent": "summary",
                    "source_file_path": file_path,
                },
                source_module=self.name,
            )
        )
        return str(Path(vault_root) / relative_path)
