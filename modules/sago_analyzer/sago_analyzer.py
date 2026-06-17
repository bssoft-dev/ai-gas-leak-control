"""
M_SagoAnalyzer: 텍스트 분석 모듈
- LLM을 통해 텍스트의 핵심 주제, 요약, 액션 아이템, 감정 상태 추출
- policy와 rule 파일을 읽어 원칙 준수 여부 대조
- 분석 완료 시 EVT_ANALYSIS_DONE 이벤트 발생
- found 이벤트(created/updated/deleted) 시 analysis_result.md 갱신 (기존 내용 + 이벤트 기반 분석)
"""
import os
import re
import json
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module


def _is_found_event_type(event_type: str) -> bool:
    """sago 하위폴더 이벤트 여부 (founds_created, founds_updated, founds_deleted 등)"""
    return bool(re.match(r"^.+_(created|updated|deleted)$", event_type))


class SagoAnalyzerModule(Module):
    """텍스트 분석 모듈 (LLM 기반)"""
    
    name = "M_SagoAnalyzer"
    description = "텍스트 분석 및 정책 대조 모듈"
    capabilities = ["EVT_FILE_CHANGE", "EVT_ANALYSIS_DONE", "LLM_PROMPT_RESPONSE", "founds_created", "founds_updated", "founds_deleted"]
    
    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root
        self.llm_api_url = os.getenv("LLM_API_URL", "http://localhost:11434/api/generate")
        self.llm_model = os.getenv("LLM_MODEL", "llama3")
    
    def can_handle(self, event: Event) -> float:
        """EVT_FILE_CHANGE, found 계열 이벤트, 또는 analysis_result용 LLM_PROMPT_RESPONSE 처리 가능 여부"""
        if event.type == "EVT_FILE_CHANGE":
            return 1.0
        if _is_found_event_type(event.type):
            return 1.0
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "analysis_result_update":
            return 1.0
        return 0.0
    
    def process(self, event: Event) -> List[Event]:
        """이벤트 처리: EVT_FILE_CHANGE → 분석 발행, found → LLM_PROMPT 발행, LLM_PROMPT_RESPONSE → analysis_result 기록"""
        if event.type == "EVT_FILE_CHANGE":
            return self._process_file_change(event)
        if _is_found_event_type(event.type):
            return self._process_found_event(event)
        if event.type == "LLM_PROMPT_RESPONSE" and (event.payload or {}).get("intent") == "analysis_result_update":
            return self._process_analysis_result_response(event)
        return []
    
    def _process_file_change(self, event: Event) -> List[Event]:
        """기존: 파일 변경 시 LLM 분석 후 EVT_ANALYSIS_DONE 발행"""
        payload = event.payload or {}
        file_path = payload.get("file_path")
        content = payload.get("content", "")
        vault_root = payload.get("watch_dir") or payload.get("vault_root") or self.vault_root
        hide_thinking = payload.get("hide_thinking_process", False)
        
        if not file_path or not content:
            print(f"[{self.name}] ⚠️  파일 경로 또는 내용이 없습니다")
            return []
        
        policy_content = self._read_policy_files(vault_root, hide_thinking)
        analysis_result = self._analyze_with_llm(content, policy_content)
        return [
            Event(
                type="EVT_ANALYSIS_DONE",
                payload={
                    "file_path": file_path,
                    "relative_path": payload.get("relative_path", ""),
                    "watch_dir": vault_root,
                    "analysis": analysis_result,
                    "policy_compliance": analysis_result.get("policy_compliance", {}),
                    "requires_notification": analysis_result.get("requires_notification", False),
                },
                source_module=self.name,
            )
        ]
    
    def _process_found_event(self, event: Event) -> List[Event]:
        """founds_created/updated/deleted 시 LLM_PROMPT 발행 → llm_prompt 모듈이 처리 후 LLM_PROMPT_RESPONSE로 응답"""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or self.vault_root
        relative_path = payload.get("relative_path", "")
        if not watch_dir or not relative_path:
            print(f"[{self.name}] ⚠️  watch_dir 또는 relative_path가 없습니다")
            return []
        
        # analysis 결과는 sago/analysis/ (또는 .sago/.analysis/)에 저장, 하위폴더별로 분리
        sago_folder = payload.get("sago_folder", "")
        use_hidden = relative_path.startswith(".sago")
        analysis_base = Path(".sago") / ".analysis" if use_hidden else Path("sago") / "analysis"
        analysis_dir = Path(watch_dir) / analysis_base
        # if sago_folder:
        #     analysis_dir = analysis_dir / sago_folder
        analysis_result_path = analysis_dir / "analysis_result.md"
        
        existing_content = ""
        if analysis_result_path.exists():
            try:
                existing_content = analysis_result_path.read_text(encoding="utf-8")
            except Exception as e:
                print(f"[{self.name}] ⚠️  기존 분석 파일 읽기 실패: {analysis_result_path}, {e}")
        
        event_kind = "created" if event.type.endswith("_created") else "updated" if event.type.endswith("_updated") else "deleted"
        event_desc = self._describe_found_event(event_kind, payload)
        policy_content = self._read_policy_files(watch_dir, False)
        prompt = self._build_analysis_update_prompt(existing_content, event_kind, event_desc, policy_content)
        
        # LLM_PROMPT 이벤트 발행 (llm_prompt 모듈이 처리 후 LLM_PROMPT_RESPONSE로 회신)
        self.publish(
            Event(
                type="LLM_PROMPT",
                payload={
                    "prompt": prompt,
                    "intent": "analysis_result_update",
                    "analysis_result_path": str(analysis_result_path),
                    "watch_dir": watch_dir,
                    "relative_path": relative_path,
                    "sago_folder": payload.get("sago_folder", ""),
                    "event_type": event.type,
                },
                source_module=self.name,
            )
        )
        return []
    
    def _process_analysis_result_response(self, event: Event) -> List[Event]:
        """LLM_PROMPT_RESPONSE 수신 시 (intent=analysis_result_update) 응답 파싱 후 analysis_result 파일 기록"""
        payload = event.payload or {}
        if not payload.get("success") or "response" not in payload:
            print(f"[{self.name}] ⚠️  LLM_PROMPT_RESPONSE 성공 응답이 없습니다")
            return []
        if payload.get("intent") != "analysis_result_update":
            return []
        
        response_text = payload.get("response", "")
        analysis_result_path = Path(payload.get("analysis_result_path", ""))
        watch_dir = payload.get("watch_dir", "")
        relative_path = payload.get("relative_path", "")
        if not analysis_result_path or not str(analysis_result_path).strip():
            return []
        
        write_path, analysis_body = self._parse_llm_analysis_response(response_text, analysis_result_path)
        if not write_path or analysis_body is None:
            print(f"[{self.name}] ⚠️  LLM 응답 파싱 실패 (OVERWRITE/NEW_FILE + 본문 필요)")
            return []
        
        # sago_writer를 통해 저장 (EVT_WRITE_REQUEST)
        rel_for_write = os.path.relpath(str(write_path), watch_dir) if watch_dir else str(Path(relative_path).parent / write_path.name) if relative_path else write_path.name
        self.publish(
            Event(
                type="EVT_WRITE_REQUEST",
                payload={
                    "watch_dir": watch_dir,
                    "relative_path": rel_for_write.replace("\\", "/"),
                    "content": analysis_body.strip() + "\n",
                    "intent": "analysis_result",
                    "source_file_path": str(write_path),
                },
                source_module=self.name,
            )
        )
        return [
            Event(
                type="EVT_ANALYSIS_DONE",
                payload={
                    "file_path": str(write_path),
                    "relative_path": str(Path(relative_path).parent / write_path.name) if relative_path else write_path.name,
                    "watch_dir": watch_dir,
                    "analysis_result_path": str(write_path),
                    "event_type": payload.get("event_type", ""),
                    "sago_folder": payload.get("sago_folder", ""),
                },
                source_module=self.name,
            )
        ]
    
    def _describe_found_event(self, event_kind: str, payload: Dict[str, Any]) -> str:
        """이벤트 설명 문자열 생성"""
        lines = [f"이벤트: 파일 {event_kind}"]
        lines.append(f"파일: {payload.get('filename', payload.get('file_path', ''))}")
        lines.append(f"상대 경로: {payload.get('relative_path', '')}")
        if event_kind != "deleted" and payload.get("content"):
            content = payload["content"]
            lines.append(f"내용 (일부):\n{content[:3000]}{'...' if len(content) > 3000 else ''}")
        elif event_kind == "deleted":
            lines.append("(삭제된 파일이므로 내용 없음)")
        return "\n".join(lines)
    
    def _build_analysis_update_prompt(
        self, existing_content: str, event_kind: str, event_desc: str, policy_content: Dict[str, str]
    ) -> str:
        """기존 분석 + 이벤트 반영 갱신용 프롬프트"""
        return f"""다음은 현재 analysis_result.md의 기존 내용입니다. 아래 이벤트가 발생했으므로, 기존 내용에 이 이벤트를 반영한 새 분석(analysis)을 작성하세요.

기존 분석 내용:
---
{existing_content if existing_content.strip() else "(없음)"}
---

{event_desc}

요구사항:
1. 첫 번째 줄에 반드시 OVERWRITE 또는 NEW_FILE 중 하나만 출력하세요.
   - OVERWRITE: 기존 analysis_result.md를 새 내용으로 덮어씁니다.
   - NEW_FILE: 같은 폴더에 새 파일(예: analysis_result_날짜시간.md)을 만듭니다. (이 경우 두 번째 줄에 파일명만 한 줄로 출력한 뒤, 그 다음 줄부터 본문을 출력하세요.)
2. 그 다음 줄부터는 분석 본문을 마크다운으로 작성하세요. (NEW_FILE인 경우 파일명 한 줄 다음부터 본문)

정책 참고 (선택):
{policy_content.get('master_policy', '')[:1500] or '없음'}

출력 형식 예시 (OVERWRITE):
OVERWRITE
(빈 줄)
# 분석 결과
...

출력 형식 예시 (NEW_FILE):
NEW_FILE
analysis_result_20250222_143000.md
(빈 줄)
# 분석 결과
...
"""
    
    def _parse_llm_analysis_response(self, response_text: str, default_path: Path) -> Tuple[Optional[Path], Optional[str]]:
        """첫 줄 OVERWRITE/NEW_FILE 파싱 후 쓰기 경로와 본문 반환. (write_path, body) 또는 (None, None)"""
        lines = [s for s in response_text.strip().split("\n") if s is not None]
        if not lines:
            return None, None
        first = lines[0].strip().upper()
        if first == "OVERWRITE":
            body = "\n".join(lines[1:]).strip()
            return default_path, body if body else None
        if first == "NEW_FILE" and len(lines) >= 2:
            filename = lines[1].strip()
            if not filename.endswith(".md"):
                filename += ".md"
            write_path = default_path.parent / filename
            body = "\n".join(lines[2:]).strip()
            return write_path, body if body else None
        return None, None
    
    def _read_policy_files(self, vault_root: str, hide_thinking: bool = False) -> Dict[str, str]:
        """정책 파일 읽기 (sago/policy/, sago/rule/ 또는 .sago/.policy/, .sago/.rule/)"""
        policy_content = {}
        
        if not vault_root:
            return policy_content
        
        vault_path = Path(vault_root)
        
        # sago/policy/ 또는 .sago/.policy/ 경로 결정
        sago_folder = ".sago" if hide_thinking else "sago"
        policy_folder = ".policy" if hide_thinking else "policy"
        rule_folder = ".rule" if hide_thinking else "rule"
        
        # sago/policy/master_policy.md 또는 .sago/.policy/master_policy.md
        policy_file = vault_path / sago_folder / policy_folder / "master_policy.md"
        if policy_file.exists():
            try:
                with open(policy_file, "r", encoding="utf-8") as f:
                    policy_content["master_policy"] = f.read()
            except Exception as e:
                print(f"[{self.name}] ⚠️  정책 파일 읽기 실패: {policy_file}, 오류: {e}")
        
        # sago/rule/inferred_patterns.md 또는 .sago/.rule/inferred_patterns.md
        rule_file = vault_path / sago_folder / rule_folder / "inferred_patterns.md"
        if rule_file.exists():
            try:
                with open(rule_file, "r", encoding="utf-8") as f:
                    policy_content["inferred_patterns"] = f.read()
            except Exception as e:
                print(f"[{self.name}] ⚠️  규칙 파일 읽기 실패: {rule_file}, 오류: {e}")
        
        return policy_content
    
    def _analyze_with_llm(self, content: str, policy_content: Dict[str, str]) -> Dict[str, Any]:
        """LLM을 통한 텍스트 분석"""
        # 실제 LLM 호출은 여기서 구현
        # 현재는 기본 구조만 제공
        
        # LLM 프롬프트 구성
        prompt = self._build_analysis_prompt(content, policy_content)
        
        # LLM 호출 (간단한 구현)
        try:
            analysis = self._call_llm(prompt)
        except Exception as e:
            print(f"[{self.name}] ⚠️  LLM 호출 실패: {e}")
            # 기본 분석 결과 반환
            analysis = self._default_analysis(content)
        
        return analysis
    
    def _build_analysis_prompt(self, content: str, policy_content: Dict[str, str]) -> str:
        """분석 프롬프트 구성"""
        prompt = f"""다음 텍스트를 분석하여 다음 정보를 JSON 형식으로 제공하세요:

1. 핵심 주제 (topic): 텍스트의 주요 주제
2. 요약 (summary): 텍스트의 간단한 요약
3. 액션 아이템 (action_items): 텍스트에서 추출한 실행 가능한 항목들 (리스트)
4. 감정 상태 (emotion): 텍스트에서 느껴지는 감정 상태
5. 정책 준수 여부 (policy_compliance): 아래 정책과 비교하여 준수 여부
6. 판단 보류 여부 (requires_notification): 사용자 확인이 필요한지 여부

정책:
{policy_content.get('master_policy', '정책 파일 없음')}

규칙:
{policy_content.get('inferred_patterns', '규칙 파일 없음')}

분석할 텍스트:
{content[:2000]}  # 최대 2000자

JSON 형식으로 응답하세요:
{{
  "topic": "...",
  "summary": "...",
  "action_items": ["...", "..."],
  "emotion": "...",
  "policy_compliance": {{
    "compliant": true/false,
    "violations": ["..."],
    "notes": "..."
  }},
  "requires_notification": true/false,
  "notification_reason": "..."
}}
"""
        return prompt
    
    def _call_llm(self, prompt: str) -> Dict[str, Any]:
        """LLM API 호출"""
        import requests
        
        # 간단한 LLM 호출 (Ollama 예시)
        try:
            response = requests.post(
                self.llm_api_url,
                json={
                    "model": self.llm_model,
                    "prompt": prompt,
                    "stream": False,
                },
                timeout=60
            )
            
            if response.status_code == 200:
                result = response.json()
                response_text = result.get("response", "")
                
                # JSON 파싱 시도
                try:
                    # JSON 부분만 추출
                    import re
                    json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
                    if json_match:
                        return json.loads(json_match.group())
                except:
                    pass
                
                # 파싱 실패 시 기본 구조 반환
                return {
                    "topic": "분석 중",
                    "summary": response_text[:200],
                    "action_items": [],
                    "emotion": "중립",
                    "policy_compliance": {
                        "compliant": True,
                        "violations": [],
                        "notes": ""
                    },
                    "requires_notification": False,
                    "notification_reason": ""
                }
        except Exception as e:
            print(f"[{self.name}] LLM 호출 오류: {e}")
            raise
        
        return self._default_analysis("")
    
    def _default_analysis(self, content: str) -> Dict[str, Any]:
        """기본 분석 결과 (LLM 실패 시)"""
        return {
            "topic": "미분류",
            "summary": content[:100] + "..." if len(content) > 100 else content,
            "action_items": [],
            "emotion": "중립",
            "policy_compliance": {
                "compliant": True,
                "violations": [],
                "notes": "LLM 분석 실패로 기본값 사용"
            },
            "requires_notification": False,
            "notification_reason": ""
        }
