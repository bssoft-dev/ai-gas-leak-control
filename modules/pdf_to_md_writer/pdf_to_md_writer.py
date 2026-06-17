"""
M_PdfToMdWriter: PDF 분석 결과를 동일 파일명의 .md로 저장
- EVT_PDF_ANALYZED 수신 시 analysis의 페이지 텍스트·표를 마크다운으로 조합하여
  PDF와 같은 디렉터리에 동일 stem의 .md 파일 생성
"""
from pathlib import Path
from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


def _csv_to_markdown_table(csv_data: str) -> str:
    """CSV 문자열을 마크다운 테이블로 변환"""
    if not (csv_data and csv_data.strip()):
        return ""
    lines = [ln.strip() for ln in csv_data.strip().split("\n") if ln.strip()]
    if not lines:
        return ""
    rows = [[_cell.strip() for _cell in line.split(",")] for line in lines]
    col_count = max(len(r) for r in rows) if rows else 0
    for r in rows:
        while len(r) < col_count:
            r.append("")
    md_lines = []
    for i, row in enumerate(rows):
        md_lines.append("| " + " | ".join(row) + " |")
        if i == 0:
            md_lines.append("|" + " --- |" * col_count)
    return "\n".join(md_lines)


def _analysis_to_markdown(analysis: Dict[str, Any]) -> str:
    """PDF 분석 결과(analysis)를 마크다운 문자열로 변환"""
    if not analysis.get("success"):
        return ""
    pages = analysis.get("pages") or []
    if not pages:
        return ""
    parts: List[str] = []
    for page in sorted(pages, key=lambda p: p.get("page_number", 0)):
        page_num = page.get("page_number", 0)
        text = (page.get("text") or "").strip()
        tables = page.get("tables") or []
        if text:
            parts.append(f"## 페이지 {page_num}\n\n{text}")
        for tbl in tables:
            csv_data = tbl.get("csv_data") or ""
            if csv_data:
                parts.append(f"\n### 표 (페이지 {page_num})\n\n{_csv_to_markdown_table(csv_data)}\n")
    return "\n\n".join(parts) if parts else ""


class PdfToMdWriterModule(Module):
    """EVT_PDF_ANALYZED 수신 시 PDF와 동일한 파일명의 .md 파일 생성"""

    name = "M_PdfToMdWriter"
    description = "PDF 분석 결과를 동일 파일명의 마크다운 파일로 저장"
    capabilities = ["EVT_PDF_ANALYZED", "EVT_PDF_MD_WRITTEN"]

    def can_handle(self, event: Event) -> float:
        if event.type != "EVT_PDF_ANALYZED":
            return 0.0
        payload = event.payload or {}
        if payload.get("success") and payload.get("analysis") and payload.get("file_path"):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "EVT_PDF_ANALYZED":
            return []

        payload = event.payload or {}
        file_path = payload.get("file_path")
        analysis = payload.get("analysis")
        if not file_path or not analysis:
            return []

        path = Path(file_path)
        if not path.suffix.lower() == ".pdf":
            return []
        md_path = path.with_suffix(".md")
        content = _analysis_to_markdown(analysis)
        if not content:
            print(f"[{self.name}] ⚠️  변환할 내용이 없습니다: {file_path}")
            return []

        try:
            md_path.parent.mkdir(parents=True, exist_ok=True)
            md_path.write_text(content, encoding="utf-8")
            print(f"[{self.name}] .md 생성 완료: {md_path}")
        except Exception as e:
            print(f"[{self.name}] ⚠️  .md 저장 실패: {md_path}, {e}")
            return []

        rel_path = payload.get("relative_path", "")
        if rel_path and rel_path.lower().endswith(".pdf"):
            rel_path = str(Path(rel_path).with_suffix(".md"))

        return [
            Event(
                type="EVT_PDF_MD_WRITTEN",
                payload={
                    "file_path": str(md_path),
                    "pdf_path": file_path,
                    "relative_path": rel_path or md_path.name,
                    "watch_dir": payload.get("watch_dir", ""),
                    "filename": md_path.name,
                    "stem": md_path.stem,
                },
                source_module=self.name,
            )
        ]
