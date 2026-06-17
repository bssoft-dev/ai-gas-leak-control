"""
Sa-Yu Local API: Obsidian 볼트 경로, 인덱싱, 하이브리드 검색, 의도 힌트, 파일 I/O.
"""
from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vault_index import VaultIndex, _expand_path

DEFAULT_VAULT = "~/obsidian"
INDEX_DIR_ENV = "SAYU_INDEX_DIR"
WATCH = os.getenv("SAYU_FILE_WATCH", "1").strip() not in ("0", "false", "no")

app = FastAPI(title="Sa-Yu Local API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_vault_path: Path = _expand_path(os.getenv("OBSIDIAN_VAULT_PATH", DEFAULT_VAULT))
_index = VaultIndex(_vault_path)
_watch_thread: Optional[threading.Thread] = None
_watch_stop = threading.Event()


def get_vault() -> Path:
    return _expand_path(os.getenv("OBSIDIAN_VAULT_PATH", DEFAULT_VAULT))


def init_index() -> None:
    global _index, _vault_path
    _vault_path = get_vault()
    _index = VaultIndex(_vault_path)
    _index.scan_all()


def _watch_loop() -> None:
    try:
        from watchfiles import watch, Change
    except ImportError:
        return
    v = get_vault()
    if not v.is_dir():
        return
    vroot = v.resolve()
    try:
        for changes in watch(v, step=500, debounce=800):
            for ch, path in changes:
                p = Path(str(path))
                try:
                    r = p.resolve()
                    if vroot in r.parents or r == vroot:
                        rel = str(r.relative_to(vroot)).replace("\\", "/")
                    else:
                        continue
                except ValueError:
                    continue
                if ch == Change.deleted or not p.exists():
                    _index.apply_fs_change(rel, "deleted")
                    continue
                if not str(rel).endswith(".md"):
                    continue
                k = "modified" if ch == Change.modified else "added"
                _index.apply_fs_change(rel, k)
    except Exception:
        return


def start_watcher() -> None:
    global _watch_thread
    if not WATCH or _watch_thread is not None:
        return
    t = threading.Thread(target=_watch_loop, name="sayu-watch", daemon=True)
    _watch_thread = t
    t.start()


class FileWrite(BaseModel):
    path: str
    content: str


def parse_intent(q: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"query": q}
    qm = re.search(r"[\"'「]([^\"'」]+)[\"'」]", q)
    if qm:
        out["file_hint"] = qm.group(1)
    m = re.search(
        r"(?:에서|에(?:서)?|노트)\s*([^\s.#]+\.md|[\S]+기획서|[\S]+서)",
        q,
    )
    if m:
        out["target_hint"] = m.group(1)
    m2 = re.search(
        r"(?:#|섹션|챕터)\s*[:：]?\s*([^\n.?!]+)", q, re.IGNORECASE
    )
    if m2:
        out["section_hint"] = m2.group(1).strip()
    return out


@app.on_event("startup")
def startup() -> None:
    init_index()
    start_watcher()


@app.get("/api/sayu/health")
def health() -> Dict[str, str]:
    return {"ok": "true"}


@app.get("/api/sayu/config")
def config() -> Dict[str, Any]:
    i = _index.snapshot()
    return {
        "vault_path": str(get_vault()),
        "index": i,
        "index_dir": os.path.expanduser(os.getenv(INDEX_DIR_ENV) or "~/.cache/sayu-sagohub"),
        "watch_enabled": WATCH,
    }


@app.get("/api/sayu/tree")
def tree() -> Dict[str, List[str]]:
    return {"files": _index.list_md_files()}


@app.get("/api/sayu/file")
def get_file(path: str = Query(..., description="볼트 기준 상대 경로")) -> Dict[str, str]:
    t = _index.get_file(path)
    if t is None:
        raise HTTPException(404, "file not found or outside vault")
    return {"path": path, "content": t}


@app.put("/api/sayu/file")
def put_file(body: FileWrite) -> Dict[str, str]:
    p = (get_vault() / body.path).resolve()
    v = get_vault().resolve()
    if v not in p.parents and p != v:
        raise HTTPException(400, "path outside vault")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body.content, encoding="utf-8")
    _index.apply_fs_change(body.path.replace("\\", "/"), "modified")
    return {"ok": "true"}


@app.get("/api/sayu/search")
def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
) -> Dict[str, Any]:
    hits = _index.search(q, limit=limit)
    return {"query": q, "hits": hits}


@app.get("/api/sayu/intent")
def intent(q: str = Query(..., min_length=1)) -> Dict[str, Any]:
    return parse_intent(q)


@app.post("/api/sayu/reindex")
def reindex() -> Dict[str, Any]:
    _index.scan_all()
    return _index.snapshot()
