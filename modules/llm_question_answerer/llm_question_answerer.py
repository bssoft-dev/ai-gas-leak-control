"""
M_LLM_QuestionAnswerer: 질문에 대한 답변 생성
E_QuestionDetected → LLM 답변 생성 → 보충 파일에 답변 추가 → E_QuestionAnswered
"""
import os
import re
import time
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Tuple

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

QUESTION_PATTERN = re.compile(r"(?:^>\s*!\[ask\]|^\[ask\])\s*(.+)$", re.MULTILINE | re.IGNORECASE)


def _read_file_safe(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _write_with_retry(path: str, content: str) -> Tuple[bool, Optional[str]]:
    """PermissionError 시 최대 3회, 1초 간격 재시도"""
    parent = Path(path).parent
    if parent and not parent.exists():
        parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(WRITE_RETRY_MAX):
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return True, None
        except PermissionError as e:
            if attempt < WRITE_RETRY_MAX - 1:
                time.sleep(WRITE_RETRY_INTERVAL)
            else:
                return False, str(e)
        except OSError as e:
            return False, str(e)
    return False, "write failed"


class LLMQuestionAnswererModule(Module):
    """질문에 대한 답변 생성 모듈"""

    name = "M_LLM_QuestionAnswerer"
    description = "LLM을 사용한 질문 답변 생성 모듈"
    capabilities = ["E_QuestionDetected"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type != "E_QuestionDetected":
            return 0.0
        payload = event.payload or {}
        if not payload.get("question"):
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_QuestionDetected":
            return []
        payload = event.payload or {}
        question = payload.get("question", "")
        supplement_path = payload.get("supplement_path", "")
        if not question or not supplement_path:
            return []

        # 보충 파일 내용 읽기
        supplement_content = _read_file_safe(supplement_path)
        if not supplement_content:
            return []

        # 이미 답변이 있는지 확인 (같은 질문에 대한 답변이 이미 있으면 스킵)
        if self._has_answer_for_question(supplement_content, question):
            return []

        # LLM으로 답변 생성
        answer = self._call_llm_answer(question, supplement_content)
        if not answer:
            return []

        # 보충 파일에 답변 추가
        updated_content = self._add_answer_to_file(supplement_content, question, answer)
        if not updated_content:
            return []

        ok, err = _write_with_retry(supplement_path, updated_content)
        if ok:
            return [
                Event(
                    type="E_QuestionAnswered",
                    payload={
                        **payload,
                        "answer": answer,
                        "supplement_path": supplement_path,
                    },
                    source_module=self.name,
                )
            ]
        return []

    def _call_llm_answer(self, question: str, supplement_context: str) -> str:
        """LLM으로 질문 답변 생성"""
        if not requests:
            return ""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 보충 정보를 바탕으로 사용자 질문에 답변하는 비서입니다."},
                {"role": "user", "content": f"보충 정보 내용:\n{supplement_context[:4000]}\n\n질문: {question}"},
            ],
            "temperature": 0.3,
            "max_tokens": 2000,
        }
        try:
            r = requests.post(self.api_url, json=payload, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data)
        except Exception as e:
            print(f"[{self.name}] LLM API 오류: {e}")
            return ""

    def _extract_content(self, data: dict) -> str:
        """LLM 응답에서 content 추출"""
        if "choices" in data and len(data["choices"]) > 0:
            c = data["choices"][0]
            if isinstance(c.get("message"), dict) and "content" in c["message"]:
                return c["message"]["content"]
            if "text" in c:
                return c["text"]
        if "message" in data:
            m = data["message"]
            return m if isinstance(m, str) else (m.get("content") or m.get("text") or "")
        return data.get("content") or data.get("text") or ""

    def _has_answer_for_question(self, content: str, question: str) -> bool:
        """이미 해당 질문에 대한 답변이 있는지 확인"""
        lines = content.split("\n")
        question_lower = question.lower().strip()
        
        for i, line in enumerate(lines):
            stripped = line.strip()
            match = QUESTION_PATTERN.match(stripped)
            if match:
                found_question = match.group(1).strip()
                if found_question.lower() == question_lower:
                    # 질문 라인 다음에 답변이 있는지 확인 (최대 10줄까지 확인)
                    for j in range(i + 1, min(i + 10, len(lines))):
                        next_line = lines[j].strip()
                        # 답변 표시가 있거나, 다음 질문이나 섹션이 나오면 중단
                        if "**답변:**" in next_line or "답변:" in next_line:
                            return True
                        if next_line.startswith("##") or next_line.startswith("#"):
                            break
                        if QUESTION_PATTERN.match(next_line):
                            break
        return False

    def _add_answer_to_file(self, content: str, question: str, answer: str) -> str:
        """보충 파일에 질문 아래에 답변 추가"""
        lines = content.split("\n")
        question_lower = question.lower().strip()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # 질문 라인 찾기
        for i, line in enumerate(lines):
            stripped = line.strip()
            match = QUESTION_PATTERN.match(stripped)
            if match:
                found_question = match.group(1).strip()
                if found_question.lower() == question_lower:
                    # 질문 라인 형태 확인 ([ask] 또는 > [!ask])
                    is_blockquote = stripped.startswith(">")
                    
                    # 이미 답변이 있는지 다시 확인 (이중 체크)
                    has_answer = False
                    for j in range(i + 1, min(i + 10, len(lines))):
                        next_line = lines[j].strip()
                        if "**답변:**" in next_line or "답변:" in next_line:
                            has_answer = True
                            break
                        if next_line.startswith("##") or next_line.startswith("#"):
                            break
                        if QUESTION_PATTERN.match(next_line):
                            break
                    
                    if has_answer:
                        # 이미 답변이 있으면 원본 반환
                        return content
                    
                    # 답변을 여러 줄로 분리
                    answer_lines_list = answer.split("\n")
                    
                    # 답변 추가
                    answer_lines = []
                    if is_blockquote:
                        # 블록 인용 형태
                        answer_lines.append("> **답변:**")
                        for ans_line in answer_lines_list:
                            if ans_line.strip():
                                answer_lines.append(f"> {ans_line}")
                            else:
                                answer_lines.append(">")
                        answer_lines.append(f"> *답변 생성 시간: {now}*")
                    else:
                        # 일반 형태
                        answer_lines.append("**답변:**")
                        for ans_line in answer_lines_list:
                            answer_lines.append(ans_line)
                        answer_lines.append(f"*답변 생성 시간: {now}*")
                    
                    # 질문 라인 다음에 답변 삽입 (빈 줄 하나 추가)
                    insert_pos = i + 1
                    # 질문 라인 다음이 빈 줄이면 그 다음에 삽입
                    if insert_pos < len(lines) and not lines[insert_pos].strip():
                        insert_pos += 1
                    
                    new_lines = lines[:insert_pos] + answer_lines + [""] + lines[insert_pos:]
                    return "\n".join(new_lines)
        
        # 질문을 찾지 못한 경우 원본 반환
        return content
