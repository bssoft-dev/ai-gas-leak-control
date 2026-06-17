"""
M_SupplementFileManager: 보충 파일 생성/삭제 관리 (재시도 로직 포함)
E_RequestExtracted → 보충 파일 생성 → E_SupplementFileCreated
E_SupplementDeleteRequest → 보충 파일 삭제 → E_SupplementFileDeleted
"""
import os
import hashlib
import time
from pathlib import Path
from datetime import datetime
from typing import List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module

WRITE_RETRY_MAX = 3
WRITE_RETRY_INTERVAL = 1.0


def _md5_8(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:8]


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


class SupplementFileManagerModule(Module):
    """보충 파일 생성/삭제 관리 (재시도 로직 포함)"""

    name = "M_SupplementFileManager"
    description = "보충 파일 생성 및 삭제 관리 모듈"
    capabilities = ["E_RequestExtracted", "E_SupplementDeleteRequest"]

    def __init__(self, model: str = ""):
        super().__init__()
        self.model = model or os.getenv("LLM_MODEL", "openai/gpt-oss-120b")

    def can_handle(self, event: Event) -> float:
        if event.type == "E_RequestExtracted":
            return 0.9
        if event.type == "E_SupplementDeleteRequest":
            return 0.9
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "E_RequestExtracted":
            return self._handle_request_extracted(event)
        if event.type == "E_SupplementDeleteRequest":
            return self._handle_delete_request(event)
        return []

    def _handle_request_extracted(self, event: Event) -> List[Event]:
        """요청 추출 이벤트 처리 → 보충 파일 생성"""
        payload = event.payload or {}
        requests = payload.get("requests", [])
        path = payload.get("path", "")
        if not requests or not path:
            return []

        stem = Path(path).stem
        dir_abs = str(Path(path).parent)
        supplement_dir = os.path.join(dir_abs, stem)

        created_files = []
        for i, item in enumerate(requests, 1):
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
                filename=os.path.basename(path),
            )
            ok, err = _write_with_retry(supp_path, supp_content)
            if ok:
                created_files.append({
                    "path": supp_path,
                    "filename": supp_filename,
                    "request_summary": req_text[:50],
                    "index": i,
                })
            else:
                print(f"[{self.name}] 보충 파일 쓰기 실패: {supp_path} - {err}")

        if created_files:
            return [
                Event(
                    type="E_SupplementFileCreated",
                    payload={
                        **payload,
                        "created_files": created_files,
                        "supplement_dir": supplement_dir,
                    },
                    source_module=self.name,
                )
            ]
        return []

    def _handle_delete_request(self, event: Event) -> List[Event]:
        """보충 파일 삭제 요청 처리"""
        payload = event.payload or {}
        supplement_path = payload.get("supplement_path", "")
        supplement_dir = payload.get("supplement_dir", "")
        if not supplement_path:
            return []

        if not supplement_dir:
            supplement_dir = str(Path(supplement_path).parent)

        try:
            if os.path.exists(supplement_path):
                os.remove(supplement_path)
                return [
                    Event(
                        type="E_SupplementFileDeleted",
                        payload={
                            **payload,
                            "deleted_path": supplement_path,
                            "supplement_dir": supplement_dir,
                        },
                        source_module=self.name,
                    )
                ]
        except OSError as e:
            print(f"[{self.name}] 보충 파일 삭제 실패: {supplement_path} - {e}")
        return []

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
