"""
M_SayLocalAPI: SAY_LOCAL_API_REQUEST → SAY_LOCAL_API_RESPONSE
document-writer의 로컬 볼트 API 기능을 메시지 허브 이벤트로 노출한다.
"""
from __future__ import annotations

import os
import re
import sys
import threading
import importlib.util
from pathlib import Path
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

_project_root = Path(__file__).resolve().parent.parent.parent
_local_api_dir = _project_root / "services" / "document-writer" / "local_api"
_vault_index_path = _local_api_dir / "vault_index.py"

if not _vault_index_path.is_file():
    raise RuntimeError(f"vault_index.py not found: {_vault_index_path}")

_spec = importlib.util.spec_from_file_location("say_local_api_vault_index", str(_vault_index_path))
if _spec is None or _spec.loader is None:
    raise RuntimeError(f"failed to load spec for vault_index: {_vault_index_path}")

_vault_index_mod = importlib.util.module_from_spec(_spec)
# dataclass 내부 타입 해석에서 sys.modules[__module__] 접근이 필요하다.
sys.modules[_spec.name] = _vault_index_mod
_spec.loader.exec_module(_vault_index_mod)

VaultIndex = _vault_index_mod.VaultIndex
_expand_path = _vault_index_mod._expand_path

DEFAULT_VAULT = "~/obsidian"
INDEX_DIR_ENV = "SAYU_INDEX_DIR"
WATCH = os.getenv("SAYU_FILE_WATCH", "1").strip().lower() not in ("0", "false", "no")


class SayLocalAPIModule(Module):
    name = "M_SayLocalAPI"
    description = "문서 로컬 API를 이벤트 허브로 연결"
    capabilities = ["SAY_LOCAL_API_REQUEST"]

    def __init__(self) -> None:
        super().__init__()
        self._vault_path: Path = self._get_vault()
        self._index = VaultIndex(self._vault_path)
        self._watch_thread: Optional[threading.Thread] = None
        self._watch_stop = threading.Event()
        self._init_index()
        self._start_watcher()

    def can_handle(self, event: Event) -> float:
        if event.type == "SAY_LOCAL_API_REQUEST":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "SAY_LOCAL_API_REQUEST":
            return []
        p = event.payload or {}
        request_id = p.get("request_id") or p.get("requestId")
        action = (p.get("action") or "").strip()
        try:
            if action == "health":
                data = {"ok": "true"}
            elif action == "config":
                data = self._config_data()
            elif action == "tree":
                data = {"files": self._index.list_md_files()}
            elif action == "get_file":
                path = p.get("path")
                if not isinstance(path, str) or not path.strip():
                    raise ValueError("path is required")
                text = self._index.get_file(path)
                if text is None:
                    raise FileNotFoundError("file not found or outside vault")
                data = {"path": path, "content": text}
            elif action == "put_file":
                path = p.get("path")
                content = p.get("content")
                if not isinstance(path, str) or not path.strip():
                    raise ValueError("path is required")
                if not isinstance(content, str):
                    raise ValueError("content must be string")
                self._put_file(path, content)
                data = {"ok": "true"}
            elif action == "search":
                q = p.get("q")
                limit = p.get("limit", 20)
                if not isinstance(q, str) or not q.strip():
                    raise ValueError("q is required")
                if not isinstance(limit, int):
                    limit = int(limit)
                limit = max(1, min(100, limit))
                data = {"query": q, "hits": self._index.search(q, limit=limit)}
            elif action == "intent":
                q = p.get("q")
                if not isinstance(q, str) or not q.strip():
                    raise ValueError("q is required")
                data = self._parse_intent(q)
            elif action == "reindex":
                self._index.scan_all()
                data = self._index.snapshot()
            else:
                raise ValueError(f"unsupported action: {action}")
            return [self._response(request_id, True, data=data)]
        except FileNotFoundError as e:
            return [self._response(request_id, False, error=str(e), code=404)]
        except ValueError as e:
            return [self._response(request_id, False, error=str(e), code=400)]
        except Exception as e:
            return [self._response(request_id, False, error=str(e), code=500)]

    def _response(
        self,
        request_id: Any,
        success: bool,
        *,
        data: Optional[Dict[str, Any]] = None,
        error: str = "",
        code: int = 200,
    ) -> Event:
        return Event(
            type="SAY_LOCAL_API_RESPONSE",
            payload={
                "request_id": request_id,
                "success": success,
                "code": code,
                "data": data or {},
                "error": error,
            },
            source_module=self.name,
        )

    def _get_vault(self) -> Path:
        return _expand_path(os.getenv("OBSIDIAN_VAULT_PATH", DEFAULT_VAULT))

    def _init_index(self) -> None:
        self._vault_path = self._get_vault()
        self._index = VaultIndex(self._vault_path)
        self._index.scan_all()

    def _watch_loop(self) -> None:
        try:
            from watchfiles import Change, watch
        except ImportError:
            return
        v = self._get_vault()
        if not v.is_dir():
            return
        vroot = v.resolve()
        try:
            for changes in watch(v, step=500, debounce=800, stop_event=self._watch_stop):
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
                        self._index.apply_fs_change(rel, "deleted")
                        continue
                    if not rel.endswith(".md"):
                        continue
                    kind = "modified" if ch == Change.modified else "added"
                    self._index.apply_fs_change(rel, kind)
        except Exception:
            return

    def _start_watcher(self) -> None:
        if not WATCH or self._watch_thread is not None:
            return
        t = threading.Thread(target=self._watch_loop, name="sayu-watch-module", daemon=True)
        self._watch_thread = t
        t.start()

    def _config_data(self) -> Dict[str, Any]:
        return {
            "vault_path": str(self._get_vault()),
            "index": self._index.snapshot(),
            "index_dir": os.path.expanduser(os.getenv(INDEX_DIR_ENV) or "~/.cache/sayu-sagohub"),
            "watch_enabled": WATCH,
        }

    def _put_file(self, rel_path: str, content: str) -> None:
        p = (self._get_vault() / rel_path).resolve()
        v = self._get_vault().resolve()
        if v not in p.parents and p != v:
            raise ValueError("path outside vault")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        self._index.apply_fs_change(rel_path.replace("\\", "/"), "modified")

    def _parse_intent(self, q: str) -> Dict[str, Any]:
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
        m2 = re.search(r"(?:#|섹션|챕터)\s*[:：]?\s*([^\n.?!]+)", q, re.IGNORECASE)
        if m2:
            out["section_hint"] = m2.group(1).strip()
        return out
