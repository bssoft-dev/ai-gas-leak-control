"""
M_SagoLinker: 파일 연결 모듈
- 현재 메모의 키워드와 Root 폴더 내 다른 파일들의 제목/태그 대조
- 유사도가 높은 상위 3~5개 파일 리스트 추출
- 연결 고리 정리하여 EVT_LINK_FOUND 이벤트 발생
"""
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class SagoLinkerModule(Module):
    """파일 연결 모듈 (키워드 기반)"""
    
    name = "M_SagoLinker"
    description = "관련 파일 찾기 및 연결 모듈"
    capabilities = ["EVT_FILE_CHANGE", "EVT_LINK_FOUND"]
    
    def __init__(self, vault_root: str = ""):
        super().__init__()
        self.vault_root = vault_root
        self.max_links = 5  # 최대 연결 파일 수
    
    def can_handle(self, event: Event) -> float:
        """EVT_FILE_CHANGE 이벤트 처리 가능 여부"""
        if event.type == "EVT_FILE_CHANGE":
            return 1.0
        return 0.0
    
    def process(self, event: Event) -> List[Event]:
        """이벤트 처리: 관련 파일 찾기"""
        if event.type != "EVT_FILE_CHANGE":
            return []
        
        payload = event.payload or {}
        file_path = payload.get("file_path")
        content = payload.get("content", "")
        vault_root = payload.get("watch_dir") or payload.get("vault_root") or self.vault_root
        
        if not file_path or not vault_root:
            print(f"[{self.name}] ⚠️  파일 경로 또는 vault_root가 없습니다")
            return []
        
        # 키워드 추출
        keywords = self._extract_keywords(content, file_path)
        
        # 관련 파일 찾기
        related_files = self._find_related_files(file_path, keywords, vault_root)
        
        # 연결 이벤트 생성
        return [
            Event(
                type="EVT_LINK_FOUND",
                payload={
                    "file_path": file_path,
                    "relative_path": payload.get("relative_path", ""),
                    "watch_dir": vault_root,
                    "keywords": keywords,
                    "related_files": related_files,
                },
                source_module=self.name,
            )
        ]
    
    def _extract_keywords(self, content: str, file_path: str) -> List[str]:
        """텍스트에서 키워드 추출"""
        keywords = []
        
        # 파일명에서 키워드 추출
        file_stem = Path(file_path).stem
        # 언더스코어, 하이픈, 공백으로 분리
        keywords.extend(re.split(r'[_\-\s]+', file_stem))
        
        # 태그 추출 (#태그 형식)
        tag_pattern = r'#([^\s#]+)'
        tags = re.findall(tag_pattern, content)
        keywords.extend(tags)
        
        # 링크 추출 ([[파일명]] 형식)
        link_pattern = r'\[\[([^\]]+)\]\]'
        links = re.findall(link_pattern, content)
        keywords.extend(links)
        
        # 제목 추출 (# 제목 형식)
        title_pattern = r'^#+\s+(.+)$'
        titles = re.findall(title_pattern, content, re.MULTILINE)
        keywords.extend(titles)
        
        # 중복 제거 및 정리
        keywords = [k.strip().lower() for k in keywords if k.strip()]
        keywords = list(set(keywords))
        
        return keywords[:20]  # 최대 20개
    
    def _find_related_files(self, current_file: str, keywords: List[str], vault_root: str) -> List[Dict[str, Any]]:
        """관련 파일 찾기"""
        if not keywords:
            return []
        
        vault_path = Path(vault_root)
        current_path = Path(current_file)
        
        # 모든 .md 파일 스캔
        all_files = []
        for md_file in vault_path.rglob("*.md"):
            # 숨김 폴더 제외
            if any(part.startswith(".") for part in md_file.parts):
                continue
            
            # 현재 파일 제외
            if md_file == current_path:
                continue
            
            # 유사도 계산
            score = self._calculate_similarity(md_file, keywords, vault_root)
            if score > 0:
                all_files.append({
                    "file_path": str(md_file),
                    "relative_path": str(md_file.relative_to(vault_path)),
                    "score": score,
                })
        
        # 점수 순으로 정렬
        all_files.sort(key=lambda x: x["score"], reverse=True)
        
        return all_files[:self.max_links]
    
    def _calculate_similarity(self, file_path: Path, keywords: List[str], vault_root: str) -> float:
        """파일과 키워드 간 유사도 계산"""
        score = 0.0
        
        # 파일명 유사도
        file_stem = file_path.stem.lower()
        for keyword in keywords:
            if keyword in file_stem:
                score += 2.0
            elif keyword in file_stem.replace("_", "").replace("-", ""):
                score += 1.0
        
        # 파일 내용 확인 (간단한 키워드 매칭)
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read().lower()
            
            # 키워드가 내용에 포함되어 있는지 확인
            for keyword in keywords:
                if keyword in content:
                    score += 1.0
            
            # 태그 매칭
            tag_pattern = r'#([^\s#]+)'
            file_tags = set(re.findall(tag_pattern, content))
            keyword_tags = set([k for k in keywords if k.startswith("#")])
            common_tags = file_tags.intersection(keyword_tags)
            score += len(common_tags) * 1.5
            
            # 링크 매칭
            link_pattern = r'\[\[([^\]]+)\]\]'
            file_links = set(re.findall(link_pattern, content))
            keyword_links = set([k for k in keywords])
            common_links = file_links.intersection(keyword_links)
            score += len(common_links) * 2.0
            
        except Exception as e:
            # 파일 읽기 실패 시 파일명만으로 점수 계산
            pass
        
        return score
