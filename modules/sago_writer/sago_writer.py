"""
M_SagoWriter: 분석 결과 기록 모듈 (sago 내 모든 파일 저장 통합)
- EVT_WRITE_REQUEST: 지정 경로에 내용 저장 (요약, analysis_result 등)
- Analyzer와 Linker의 결과물을 취합하여 sago/service/note/ 내에 리포트 작성
- 판단 보류 요청 시 sago/notify/에 질문 파일 생성
- 파일 작성 완료 시 EVT_WRITE_COMPLETE 발행
"""
import os
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class SagoWriterModule(Module):
    """분석 결과 기록 모듈 (sago 폴더 내 파일 저장 일원화)"""
    
    name = "M_SagoWriter"
    description = "분석 결과 리포트 작성 모듈"
    capabilities = ["EVT_WRITE_REQUEST", "EVT_ANALYSIS_DONE", "EVT_LINK_FOUND", "EVT_WRITE_COMPLETE"]
    
    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root
        self.pending_analyses: Dict[str, Dict[str, Any]] = {}  # file_path -> analysis_data
        self.pending_links: Dict[str, Dict[str, Any]] = {}  # file_path -> link_data
    
    def can_handle(self, event: Event) -> float:
        """EVT_WRITE_REQUEST, EVT_ANALYSIS_DONE, EVT_LINK_FOUND 처리 가능 여부"""
        if event.type in ["EVT_WRITE_REQUEST", "EVT_ANALYSIS_DONE", "EVT_LINK_FOUND"]:
            return 1.0
        return 0.0
    
    def process(self, event: Event) -> List[Event]:
        """이벤트 처리: WRITE_REQUEST 즉시 저장, 분석/연결 결과는 취합 후 리포트 작성"""
        if event.type == "EVT_WRITE_REQUEST":
            return self._handle_write_request(event)
        payload = event.payload or {}
        file_path = payload.get("file_path")
        vault_root = payload.get("watch_dir") or payload.get("vault_root") or self.vault_root
        hide_thinking = payload.get("hide_thinking_process", False)
        
        if not file_path or not vault_root:
            return []
        
        if event.type == "EVT_ANALYSIS_DONE":
            self.pending_analyses[file_path] = payload
        if event.type == "EVT_LINK_FOUND":
            self.pending_links[file_path] = payload
        
        if file_path in self.pending_analyses and file_path in self.pending_links:
            return self._write_report(file_path, vault_root, hide_thinking)
        return []
    
    def _handle_write_request(self, event: Event) -> List[Event]:
        """EVT_WRITE_REQUEST: watch_dir + relative_path에 content 저장 후 EVT_WRITE_COMPLETE 발행"""
        payload = event.payload or {}
        watch_dir = payload.get("watch_dir") or payload.get("vault_root") or self.vault_root
        relative_path = payload.get("relative_path", "").lstrip("/")
        content = payload.get("content", "")
        if not watch_dir or not relative_path:
            print(f"[{self.name}] ⚠️  EVT_WRITE_REQUEST에 watch_dir/relative_path가 없습니다")
            return []
        full_path = Path(watch_dir) / relative_path
        try:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            if payload.get("method") and payload.get("method") == "append":
                with open(full_path, "a", encoding="utf-8") as f:
                    f.write(content)
            else:
                full_path.write_text(content, encoding="utf-8")
            print(f"[{self.name}] 파일 저장 완료: {full_path}")
        except PermissionError as e:
            print(f"[{self.name}] ⚠️  저장 실패(권한 없음): {full_path}, {e}")
            return []
        except Exception as e:
            print(f"[{self.name}] ⚠️  저장 실패: {full_path}, {e}")
            return []
        return [
            Event(
                type="EVT_WRITE_COMPLETE",
                payload={
                    "file_path": payload.get("source_file_path", str(full_path)),
                    "report_path": str(full_path),
                    "relative_path": relative_path,
                    "watch_dir": watch_dir,
                    "intent": payload.get("intent", ""),
                },
                source_module=self.name,
            )
        ]
    
    def _write_report(self, file_path: str, vault_root: str, hide_thinking: bool = False) -> List[Event]:
        """분석 리포트 작성"""
        analysis_data = self.pending_analyses.get(file_path, {})
        link_data = self.pending_links.get(file_path, {})
        
        vault_path = Path(vault_root)
        
        # sago/service/note/ 또는 .sago/.service/note/ 디렉토리 생성
        sago_folder = ".sago" if hide_thinking else "sago"
        service_folder = ".service" if hide_thinking else "service"
        service_note_dir = vault_path / sago_folder / service_folder / "note"
        service_note_dir.mkdir(parents=True, exist_ok=True)
        
        # 원본 파일명에서 리포트 파일명 생성
        original_path = Path(file_path)
        report_filename = f"{original_path.stem}.insight.md"
        report_path = service_note_dir / report_filename
        
        # 리포트 내용 생성
        report_content = self._build_report_content(analysis_data, link_data, file_path)
        
        # 리포트 파일 작성
        try:
            with open(report_path, "w", encoding="utf-8") as f:
                f.write(report_content)
            print(f"[{self.name}] 리포트 작성 완료: {report_path}")
        except Exception as e:
            print(f"[{self.name}] ⚠️  리포트 작성 실패: {report_path}, 오류: {e}")
            return []
        
        # 판단 보류 요청 확인
        analysis = analysis_data.get("analysis", {})
        if analysis.get("requires_notification", False):
            self._create_notification_file(vault_path, file_path, analysis, hide_thinking)
        
        # 정리
        self.pending_analyses.pop(file_path, None)
        self.pending_links.pop(file_path, None)
        
        # Git Engine에 신호 전송 (이벤트 발생)
        return [
            Event(
                type="EVT_WRITE_COMPLETE",
                payload={
                    "file_path": file_path,
                    "report_path": str(report_path),
                    "relative_path": str(report_path.relative_to(vault_path)),
                },
                source_module=self.name,
            )
        ]
    
    def _build_report_content(self, analysis_data: Dict[str, Any], link_data: Dict[str, Any], file_path: str) -> str:
        """리포트 내용 생성"""
        analysis = analysis_data.get("analysis", {})
        related_files = link_data.get("related_files", [])
        
        lines = []
        lines.append(f"# 분석 리포트: {Path(file_path).name}")
        lines.append("")
        lines.append(f"**생성 시간**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append(f"**원본 파일**: `{file_path}`")
        lines.append("")
        
        # 분석 결과
        lines.append("## 분석 결과")
        lines.append("")
        lines.append(f"**핵심 주제**: {analysis.get('topic', 'N/A')}")
        lines.append("")
        lines.append(f"**요약**: {analysis.get('summary', 'N/A')}")
        lines.append("")
        
        # 액션 아이템
        action_items = analysis.get("action_items", [])
        if action_items:
            lines.append("### 액션 아이템")
            lines.append("")
            for item in action_items:
                lines.append(f"- [ ] {item}")
            lines.append("")
        
        # 감정 상태
        lines.append(f"**감정 상태**: {analysis.get('emotion', 'N/A')}")
        lines.append("")
        
        # 정책 준수 여부
        policy_compliance = analysis.get("policy_compliance", {})
        lines.append("## 정책 준수 여부")
        lines.append("")
        compliant = policy_compliance.get("compliant", True)
        lines.append(f"**상태**: {'✅ 준수' if compliant else '⚠️ 위반'}")
        lines.append("")
        
        violations = policy_compliance.get("violations", [])
        if violations:
            lines.append("### 위반 사항")
            lines.append("")
            for violation in violations:
                lines.append(f"- {violation}")
            lines.append("")
        
        notes = policy_compliance.get("notes", "")
        if notes:
            lines.append(f"**참고사항**: {notes}")
            lines.append("")
        
        # 관련 파일
        if related_files:
            lines.append("## 관련 파일")
            lines.append("")
            for i, rel_file in enumerate(related_files, 1):
                rel_path = rel_file.get("relative_path", "")
                score = rel_file.get("score", 0)
                lines.append(f"{i}. [[{Path(rel_path).stem}]] (유사도: {score:.1f})")
            lines.append("")
        
        return "\n".join(lines)
    
    def _create_notification_file(self, vault_path: Path, file_path: str, analysis: Dict[str, Any], hide_thinking: bool = False):
        """판단 보류 질문 파일 생성"""
        sago_folder = ".sago" if hide_thinking else "sago"
        notify_folder = ".notify" if hide_thinking else "notify"
        notify_dir = vault_path / sago_folder / notify_folder
        notify_dir.mkdir(parents=True, exist_ok=True)
        
        # 질문 파일명 생성 (q_YYMMDD_NNN.md 형식)
        today = datetime.now().strftime("%y%m%d")
        existing_files = list(notify_dir.glob(f"q_{today}_*.md"))
        next_num = len(existing_files) + 1
        question_filename = f"q_{today}_{next_num:03d}.md"
        question_path = notify_dir / question_filename
        
        # 질문 내용 생성
        question_content = f"""# 질문: {Path(file_path).name}

**원본 파일**: `{file_path}`
**생성 시간**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 확인 사항

{analysis.get('notification_reason', '사용자 확인이 필요합니다.')}

## 분석 결과 요약

- **주제**: {analysis.get('topic', 'N/A')}
- **요약**: {analysis.get('summary', 'N/A')}

## 정책 위반 사항

{chr(10).join(['- ' + v for v in analysis.get('policy_compliance', {}).get('violations', [])]) if analysis.get('policy_compliance', {}).get('violations') else '없음'}

## 답변

답변을 작성하세요:
"""
        
        try:
            with open(question_path, "w", encoding="utf-8") as f:
                f.write(question_content)
            print(f"[{self.name}] 질문 파일 생성: {question_path}")
        except Exception as e:
            print(f"[{self.name}] ⚠️  질문 파일 생성 실패: {question_path}, 오류: {e}")
