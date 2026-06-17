"""
로컬 옵시디언 볼트 인덱스: 프론트매터, 위키링크, 섹션 청크, 하이브리드(키워드) 검색.
벡터/Chroma는 선택 확장용 훅만 둡니다.
"""
from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

try:
    import yaml
except ImportError:
    yaml = None

WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
FRONTMATTER_RE = re.compile(r"\A---\s*\r?\n(.*?)\r?\n---\s*\r?\n", re.DOTALL)


def _expand_path(p: str) -> Path:
    return Path(os.path.expanduser(p)).resolve()


def _tokenize(q: str) -> List[str]:
    s = re.sub(r"[^\w\uac00-\ud7a3#]+", " ", q.lower())
    return [t for t in s.split() if len(t) > 1]


@dataclass
class ChunkRecord:
    path: str
    section: str
    text: str
    tags: Tuple[str, ...] = ()
    aliases: Tuple[str, ...] = ()


@dataclass
class FileRecord:
    path: str
    rel: str
    frontmatter: Dict[str, Any]
    wikilinks: List[str]
    edges: List[Tuple[str, str]]  # (from_title, to_title)
    chunks: List[ChunkRecord]


class VaultIndex:
    def __init__(self, vault: Path) -> None:
        self.vault = vault
        self._lock = threading.RLock()
        self._files: Dict[str, FileRecord] = {}
        self._chunk_list: List[ChunkRecord] = []
        self._df: Dict[str, int] = defaultdict(int)
        self._N = 0
        self.status = "idle"
        self.last_error: str = ""
        self._mtime = 0.0

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "status": self.status,
                "file_count": len(self._files),
                "chunk_count": len(self._chunk_list),
                "vault": str(self.vault),
            }

    def clear(self) -> None:
        with self._lock:
            self._files.clear()
            self._chunk_list.clear()
            self._df.clear()
            self._N = 0

    def scan_all(self) -> None:
        self.status = "indexing"
        self.last_error = ""
        try:
            if not self.vault.is_dir():
                self.clear()
                self.status = "error"
                self.last_error = f"vault not a directory: {self.vault}"
                return
            new_files: Dict[str, FileRecord] = {}
            new_chunks: List[ChunkRecord] = []
            for md in sorted(self.vault.rglob("*.md")):
                if not md.is_file():
                    continue
                rel = str(md.relative_to(self.vault)).replace("\\", "/")
                fr = self._parse_file(md, rel)
                new_files[rel] = fr
                new_chunks.extend(fr.chunks)
            with self._lock:
                self._files = new_files
                self._chunk_list = new_chunks
                self._rebuild_idf()
            self.status = "ready"
            self._mtime = time.time()
        except Exception as e:  # noqa: BLE001
            self.status = "error"
            self.last_error = str(e)

    def _rebuild_idf(self) -> None:
        self._df.clear()
        self._N = len(self._chunk_list)
        for ch in self._chunk_list:
            seen: Set[str] = set()
            for t in _tokenize(ch.text + " " + " ".join(ch.tags)):
                if t not in seen:
                    seen.add(t)
                    self._df[t] += 1

    def _parse_file(self, path: Path, rel: str) -> FileRecord:
        raw = path.read_text(encoding="utf-8", errors="replace")
        fm: Dict[str, Any] = {}
        body = raw
        m = FRONTMATTER_RE.match(raw)
        if m and yaml:
            try:
                fm = yaml.safe_load(m.group(1)) or {}
            except Exception:
                fm = {}
            body = raw[m.end() :]
        elif m and not yaml:
            body = raw[m.end() :]

        tags: List[str] = []
        if isinstance(fm.get("tags"), list):
            tags = [str(x) for x in fm["tags"]]
        elif isinstance(fm.get("tags"), str):
            tags = [fm["tags"]]
        aliases: List[str] = []
        if isinstance(fm.get("aliases"), list):
            aliases = [str(x) for x in fm["aliases"]]
        elif isinstance(fm.get("alias"), str):
            aliases = [fm["alias"]]

        wikilinks = WIKILINK_RE.findall(body)
        edges: List[Tuple[str, str]] = []
        title = path.stem
        for w in wikilinks:
            target = w.split("|")[0].split("#")[0].strip()
            if target:
                edges.append((title, target))

        chunks = self._split_sections(rel, body, tags, aliases)
        return FileRecord(
            path=str(path),
            rel=rel,
            frontmatter=fm,
            wikilinks=wikilinks,
            edges=edges,
            chunks=chunks,
        )

    def _split_sections(
        self,
        rel: str,
        body: str,
        tags: List[str],
        aliases: List[str],
    ) -> List[ChunkRecord]:
        parts: List[Tuple[str, str]] = []
        lines = body.splitlines()
        current_title = os.path.splitext(os.path.basename(rel))[0]
        buf: List[str] = []
        for line in lines:
            hm = re.match(r"^(#{1,3})\s+(.+?)\s*$", line)
            if hm:
                if buf:
                    parts.append((current_title, "\n".join(buf)))
                current_title = hm.group(2).strip()
                buf = []
            else:
                buf.append(line)
        if buf or not parts:
            parts.append((current_title, "\n".join(buf)))

        out: List[ChunkRecord] = []
        ttags = tuple(tags)
        aaliases = tuple(aliases)
        for title, text in parts:
            text = (text or "").strip()
            if len(text) < 8 and not parts:
                continue
            if not text:
                continue
            out.append(
                ChunkRecord(
                    path=rel,
                    section=title,
                    text=text[:50000],
                    tags=ttags,
                    aliases=aaliases,
                )
            )
        if not out:
            out.append(
                ChunkRecord(
                    path=rel,
                    section=current_title,
                    text=body[:50000],
                    tags=ttags,
                    aliases=aaliases,
                )
            )
        return out

    def search(self, q: str, limit: int = 20) -> List[Dict[str, Any]]:
        tokens = _tokenize(q)
        with self._lock:
            if not self._chunk_list or not tokens:
                return self._search_filename(q, limit)
            scores: List[Tuple[float, ChunkRecord, str]] = []
            for ch in self._chunk_list:
                filename = ch.path.rsplit("/", 1)[-1]
                s_kw = self._score_chunk_keywords(ch, q, tokens, filename)
                s_vec = 0.0
                s = 0.65 * s_kw + 0.35 * s_vec
                if s <= 0:
                    continue
                cite = f"[[{filename}#{ch.section}]]"
                scores.append((s, ch, cite))
            scores.sort(key=lambda x: -x[0])
            out: List[Dict[str, Any]] = []
            for s, ch, cite in scores[:limit]:
                snip = ch.text[:600].replace("\n", " ")
                out.append(
                    {
                        "path": ch.path,
                        "section": ch.section,
                        "snippet": snip,
                        "score": round(s, 4),
                        "citation": cite,
                    }
                )
            if not out:
                return self._search_filename(q, limit)
            return out

    def _search_filename(self, q: str, limit: int) -> List[Dict[str, Any]]:
        ql = q.lower()
        with self._lock:
            hit: List[Dict[str, Any]] = []
            for rel, fr in self._files.items():
                base = rel.rsplit("/", 1)[-1]
                if ql in base.lower() or any(ql in t.lower() for t in fr.frontmatter.get("tags", [])):
                    c0 = fr.chunks[0] if fr.chunks else None
                    snip = (c0.text[:600] if c0 else "") if c0 else ""
                    sec = c0.section if c0 else base
                    hit.append(
                        {
                            "path": rel,
                            "section": sec,
                            "snippet": snip,
                            "score": 0.1,
                            "citation": f"[[{base}#{sec}]]",
                        }
                    )
            return hit[:limit]

    def _score_chunk_keywords(
        self, ch: ChunkRecord, qraw: str, tokens: List[str], filename: str
    ) -> float:
        blob = f"{ch.text} {ch.section} {filename} " + " ".join(ch.tags)
        blob_l = blob.lower()
        fl = qraw.lower() in filename.lower()
        score = 3.0 if fl else 0.0
        for t in tokens:
            if t.startswith("#") and t[1:].isalnum():
                if t in " ".join(ch.tags).lower() or t in blob_l:
                    score += 2.0
        for t in tokens:
            if t in blob_l:
                n = blob_l.count(t)
                idf = math.log(1.0 + (self._N / (1.0 + self._df.get(t, 0))))
                score += (1.0 + math.log(n)) * idf
        return float(score)

    def get_file(self, rel: str) -> Optional[str]:
        rel = rel.strip().replace("\\", "/").lstrip("/")
        root = self.vault.resolve()
        p = (self.vault / rel).resolve()
        if root not in p.parents and p != root:
            return None
        if not p.is_file():
            return None
        return p.read_text(encoding="utf-8", errors="replace")

    def list_md_files(self) -> List[str]:
        if not self.vault.is_dir():
            return []
        return sorted(
            str(f.relative_to(self.vault)).replace("\\", "/")
            for f in self.vault.rglob("*.md")
            if f.is_file()
        )

    def apply_fs_change(self, rel: str, kind: str) -> None:
        """감시 콜백: 한 파일만 재분석 (가벼운 갱신)."""
        v = self.vault
        vroot = v.resolve()
        rel = rel.replace("\\", "/")
        p = (v / rel).resolve()
        try:
            p.relative_to(vroot)
        except ValueError:
            return
        if not str(rel).endswith(".md"):
            if rel in self._files:
                self.scan_all()
            return
        if kind == "deleted" or not p.is_file():
            with self._lock:
                if rel in self._files:
                    del self._files[rel]
                self._chunk_list = [c for c in self._chunk_list if c.path != rel]
                self._rebuild_idf()
            self.status = "ready"
            return
        self.status = "indexing"
        try:
            fr = self._parse_file(p, rel)
            with self._lock:
                new_chunks = [c for c in self._chunk_list if c.path != rel] + list(fr.chunks)
                self._files[rel] = fr
                self._chunk_list = new_chunks
                self._rebuild_idf()
            self.status = "ready"
        except Exception as e:  # noqa: BLE001
            self.status = "error"
            self.last_error = str(e)
