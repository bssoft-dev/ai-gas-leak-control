"""
M_ThinkingOS_Supplement: Obsidian 노트 모니터링 → 요청사항 추출 → LLM 보충 정보 생성
- E_FileCreated 수신 시 원본/보충 파일 구분 후 요청 추출·보충 생성 또는 반영/삭제/질문 처리
"""
import os
import re
import hashlib
import time
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    import requests
except ImportError:
    requests = None

# 환경변수
LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_URL = f"{LLM_API_BASE.rstrip('/')}/chat"

# 파일 쓰기 재시도 (명세 4.1)
WRITE_RETRY_MAX = 3
WRITE_RETRY_INTERVAL = 1.0

# 보충 정보 카테고리 (명세 3.2)
SUPPLEMENT_CATEGORIES = [
    "1. 인터넷 검색 추가정보",
    "2. 질문에 대한 답변",
    "3. 메모내용 정리",
    "4. 관련 개념 설명",
    "5. 예시 및 사례",
    "6. 참고 자료 및 링크",
    "7. 실용 팁 및 베스트 프랙티스",
    "8. 잠재적 문제점 및 해결방안",
    "9. 관련 도구 및 리소스",
    "10. 심화 학습 자료",
    "11. 비교 분석",
    "12. 구현 가이드",
    "13. 트러블슈팅",
    "14. 업데이트 및 최신 동향",
]

INDEX_FILENAME = "#보충파일목록.md"
SUPPLEMENT_PATTERN = re.compile(r"^(.+)-보충-(\d+)-([a-f0-9]{8})\.md$")
QUESTION_PATTERN = re.compile(r"(?:^>\s*!\[ask\]|^\[ask\])\s*(.+)$", re.MULTILINE | re.IGNORECASE)
CHECK_APPLY = re.compile(r"^-\s*\[x\]\s*\*\*반영\*\*", re.MULTILINE | re.IGNORECASE)
CHECK_DELETE = re.compile(r"^-\s*\[x\]\s*\*\*삭제\*\*", re.MULTILINE | re.IGNORECASE)


def _md5_8(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:8]


def _write_with_retry(path: str, content: str) -> Tuple[bool, Optional[str]]:
    """PermissionError 시 최대 3회, 1초 간격 재시도 (명세 4.1)"""
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


def _read_file_safe(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


class ThinkingOSSupplementModule(Module):
    """Obsidian 노트 → 요청사항 추출 → 보충 정보 생성 및 반영/삭제/질문 처리"""

    name = "M_ThinkingOS_Supplement"
    description = "Obsidian 노트 보충 정보 자동 생성 (요청 추출, 보충 생성, 반영/삭제, 질문-답변)"
    capabilities = ["E_FileCreated"]

    def __init__(
        self,
        target_folder: str = "",
        api_url: str = "",
        model: str = "",
        api_key: str = "",
    ):
        super().__init__()
        self.target_folder = (target_folder or os.path.expanduser("~/obsidian")).rstrip("/")
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        print(f"EVENT: {event} \n\n")
        print(f"EVENT TYPE: {event.type} \n\n")
        print(f"EVENT PAYLOAD: {event.payload} \n\n")
        print(f"EVENT PATH: {event.payload.get('path', '')} \n\n")
        print(f"EVENT CONTENT: {event.payload.get('content', '')} \n\n")
        print(f"EVENT FILENAME: {event.payload.get('filename', '')} \n\n")
        print(f"EVENT MESSAGE: {event.payload.get('message', '')} \n\n")
        print(f"EVENT TIMESTAMP: {event.payload.get('timestamp', '')} \n\n")
        print(f"EVENT SOURCE: {event.payload.get('source', '')} \n\n")
        print(f"EVENT SOURCE MODULE: {event.payload.get('source_module', '')} \n\n")
        print(f"EVENT SOURCE MODULE ID: {event.payload.get('source_module_id', '')} \n\n")
        print(f"EVENT SOURCE MODULE NAME: {event.payload.get('source_module_name', '')} \n\n")
        print(f"EVENT SOURCE MODULE VERSION: {event.payload.get('source_module_version', '')} \n\n")
        print(f"EVENT SOURCE MODULE DESCRIPTION: {event.payload.get('source_module_description', '')} \n\n")
        print(f"EVENT SOURCE MODULE CAPABILITIES: {event.payload.get('source_module_capabilities', '')} \n\n")
        print(f"EVENT SOURCE MODULE EVENTS: {event.payload.get('source_module_events', '')} \n\n")
        if event.type != "E_FileCreated":
            return 0.0
        path = (event.payload or {}).get("path", "")
        if not path or not path.endswith(".md"):
            return 0.0
        path_abs = os.path.abspath(path)
        target_abs = os.path.abspath(self.target_folder)
        if not path_abs.startswith(target_abs):
            return 0.0
        name = os.path.basename(path)
        if name.startswith("#") or name == INDEX_FILENAME:
            return 0.0
        return 0.9

    def process(self, event: Event) -> List[Event]:
        if event.type != "E_FileCreated":
            return []
        payload = event.payload or {}
        path = payload.get("path", "")
        content = payload.get("content", "") or _read_file_safe(path)
        if not path or not path.endswith(".md"):
            return []

        # 서비스 파이프라인에서 주입한 target_folder 우선 사용
        target_folder = payload.get("target_folder") or self.target_folder
        target_abs = os.path.abspath(os.path.expanduser(str(target_folder)))
        path_abs = os.path.abspath(path)
        if not path_abs.startswith(target_abs):
            return []

        filename = os.path.basename(path)
        if filename.startswith("#") or filename == INDEX_FILENAME:
            return []

        # 보충 정보 파일인지 확인 (원본파일명-보충-인덱스-해시.md) — 명세 7.1 무한 루프 방지
        match = SUPPLEMENT_PATTERN.match(filename)
        if match:
            return self._process_supplement_file(path_abs, content, filename, match, dir_abs=str(Path(path_abs).parent))
        # 원본 파일 → 요청 추출 및 보충 생성
        return self._process_original_file(path_abs, content, filename)

    def _process_original_file(self, path_abs: str, content: str, filename: str) -> List[Event]:
        """원본 .md → LLM 요청 추출 → 보충 정보 생성 → 파일 쓰기 및 목록 갱신"""
        stem = Path(filename).stem
        dir_abs = str(Path(path_abs).parent)
        supplement_dir = os.path.join(dir_abs, stem)
        requests_data = self._extract_requests(content, path_abs)
        if not requests_data:
            return []

        created_paths: List[Tuple[str, str]] = []  # (path, 요청 요약)
        for i, item in enumerate(requests_data, 1):
            req_text = item.get("request", "").strip()
            category = item.get("category", "").strip()
            supplement_body = item.get("supplement", "").strip()
            if not req_text or not supplement_body:
                continue
            short_hash = _md5_8(req_text)
            supp_filename = f"{stem}-보충-{i}-{short_hash}.md"
            supp_path = os.path.join(supplement_dir, supp_filename)
            supp_content = self._build_supplement_md(
                stem=stem,
                supplement_body=supplement_body,
                request_text=req_text,
                category=category,
                filename=filename,
            )
            ok, err = _write_with_retry(supp_path, supp_content)
            if ok:
                created_paths.append((supp_path, req_text[:50]))
            else:
                print(f"[{self.name}] 보충 파일 쓰기 실패: {supp_path} - {err}")

        if created_paths:
            self._update_index_file(supplement_dir, stem, created_paths, path_abs)
        return []

    def _process_supplement_file(
        self, path_abs: str, content: str, filename: str, match: re.Match, dir_abs: str = ""
    ) -> List[Event]:
        """보충 파일 → 반영/삭제 체크 또는 [ask] 질문 처리"""
        base_name = match.group(1)  # 원본 스템 (파일명에서 -보충- 앞 부분)
        dir_abs = dir_abs or str(Path(path_abs).parent)
        supplement_dir = dir_abs
        # 원본 파일: 보충이 원본파일명/ 폴더 안에 있으면 상위에 원본파일명.md
        parent_dir = Path(path_abs).parent.parent
        original_stem = Path(supplement_dir).name
        original_path = os.path.join(parent_dir, f"{original_stem}.md")
        if not os.path.isfile(original_path):
            original_path = os.path.join(dir_abs, f"{base_name}.md")
        if not os.path.isfile(original_path):
            original_path = os.path.join(parent_dir, f"{base_name}.md")

        # 반영 체크
        if CHECK_APPLY.search(content):
            self._apply_to_original(path_abs, content, original_path, original_stem)
            self._remove_from_index(supplement_dir, path_abs, filename)
            try:
                os.remove(path_abs)
            except OSError:
                pass
            return []
        # 삭제 체크
        if CHECK_DELETE.search(content):
            try:
                os.remove(path_abs)
            except OSError:
                pass
            self._remove_from_index(supplement_dir, path_abs, filename)
            return []

        # [ask] / > [!ask] 질문 처리
        questions = QUESTION_PATTERN.findall(content)
        if questions:
            for q in questions:
                q = q.strip()
                if not q:
                    continue
                answer = self._call_llm_answer(q, content)
                q_hash = _md5_8(q)
                q_filename = f"{Path(filename).stem}-질문-{q_hash}.md"
                q_path = os.path.join(dir_abs, q_filename)
                q_content = self._build_question_md(q, answer, filename, path_abs)
                _write_with_retry(q_path, q_content)
        return []

    def _extract_requests(self, content: str, file_path: str) -> List[Dict[str, str]]:
        """LLM으로 요청사항 추출 (요청사항 N / 카테고리 / 보충 정보 N 형식)."""
        if not requests:
            return []
        categories_str = "\n".join(SUPPLEMENT_CATEGORIES)
        prompt = f"""다음 메모 내용에서 사용자의 요청사항·질문을 추출하고, 각각에 대해 적절한 보충 정보를 생성해주세요.

메모 내용:
{content[:8000]}

보충 정보 카테고리 (해당하는 번호와 이름 사용):
{categories_str}

다음 형식으로만 답변해주세요 (다른 설명 없이):
요청사항 1: [사용자의 요청 또는 질문]
카테고리: [카테고리 번호 및 이름]
보충 정보 1: [상세한 보충 정보 내용]

요청사항 2: ...
카테고리: ...
보충 정보 2: ...
"""
        text = self._call_llm(prompt, file_path)
        if not text:
            return []
        return self._parse_extract_response(text)

    def _parse_extract_response(self, text: str) -> List[Dict[str, str]]:
        result = []
        current = {}
        in_supplement = False
        for line in text.split("\n"):
            stripped = line.strip()
            if re.match(r"^요청사항\s*\d+\s*:", stripped):
                if current and current.get("request"):
                    result.append(current)
                current = {"request": stripped.split(":", 1)[1].strip()}
                in_supplement = False
            elif re.match(r"^카테고리\s*:", stripped):
                current["category"] = stripped.split(":", 1)[1].strip()
                in_supplement = False
            elif re.match(r"^보충 정보\s*\d+\s*:", stripped):
                current["supplement"] = stripped.split(":", 1)[1].strip()
                in_supplement = True
            elif in_supplement and current:
                current["supplement"] = (current.get("supplement", "") + "\n" + line.rstrip()).strip()
        if current and current.get("request"):
            result.append(current)
        return result

    def _call_llm(self, user_content: str, context_path: str = "") -> str:
        if not requests:
            return ""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 메모 내용을 분석하고 요청사항을 추출하며 보충 정보를 작성하는 비서입니다. 지정된 형식으로만 답변하세요."},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.5,
            "max_tokens": 4000,
        }
        try:
            r = requests.post(self.api_url, json=payload, headers=headers, timeout=120)
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data)
        except Exception as e:
            print(f"[{self.name}] LLM API 오류: {e}")
            return ""

    def _call_llm_answer(self, question: str, supplement_context: str) -> str:
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

    def _call_llm_merge(self, original_content: str, supplement_content: str) -> str:
        """원본 메모 + 보충 정보 → footnote 형태로 통합 (명세 3.5)."""
        if not requests:
            return original_content
        prompt = f"""원본 메모와 보충 정보를 결합해주세요. 보충 정보는 footnote 형태로 추가해주세요.

규칙:
- 원본 메모의 내용을 유지하면서 보충 정보를 적절한 위치에 통합
- 보충 정보는 footnote 형태로 추가 (예: [^1], [^2])
- 파일 끝에 footnote 정의 추가 (예: [^1]: 보충 정보 내용)
- 기존 footnote가 있다면 번호를 이어서 사용
- 원본 메모의 구조와 형식을 최대한 유지

원본 메모:
{original_content[:6000]}

보충 정보:
{supplement_content[:3000]}

통합된 전체 메모 내용만 출력해주세요."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "당신은 원본 메모에 보충 정보를 footnote로 통합하는 비서입니다. 통합된 메모 전체만 출력하세요."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 4000,
        }
        try:
            r = requests.post(self.api_url, json=payload, headers=headers, timeout=90)
            r.raise_for_status()
            data = r.json()
            return self._extract_content(data) or original_content
        except Exception as e:
            print(f"[{self.name}] LLM Merge 오류: {e}")
            return original_content

    def _extract_content(self, data: dict) -> str:
        """명세 4.2: choices[0].message.content / message / content 또는 text"""
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

    def _build_supplement_md(
        self,
        stem: str,
        supplement_body: str,
        request_text: str,
        category: str,
        filename: str,
    ) -> str:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return f"""# 보충 정보

## 보충 정보 내용

{supplement_body}

---

## 보충 정보 처리

- [ ] **반영**: 원본 메모에 이 보충 정보를 결합합니다 (footnote 형태로 추가)
- [ ] **삭제**: 이 보충 정보 파일을 삭제합니다

---

## 추가 질문

이 보충 파일에 대해 추가 질문이 있으시면 아래와 같이 질문해주세요:

> [!ask] 여기에 질문을 작성하세요

또는

[ask] 여기에 질문을 작성하세요

---

## 원본 메모로 돌아가기

← [[{stem}]]

---

## 파일 정보

**원본 파일:** [[{stem}]]
**보충 대상:** {request_text[:200]}
**카테고리:** {category}
**생성 시간:** {now}
**모델:** {self.model}

---

*이 보충 정보는 ThinkingOS 시스템에 의해 자동 생성되었습니다.*
"""

    def _build_question_md(self, question: str, answer: str, supplement_filename: str, supplement_path: str) -> str:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        stem = Path(supplement_filename).stem
        return f"""# 질문 및 답변

## 질문

{question}

---

## 답변

{answer}

---

## 파일 정보

**보충 정보 파일:** [[{stem}]]
**생성 시간:** {now}
**모델:** {self.model}

---

## 보충 정보 파일로 돌아가기

← [[{stem}]]

---

*이 질문과 답변은 ThinkingOS 시스템에 의해 자동 생성되었습니다.*
"""

    def _apply_to_original(self, supplement_path: str, supplement_content: str, original_path: str, original_stem: str) -> None:
        """반영: 보충 내용을 원본에 footnote로 통합 후 원본 덮어쓰기."""
        # 보충 정보 내용만 추출 (## 보충 정보 내용 ~ ---)
        body_match = re.search(r"## 보충 정보 내용\s*\n(.*?)(?=\n---|\n## |\Z)", supplement_content, re.DOTALL)
        supplement_body = body_match.group(1).strip() if body_match else supplement_content[:2000]
        original_content = _read_file_safe(original_path)
        merged = self._call_llm_merge(original_content, supplement_body)
        if merged:
            _write_with_retry(original_path, merged)

    def _update_index_file(self, supplement_dir: str, original_stem: str, created_paths: List[Tuple[str, str]], original_path: str) -> None:
        """보충파일목록.md 생성/갱신 (명세 3.6)."""
        index_path = os.path.join(supplement_dir, INDEX_FILENAME)
        existing = _read_file_safe(index_path)
        new_names = {Path(p).stem for p, _ in created_paths}
        existing_items = []
        if existing and "- [[" in existing:
            for m in re.finditer(r"-\s*\[\[([^\]]+)\]\]\s*(-\s*[^\n]*)?", existing):
                name, rest = m.group(1), (m.group(2) or "").strip()
                if name not in new_names:
                    existing_items.append((name, rest))
        header = "# 보충 파일 목록\n\n## 보충 파일 목록\n"
        body_lines = []
        for name, rest in existing_items:
            body_lines.append(f"- [[{name}]] {rest}\n" if rest else f"- [[{name}]]\n")
        for supp_path, summary in created_paths:
            name = Path(supp_path).stem
            body_lines.append(f"- [[{name}]] - {summary}\n")
        footer = "\n---\n\n*이 목록은 ThinkingOS 시스템에 의해 자동 관리됩니다.*\n"
        content = header + "".join(body_lines) + footer
        _write_with_retry(index_path, content)

    def _remove_from_index(self, supplement_dir: str, removed_path: str, removed_filename: str) -> None:
        """보충파일목록.md에서 해당 항목 제거."""
        index_path = os.path.join(supplement_dir, INDEX_FILENAME)
        content = _read_file_safe(index_path)
        stem = Path(removed_filename).stem
        new_lines = []
        for line in content.split("\n"):
            if f"[[{stem}]]" in line or f"[[{Path(removed_filename).stem}]]" in line:
                continue
            new_lines.append(line)
        if new_lines != content.split("\n"):
            _write_with_retry(index_path, "\n".join(new_lines))
