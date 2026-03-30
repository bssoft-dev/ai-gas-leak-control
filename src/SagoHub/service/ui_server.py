"""
서비스 UI 서버: 각 서비스의 인터페이스 정의를 기반으로 프론트엔드를 서빙
ServiceDef + ServiceLoader 기반.
"""
import asyncio
from datetime import datetime, timezone
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .loader import ServiceLoader
from .schema import ServiceDef, InterfaceDef

# DEV 모드 상단 배너 (같은 포트에서 HMR 사용 시 표시)
_DEV_BANNER_HTML = """<div class="sagohub-dev-banner" style="position:sticky;top:0;z-index:99999;background:#e94560;color:#fff;font-size:12px;padding:6px 12px;text-align:center;font-family:system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.2);">DEV 모드 (HMR)</div>"""

# 모듈 스크립트/정적 파일 MIME 타입 (브라우저 strict MIME 체크 대응)
_EXTRA_MEDIA_TYPES = {
    ".js": "application/javascript",
    ".jsx": "application/javascript",
    ".ts": "application/javascript",
    ".tsx": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".wasm": "application/wasm",
}


def _media_type_for_path(path: Path) -> Optional[str]:
    return _EXTRA_MEDIA_TYPES.get(path.suffix.lower())


def _resolve_binding_path(
    binding: str,
    services_dir: Path,
    service_dir: Optional[Path],
) -> Path:
    """YAML interface.binding 경로 해석: './'는 프로젝트 루트 기준, 그 외는 service_dir 기준."""
    p = Path(binding)
    if p.is_absolute():
        return p
    if binding.startswith("./"):
        base = services_dir.parent
        return (base / binding.lstrip("./")).resolve()
    if service_dir:
        return (service_dir / binding).resolve()
    return p.resolve() if p.exists() else p


class _ProxyToViteMiddleware:
    """FRONTEND_DEV 시 Vite dev 서버로 HTTP/WebSocket 프록시 (같은 포트에서 HMR)."""

    def __init__(
        self,
        app: ASGIApp,
        backend_url: str,
        inject_dev_banner: bool = True,
    ):
        self.app = app
        self.backend_url = backend_url.rstrip("/")
        self.inject_dev_banner = inject_dev_banner

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if path.startswith("/api"):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "http":
            await self._proxy_http(scope, receive, send)
        elif scope["type"] == "websocket":
            await self._proxy_websocket(scope, receive, send)
        else:
            await self.app(scope, receive, send)

    async def _proxy_http(self, scope: Scope, receive: Receive, send: Send) -> None:
        import httpx

        path = scope.get("path", "")
        method = scope.get("method", "GET")
        query = scope.get("query_string", b"").decode()
        url = f"{self.backend_url}{path}" + ("?" + query if query else "")
        headers = [
            (k.decode().lower(), v.decode()) for k, v in scope.get("headers", [])
            if k.decode().lower() not in ("host", "connection")
        ]
        body = b""
        if method in ("POST", "PUT", "PATCH"):
            while True:
                msg = await receive()
                if msg["type"] == "http.request":
                    body += msg.get("body", b"")
                    if not msg.get("more_body", False):
                        break
                elif msg["type"] == "http.disconnect":
                    return

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.request(method, url, content=body, headers=dict(headers))
            except Exception as e:
                await send({
                    "type": "http.response.start",
                    "status": 502,
                    "headers": [[b"content-type", b"text/plain; charset=utf-8"]],
                })
                await send({"type": "http.response.body", "body": f"Proxy error: {e}".encode()})
                return

        content = resp.content
        resp_headers = [[k.encode(), v.encode() if isinstance(v, str) else v] for k, v in resp.headers.items()]
        if self.inject_dev_banner and resp.headers.get("content-type", "").split(";")[0].strip() == "text/html":
            try:
                text = resp.content.decode("utf-8", errors="replace")
                if "<body>" in text:
                    text = text.replace("<body>", "<body>" + _DEV_BANNER_HTML, 1)
                elif "<body " in text:
                    i = text.find("<body")
                    j = text.find(">", i) + 1
                    text = text[:j] + _DEV_BANNER_HTML + text[j:]
                else:
                    text = text.replace("</head>", "</head>" + _DEV_BANNER_HTML, 1)
                content = text.encode("utf-8")
                for h in resp_headers:
                    if h[0].lower() == b"content-length":
                        h[1] = str(len(content)).encode()
                        break
            except Exception:
                pass

        await send({
            "type": "http.response.start",
            "status": resp.status_code,
            "headers": resp_headers,
        })
        await send({"type": "http.response.body", "body": content})

    async def _proxy_websocket(self, scope: Scope, receive: Receive, send: Send) -> None:
        import aiohttp

        query = scope.get("query_string", b"").decode()
        ws_scheme = "wss" if scope.get("scheme") == "https" else "ws"
        backend_host = self.backend_url.replace("http://", "").replace("https://", "")
        backend_ws = f"ws://{backend_host}{path}" + ("?" + query if query else "")

        await send({"type": "websocket.accept"})

        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(backend_ws, autoclose=False, autoping=False) as ws:
                    async def from_client():
                        try:
                            while True:
                                msg = await receive()
                                if msg["type"] == "websocket.receive":
                                    if "text" in msg:
                                        await ws.send_str(msg["text"])
                                    elif "bytes" in msg:
                                        await ws.send_bytes(msg["bytes"])
                                elif msg["type"] == "websocket.disconnect":
                                    await ws.close()
                                    return
                        except (asyncio.CancelledError, Exception):
                            try:
                                await ws.close()
                            except Exception:
                                pass

                    async def from_backend():
                        try:
                            async for m in ws:
                                if m.type == aiohttp.WSMsgType.TEXT:
                                    await send({"type": "websocket.send", "text": m.data})
                                elif m.type == aiohttp.WSMsgType.BINARY:
                                    await send({"type": "websocket.send", "bytes": m.data})
                                elif m.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                    break
                        except (asyncio.CancelledError, Exception):
                            pass

                    await asyncio.gather(from_client(), from_backend())
        except Exception:
            await send({"type": "websocket.close", "code": 1011})


class ServiceUIServer:
    """서비스별 UI 서버 (ServiceDef 기반)"""

    def __init__(
        self,
        service_id: str,
        services_dir: Path,
        event_bus_url: str = "http://localhost:8000",
        use_frontend_dev: bool = False,
        frontend_dev_port: Optional[int] = None,
    ):
        self.service_id = service_id
        self.services_dir = Path(services_dir)
        self.event_bus_url = event_bus_url
        self.use_frontend_dev = use_frontend_dev
        self.frontend_dev_port = frontend_dev_port
        self.app = FastAPI(title=f"{service_id} UI Server")

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        if use_frontend_dev and frontend_dev_port:
            self.app.add_middleware(
                _ProxyToViteMiddleware,
                backend_url=f"http://127.0.0.1:{frontend_dev_port}",
                inject_dev_banner=True,
            )

        self.service_def: Optional[ServiceDef] = None
        self._load_service()
        if not use_frontend_dev:
            self._mount_static_files()
        self._setup_routes()

    def _load_service(self) -> None:
        """서비스 정의 로드 (ServiceLoader)"""
        loader = ServiceLoader(self.services_dir)
        services = loader.load_all_services()
        self.service_def = services.get(self.service_id)
        if not self.service_def:
            raise ValueError(
                f"Service {self.service_id} not found in {self.services_dir}"
            )

    def _resolve_interface_binding(self, iface: InterfaceDef) -> Optional[Path]:
        """YAML interface 한 개의 binding 경로를 해석 (프로젝트 루트/ service_dir 기준)."""
        if not iface.binding:
            return None
        return _resolve_binding_path(
            iface.binding,
            self.services_dir,
            self.service_def.service_dir if self.service_def else None,
        )

    def _mount_static_files(self) -> None:
        """YAML interface: 항목 기준으로 프론트엔드 정적 파일 마운트 (interface.binding)"""
        if not self.service_def or not self.service_def.interfaces:
            return
        try:
            from fastapi.staticfiles import StaticFiles
        except ImportError:
            return
        for iface in self.service_def.interfaces:
            if not iface.binding:
                continue
            binding_path = self._resolve_interface_binding(iface)
            if not binding_path:
                continue
            build_dirs = ["dist", "build", "out", ".next"]
            static_path: Optional[Path] = None
            for d in build_dirs:
                p = binding_path / d
                if p.exists() and p.is_dir():
                    static_path = p
                    break
            if static_path is None:
                static_path = binding_path
            if static_path.exists():
                mount_path = f"/static/{iface.id or iface.type}"
                try:
                    self.app.mount(
                        mount_path,
                        StaticFiles(directory=str(static_path)),
                        name=f"static_{iface.id or iface.type}",
                    )
                    print(f"[UI Server] 정적 파일 마운트: {mount_path} -> {static_path}")
                except Exception as e:
                    print(f"[UI Server] ⚠️  정적 파일 마운트 실패 ({mount_path}): {e}")

    def _setup_routes(self) -> None:
        """라우트 설정"""

        @self.app.get("/", response_class=HTMLResponse)
        async def index():
            if self.service_def and self.service_def.interfaces:
                iface = self.service_def.interfaces[0]
                binding_path = self._resolve_interface_binding(iface) if iface.binding else None
                if binding_path and binding_path.exists():
                    index_path = None
                    for build_dir in ["dist", "build", "out", ".next"]:
                        p = binding_path / build_dir / "index.html"
                        if p.exists():
                            index_path = p
                            break
                    if index_path is None and (binding_path / "index.html").exists():
                        index_path = binding_path / "index.html"
                    if index_path is not None:
                        domain = getattr(self.service_def.metadata, "domain", None) if self.service_def else None
                        if domain:
                            try:
                                content = index_path.read_text(encoding="utf-8")
                                script = f'<script>window.__SAGOHUB_SERVICE_DOMAIN__ = {json.dumps(domain)};</script>'
                                if "</head>" in content:
                                    content = content.replace("</head>", script + "\n</head>", 1)
                                else:
                                    content = content.replace("<body>", "<body>" + script, 1)
                                return HTMLResponse(content)
                            except Exception:
                                pass
                        return FileResponse(str(index_path))
            return self._get_index_html()

        def _first_interface_binding_path(self) -> Optional[Path]:
            if not self.service_def or not self.service_def.interfaces:
                return None
            iface = self.service_def.interfaces[0]
            return self._resolve_interface_binding(iface) if iface.binding else None

        @self.app.get("/src/{path:path}", response_class=FileResponse)
        async def serve_src(path: str):
            """Vite/React 소스 디렉터리(/src/*) 서빙. index.html이 /src/main.jsx 등을 요청할 때 사용."""
            binding_path = _first_interface_binding_path(self)
            if not binding_path or not binding_path.exists():
                raise HTTPException(status_code=404, detail="Not found")
            src_dir = binding_path / "src"
            file_path = (src_dir / path).resolve()
            if not str(file_path).startswith(str(src_dir.resolve())):
                raise HTTPException(status_code=403, detail="Forbidden")
            if not file_path.exists() or not file_path.is_file():
                raise HTTPException(status_code=404, detail="Not found")
            media_type = _media_type_for_path(file_path)
            return FileResponse(str(file_path), media_type=media_type)

        @self.app.get("/assets/{path:path}", response_class=FileResponse)
        async def serve_assets(path: str):
            """Vite 빌드 결과(/assets/*) 서빙. dist/index.html이 /assets/... 를 참조할 때 사용."""
            binding_path = _first_interface_binding_path(self)
            if not binding_path or not binding_path.exists():
                raise HTTPException(status_code=404, detail="Not found")
            for build_dir in ["dist", "build", "out", ".next"]:
                assets_dir = binding_path / build_dir / "assets"
                if assets_dir.exists():
                    file_path = (assets_dir / path).resolve()
                    if not str(file_path).startswith(str(assets_dir.resolve())):
                        raise HTTPException(status_code=403, detail="Forbidden")
                    if file_path.exists() and file_path.is_file():
                        media_type = _media_type_for_path(file_path)
                        return FileResponse(str(file_path), media_type=media_type)
            raise HTTPException(status_code=404, detail="Not found")

        @self.app.get("/api/service", response_model=dict)
        async def get_service_info():
            if not self.service_def:
                raise HTTPException(status_code=404, detail="Service not found")
            m = self.service_def.metadata
            out = {
                "id": m.id,
                "name": m.name,
                "version": m.version,
                "description": getattr(m, "description", "") or "",
            }
            if getattr(m, "domain", None):
                out["domain"] = m.domain
            if "default_model" in self.service_def.config_schema:
                item = self.service_def.config_schema["default_model"]
                out["default_model"] = self.service_def.config.get("default_model", item.default)
            return out

        @self.app.get("/api/interfaces", response_model=List[dict])
        async def get_interfaces():
            if not self.service_def:
                raise HTTPException(status_code=404, detail="Service not found")
            out: List[dict] = []
            for iface in self.service_def.interfaces:
                resolved_props = self.service_def.resolve_interface_props(iface)
                binding_url = None
                if iface.binding:
                    binding_url = f"/static/{iface.id or iface.type}"
                out.append({
                    "type": iface.type or "react-ui",
                    "id": iface.id,
                    "label": iface.label or "",
                    "description": iface.description or "",
                    "component": getattr(iface, "component", "") or "",
                    "binding": str(iface.binding) if iface.binding else None,
                    "binding_url": binding_url,
                    "props": resolved_props,
                    "events": getattr(iface, "events", {}) or {},
                })
            return out

        @self.app.get("/api/config", response_model=dict)
        async def get_config():
            if not self.service_def:
                raise HTTPException(status_code=404, detail="Service not found")
            schema_out: Dict[str, Any] = {}
            for key, item in self.service_def.config_schema.items():
                schema_out[key] = {
                    "type": item.type,
                    "label": item.label,
                    "default": item.default,
                    "required": item.required,
                    "description": item.description,
                    "options": item.options,
                    "value": self.service_def.config.get(key, item.default),
                }
            return {
                "schema": schema_out,
                "values": self.service_def.config.values,
            }

        @self.app.post("/api/config", response_model=dict)
        async def update_config(config_values: dict):
            if not self.service_def:
                raise HTTPException(status_code=404, detail="Service not found")
            for key, value in config_values.items():
                if key in self.service_def.config_schema:
                    self.service_def.config.values[key] = value
            return {"status": "success", "values": self.service_def.config.values}

        @self.app.post("/api/events/publish")
        async def publish_event(event: dict):
            print(f"[UI Server] PUBLISH EVENT: {event}")
            import requests
            # 이벤트 버스가 모듈(LLM 경로/요금 추정 등) 처리 완료까지 대기하므로 타임아웃을 넉넉히
            publish_timeout = 90
            try:
                r = requests.post(
                    f"{self.event_bus_url}/publish",
                    json=event,
                    timeout=publish_timeout,
                )
                r.raise_for_status()
                return {"status": "success"}
            except Exception as e:
                print(f"[UI Server] ERROR: {e}")
                raise HTTPException(status_code=500, detail=str(e))

        @self.app.get("/api/models")
        async def get_models():
            """LLM API /models 프록시 (모델 목록). 환경변수 LLM_API_BASE 사용."""
            import requests
            llm_base = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr").rstrip("/")
            url = f"{llm_base}/models"
            try:
                r = requests.get(url, timeout=10)
                r.raise_for_status()
                data = r.json()
                if isinstance(data, list):
                    return data
                if isinstance(data, dict) and "data" in data:
                    return data["data"]
                if isinstance(data, dict) and "models" in data:
                    return data["models"]
                return []
            except Exception as e:
                print(f"[UI Server] /api/models ERROR: {e}")
                raise HTTPException(status_code=502, detail=str(e))

        @self.app.get("/api/files/list")
        async def list_files(path: str = ".", pattern: Optional[str] = None):
            """파일 시스템 목록 조회 API"""
            import os
            from pathlib import Path
            import fnmatch
            
            try:
                # 경로 정규화 및 보안 검사
                base_path = Path(path).resolve()
                
                # 프로젝트 루트를 벗어나지 않도록 제한 (선택적)
                # project_root = self.services_dir.parent.parent
                # if not str(base_path).startswith(str(project_root)):
                #     raise HTTPException(status_code=403, detail="Access denied")
                
                if not base_path.exists():
                    raise HTTPException(status_code=404, detail="Path not found")
                
                if not base_path.is_dir():
                    raise HTTPException(status_code=400, detail="Not a directory")
                
                items = []
                try:
                    for item in base_path.iterdir():
                        # 숨김 파일/폴더 제외 (선택적)
                        if item.name.startswith('.') and item.name != '.sago':
                            continue
                        
                        item_info = {
                            "name": item.name,
                            "path": str(item),
                            "relative_path": str(item.relative_to(base_path)) if base_path != item else ".",
                            "is_dir": item.is_dir(),
                            "is_file": item.is_file(),
                            "size": item.stat().st_size if item.is_file() else 0,
                        }
                        
                        # 패턴 필터링
                        if pattern:
                            if item.is_file():
                                if fnmatch.fnmatch(item.name, pattern) or fnmatch.fnmatch(str(item), pattern):
                                    items.append(item_info)
                            elif item.is_dir():
                                # 디렉토리는 항상 포함
                                items.append(item_info)
                        else:
                            items.append(item_info)
                    
                    # 정렬: 디렉토리 먼저, 그 다음 파일
                    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
                    
                except PermissionError:
                    raise HTTPException(status_code=403, detail="Permission denied")
                
                return {
                    "path": str(base_path),
                    "items": items,
                    "count": len(items)
                }
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        if self.service_id == "com.SagoHub.document-writer":
            _doc_writer_dir = self.services_dir.parent / "data" / "document_writer"
            _doc_writer_state_path = _doc_writer_dir / "state.json"

            @self.app.get("/api/document-writer/state")
            async def get_document_writer_state():
                """문서 작성기 전체 상태(문서·컨텍스트·채팅) 로드."""
                if not _doc_writer_state_path.exists():
                    return {}
                try:
                    data = json.loads(_doc_writer_state_path.read_text(encoding="utf-8"))
                    return data if isinstance(data, dict) else {}
                except Exception:
                    return {}

            @self.app.post("/api/document-writer/state")
            async def save_document_writer_state(request: Request):
                """제목·본문·컨텍스트 탭·문서별 채팅 세션 등 전체 상태 저장."""
                try:
                    payload = await request.json()
                    if not isinstance(payload, dict):
                        raise HTTPException(status_code=400, detail="JSON object required")
                    _doc_writer_dir.mkdir(parents=True, exist_ok=True)
                    _doc_writer_state_path.write_text(
                        json.dumps(payload, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    return {"status": "ok"}
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

        if self.service_id == "com.SagoHub.equipment-traceability":
            @self.app.get("/api/traceability/records")
            async def get_traceability_records():
                """data/traceability/records.json 직접 로드 (초기 로드용)"""
                records_path = self.services_dir.parent / "data" / "traceability" / "records.json"
                if not records_path.exists():
                    return []
                try:
                    data = json.loads(records_path.read_text(encoding="utf-8"))
                    return data if isinstance(data, list) else []
                except Exception:
                    return []

            # 도면 관리(installation location) API
            _inst_loc_dir = self.services_dir.parent / "data" / "installation_location"
            _inst_drawings_path = _inst_loc_dir / "drawings.json"
            _inst_uploads_dir = _inst_loc_dir / "uploads"
            _inst_points_dir = _inst_loc_dir / "points"

            @self.app.get("/api/installation/drawings")
            async def get_installation_drawings():
                """도면 관리 목록"""
                if not _inst_drawings_path.exists():
                    return []
                try:
                    data = json.loads(_inst_drawings_path.read_text(encoding="utf-8"))
                    return data if isinstance(data, list) else []
                except Exception:
                    return []

            @self.app.get("/api/installation/drawings/{drawing_id}")
            async def get_installation_drawing(drawing_id: str):
                """도면 1건 + 포인트 목록"""
                if not _inst_drawings_path.exists():
                    raise HTTPException(status_code=404, detail="Not found")
                try:
                    drawings = json.loads(_inst_drawings_path.read_text(encoding="utf-8"))
                    if not isinstance(drawings, list):
                        raise HTTPException(status_code=404, detail="Not found")
                    drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
                    if not drawing:
                        raise HTTPException(status_code=404, detail="Not found")
                    points_path = _inst_points_dir / f"{drawing_id}.json"
                    points = []
                    if points_path.exists():
                        points = json.loads(points_path.read_text(encoding="utf-8"))
                        if not isinstance(points, list):
                            points = []
                    return {"drawing": drawing, "points": points}
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

            @self.app.get("/api/installation/drawings/{drawing_id}/file")
            async def get_installation_drawing_file(drawing_id: str):
                """도면 파일 스트리밍 (PDF/이미지)"""
                if not _inst_drawings_path.exists():
                    raise HTTPException(status_code=404, detail="Not found")
                drawings = json.loads(_inst_drawings_path.read_text(encoding="utf-8"))
                if not isinstance(drawings, list):
                    raise HTTPException(status_code=404, detail="Not found")
                drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
                if not drawing:
                    raise HTTPException(status_code=404, detail="Not found")
                rel_path = drawing.get("file_path") or ""
                if not rel_path or ".." in rel_path:
                    raise HTTPException(status_code=404, detail="Invalid file")
                file_path = _inst_loc_dir / rel_path
                if not file_path.exists() or not file_path.is_file():
                    raise HTTPException(status_code=404, detail="File not found")
                media = "application/pdf" if drawing.get("file_type") == "pdf" else "image/png"
                return FileResponse(str(file_path), media_type=media)

            # PDF 비전 자동분석 이미지(페이지 PNG) 스트리밍
            _tv_pages_dir = self.services_dir.parent / "data" / "traceability" / "pdf_vision" / "pages"

            @self.app.get("/api/traceability/pdf_vision/jobs/{job_id}/pages/{page_number}/file")
            async def get_traceability_pdf_vision_page_file(job_id: str, page_number: int):
                """
                data/traceability/pdf_vision/pages/{job_id}/page-{page_number}.png
                """
                # UUID 유사 문자열만 허용 (경로 탐색 방지)
                if not re.match(r"^[0-9a-fA-F-]{8,64}$", job_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid job_id")
                if page_number < 1:
                    raise HTTPException(status_code=400, detail="Invalid page_number")

                job_dir = _tv_pages_dir / job_id
                # 페이지 이미지가 여러 장일 때, page-1.png, page-01.png, page-001.png 등이 존재할 수 있음
                # 실제 padding 자릿수는 디렉터리 내 파일명을 기준으로 검출
                padding = 0
                matches = []
                if job_dir.exists() and job_dir.is_dir():
                    for fname in os.listdir(job_dir):
                        # 예: page-1.png, page-01.png, page-001.png 등 패턴 매칭
                        m = re.match(r'^page-(\d+)\.png$', fname)
                        if m:
                            matches.append(m.group(1))
                    if matches:
                        padding = max(len(num) for num in matches)
                # padding 값에 따라 zero-padding 된 파일명 생성
                if padding > 0:
                    file_name = f"page-{page_number:0{padding}d}.png"
                else:
                    file_name = f"page-{page_number}.png"
                file_path = job_dir / file_name
                if not file_path.exists() or not file_path.is_file():
                    raise HTTPException(status_code=404, detail="File not found")
                return FileResponse(str(file_path), media_type="image/png")

        if self.service_id == "com.SagoHub.ai-gas-leak-control":
            _gas_leak_dir = self.services_dir.parent / "data" / "ai_gas_leak"
            _gas_state_path = _gas_leak_dir / "state.json"
            _gas_sensors_path = _gas_leak_dir / "sensors.json"
            _gas_timeseries_path = _gas_leak_dir / "timeseries.json"

            @self.app.get("/api/gas-leak/state")
            async def get_gas_leak_state():
                """구역/밸브/경광등/사이렌/MES 상태"""
                default = {
                    "valve_closed": False,
                    "zones": [],
                    "emergency_at": None,
                    "alarm_beacon_on": False,
                    "alarm_siren_on": False,
                    "mes_equipment_running": True,
                    "mes_updated_at": None,
                    "mes_work_order_id": None,
                    "policy": {
                        "level1_warning_pct": 1.5,
                        "level2_siren_pct": 2.5,
                        "level3_valve_pct": 3.0,
                        "grace_seconds": 3,
                    },
                    "risk_level": 0,
                    "auto_shutdown_deadline": None,
                }
                if not _gas_state_path.exists():
                    return default
                try:
                    data = json.loads(_gas_state_path.read_text(encoding="utf-8"))
                    return {**default, **data} if isinstance(data, dict) else default
                except Exception:
                    return default

            @self.app.get("/api/gas-leak/sensors")
            async def get_gas_leak_sensors():
                """센서 현재값 목록"""
                if not _gas_sensors_path.exists():
                    return []
                try:
                    data = json.loads(_gas_sensors_path.read_text(encoding="utf-8"))
                    return data if isinstance(data, list) else []
                except Exception:
                    return []

            @self.app.get("/api/gas-leak/timeseries")
            async def get_gas_leak_timeseries():
                """압력/유량/가스 농도 시계열 (실시간 차트용, 센서별 sensors 키)"""
                default_ts = {"pressure": [], "flow": [], "sensors": {}}
                if not _gas_timeseries_path.exists():
                    return default_ts
                try:
                    data = json.loads(_gas_timeseries_path.read_text(encoding="utf-8"))
                    return {**default_ts, **data} if isinstance(data, dict) else default_ts
                except Exception:
                    return default_ts

            _gas_drawings_path = _gas_leak_dir / "drawings.json"
            _gas_uploads_dir = _gas_leak_dir / "uploads"
            _gas_points_dir = _gas_leak_dir / "points"

            @self.app.get("/api/gas-leak/drawings")
            async def get_gas_leak_drawings():
                """공장 도면 목록"""
                if not _gas_drawings_path.exists():
                    return []
                try:
                    data = json.loads(_gas_drawings_path.read_text(encoding="utf-8"))
                    return data if isinstance(data, list) else []
                except Exception:
                    return []

            @self.app.get("/api/gas-leak/drawings/{drawing_id}")
            async def get_gas_leak_drawing(drawing_id: str):
                """도면 1건 + 센서(설치 위치) 목록"""
                if not _gas_drawings_path.exists():
                    raise HTTPException(status_code=404, detail="Not found")
                try:
                    drawings = json.loads(_gas_drawings_path.read_text(encoding="utf-8"))
                    if not isinstance(drawings, list):
                        raise HTTPException(status_code=404, detail="Not found")
                    drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
                    if not drawing:
                        raise HTTPException(status_code=404, detail="Not found")
                    points_path = _gas_points_dir / f"{drawing_id}.json"
                    sensors = []
                    valves = []
                    if points_path.exists():
                        raw = json.loads(points_path.read_text(encoding="utf-8"))
                        if isinstance(raw, list):
                            sensors = raw
                        elif isinstance(raw, dict):
                            sensors = raw.get("sensors") if isinstance(raw.get("sensors"), list) else []
                            valves = raw.get("valves") if isinstance(raw.get("valves"), list) else []
                    return {"drawing": drawing, "sensors": sensors, "valves": valves}
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

            @self.app.get("/api/gas-leak/drawings/{drawing_id}/file")
            async def get_gas_leak_drawing_file(drawing_id: str):
                """도면 이미지 파일 스트리밍"""
                if not _gas_drawings_path.exists():
                    raise HTTPException(status_code=404, detail="Not found")
                drawings = json.loads(_gas_drawings_path.read_text(encoding="utf-8"))
                if not isinstance(drawings, list):
                    raise HTTPException(status_code=404, detail="Not found")
                drawing = next((d for d in drawings if d.get("id") == drawing_id), None)
                if not drawing:
                    raise HTTPException(status_code=404, detail="Not found")
                rel_path = drawing.get("file_path") or ""
                if not rel_path or ".." in rel_path:
                    raise HTTPException(status_code=404, detail="Invalid file")
                file_path = _gas_leak_dir / rel_path
                if not file_path.exists() or not file_path.is_file():
                    raise HTTPException(status_code=404, detail="File not found")
                media = "image/png" if drawing.get("file_type") == "image" else "image/jpeg"
                return FileResponse(str(file_path), media_type=media)

            _gas_ai_history_path = _gas_leak_dir / "ai_history.json"

            @self.app.get("/api/gas-leak/ai-history")
            async def get_gas_leak_ai_history():
                """AI 판단 이력 목록 (최신순)"""
                if not _gas_ai_history_path.exists():
                    return []
                try:
                    data = json.loads(_gas_ai_history_path.read_text(encoding="utf-8"))
                    if not isinstance(data, list):
                        return []
                    return list(reversed(data))
                except Exception:
                    return []

            @self.app.post("/api/gas-leak/mes-status")
            async def post_gas_leak_mes_status(request: Request):
                """MES 연동: 설비 가동 신호(Run/Stop) 및 작업 지시 수신 (오탐지 방지용)"""
                import requests
                try:
                    body = await request.json()
                except Exception:
                    body = {}
                equipment_running = body.get("equipment_running", True)
                work_order_id = body.get("work_order_id") or body.get("work_order")
                try:
                    r = requests.post(
                        f"{self.event_bus_url.rstrip('/')}/publish",
                        json={
                            "type": "GAS_LEAK_MES_STATUS",
                            "payload": {
                                "equipment_running": bool(equipment_running),
                                "work_order_id": work_order_id,
                            },
                        },
                        timeout=10,
                    )
                    r.raise_for_status()
                    return {"status": "success"}
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

            _gas_control_history_path = _gas_leak_dir / "control_history.json"
            _gas_daily_usage_path = _gas_leak_dir / "daily_usage.json"

            @self.app.get("/api/gas-leak/control-history")
            async def get_gas_leak_control_history():
                """자동/수동 제어 실행 이력 (최신순)"""
                if not _gas_control_history_path.exists():
                    return []
                try:
                    data = json.loads(_gas_control_history_path.read_text(encoding="utf-8"))
                    if not isinstance(data, list):
                        return []
                    return list(reversed(data))
                except Exception:
                    return []

            @self.app.get("/api/gas-leak/daily-usage")
            async def get_gas_leak_daily_usage():
                """금일 가스 사용량 추정(L) — 유량 시뮬 누적"""
                default = {"date": datetime.utcnow().strftime("%Y-%m-%d"), "cumulative_liters": 0.0}
                if not _gas_daily_usage_path.exists():
                    return default
                try:
                    data = json.loads(_gas_daily_usage_path.read_text(encoding="utf-8"))
                    if not isinstance(data, dict):
                        return default
                    return {**default, **data}
                except Exception:
                    return default

            @self.app.post("/api/gas-leak/policy")
            async def post_gas_leak_policy(request: Request):
                """임계치·3단계·유예 시간 정책 저장"""
                import requests
                try:
                    body = await request.json()
                except Exception:
                    body = {}
                try:
                    r = requests.post(
                        f"{self.event_bus_url.rstrip('/')}/publish",
                        json={"type": "GAS_LEAK_POLICY_SAVE", "payload": body},
                        timeout=10,
                    )
                    r.raise_for_status()
                    return {"status": "success"}
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

            @self.app.post("/api/gas-leak/cancel-auto-shutdown")
            async def post_gas_leak_cancel_auto_shutdown():
                """자동 차단 유예 취소"""
                import requests
                try:
                    r = requests.post(
                        f"{self.event_bus_url.rstrip('/')}/publish",
                        json={"type": "GAS_LEAK_CANCEL_AUTO_SHUTDOWN", "payload": {}},
                        timeout=10,
                    )
                    r.raise_for_status()
                    return {"status": "success"}
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

        if self.service_id == "com.SagoHub.qr-drawing-manager":
            _dq_dir = self.services_dir.parent / "data" / "drawing_qr"
            _dq_catalog_path = _dq_dir / "catalog.json"
            _dq_images_dir = _dq_dir / "images"

            def _load_drawing_qr_catalog() -> Dict[str, Any]:
                if not _dq_catalog_path.exists():
                    return {"pages": [], "groups": [], "uploads": [], "projects": [], "relations": []}
                try:
                    data = json.loads(_dq_catalog_path.read_text(encoding="utf-8"))
                    if not isinstance(data, dict):
                        return {"pages": [], "groups": [], "uploads": [], "projects": [], "relations": []}
                    for k in ("pages", "groups", "uploads", "projects", "relations"):
                        if k not in data or not isinstance(data[k], list):
                            data[k] = []
                    return data
                except Exception:
                    return {"pages": [], "groups": [], "uploads": [], "projects": [], "relations": []}

            def _save_drawing_qr_catalog(cat: Dict[str, Any]) -> None:
                tmp = _dq_dir / "catalog.tmp.json"
                tmp.write_text(json.dumps(cat, ensure_ascii=False, indent=2), encoding="utf-8")
                tmp.replace(_dq_catalog_path)

            def _is_uuid_like(s: str) -> bool:
                return bool(re.match(r"^[0-9a-fA-F-]{36}$", s or ""))

            @self.app.get("/api/drawing-qr/pages/{page_id}/file")
            async def get_drawing_qr_page_pdf(page_id: str):
                """페이지별 단일 PDF 스트리밍 (data/drawing_qr/pages/{page_id}.pdf)"""
                if not re.match(r"^[0-9a-fA-F-]{36}$", page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")
                if not _dq_catalog_path.exists():
                    raise HTTPException(status_code=404, detail="Not found")
                try:
                    catalog = json.loads(_dq_catalog_path.read_text(encoding="utf-8"))
                    pages = catalog.get("pages") if isinstance(catalog, dict) else None
                    if not isinstance(pages, list):
                        raise HTTPException(status_code=404, detail="Not found")
                    page = next((p for p in pages if p.get("id") == page_id), None)
                    if not page:
                        raise HTTPException(status_code=404, detail="Not found")
                    rel = page.get("storage_path") or ""
                    if not rel or ".." in rel or rel.startswith("/"):
                        raise HTTPException(status_code=404, detail="Invalid file")
                    file_path = _dq_dir / rel
                    if not file_path.exists() or not file_path.is_file():
                        raise HTTPException(status_code=404, detail="File not found")
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))
                return FileResponse(str(file_path), media_type="application/pdf")

            @self.app.get("/api/drawing-qr/pages/{page_id}/image")
            async def get_drawing_qr_page_image(page_id: str):
                """페이지별 PNG 이미지 스트리밍 (data/drawing_qr/images/{page_id}.png)"""
                if not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")
                file_path = _dq_images_dir / f"{page_id}.png"
                if not file_path.exists() or not file_path.is_file():
                    raise HTTPException(status_code=404, detail="Image not found")
                return FileResponse(str(file_path), media_type="image/png")

            @self.app.post("/api/drawing-qr/pages/{page_id}/kind")
            async def post_drawing_qr_page_kind(page_id: str, request: Request):
                """
                도면 분류(제작/설치/미분류)를 catalog.json에 직접 반영합니다.
                이벤트 버스·모듈 파이프라인 없이 UI에서도 분류가 동작하도록 합니다.
                """
                body: Dict[str, Any] = {}
                try:
                    b = await request.json()
                    if isinstance(b, dict):
                        body = b
                except Exception:
                    pass
                if not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")
                kind = body.get("kind")
                if kind in ("", "none", "null"):
                    kind = None
                if kind is not None and kind not in ("production", "installation"):
                    raise HTTPException(
                        status_code=400, detail="kind는 production, installation 또는 null 이어야 합니다."
                    )
                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                page = next((p for p in pages if isinstance(p, dict) and p.get("id") == page_id), None)
                if not page:
                    raise HTTPException(status_code=404, detail="page not found")
                page["kind"] = kind
                _save_drawing_qr_catalog(cat)
                pid = page.get("id")
                return {
                    "page": {
                        **page,
                        "file_url": f"/api/drawing-qr/pages/{pid}/file",
                        "image_url": f"/api/drawing-qr/pages/{pid}/image",
                    }
                }

            @self.app.put("/api/drawing-qr/pages/{page_id}/dwg_no")
            async def put_drawing_qr_page_dwg_no(page_id: str, request: Request):
                """도면 번호(DWG No) 저장(각 페이지 메타)."""
                body: Dict[str, Any] = {}
                try:
                    b = await request.json()
                    if isinstance(b, dict):
                        body = b
                except Exception:
                    pass

                if not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")

                dwg_no = body.get("dwg_no")
                if dwg_no is None or dwg_no == "":
                    dwg_no = None
                else:
                    dwg_no = str(dwg_no).strip() or None

                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                page = next((p for p in pages if isinstance(p, dict) and p.get("id") == page_id), None)
                if not page:
                    raise HTTPException(status_code=404, detail="page not found")

                page["dwg_no"] = dwg_no
                _save_drawing_qr_catalog(cat)

                return {
                    "status": "success",
                    "page_id": page_id,
                    "dwg_no": dwg_no,
                }

            @self.app.delete("/api/drawing-qr/pages/{page_id}")
            async def delete_drawing_qr_page(page_id: str):
                """도면(페이지) 삭제: catalog 정리 + 해당 PDF/PNG 파일 제거."""
                if not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")

                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                page = next((p for p in pages if isinstance(p, dict) and p.get("id") == page_id), None)
                if not page:
                    raise HTTPException(status_code=404, detail="page not found")

                # 1) pages 제거
                cat["pages"] = [p for p in pages if p.get("id") != page_id]
                # relations에서 해당 페이지가 포함된 링크 제거
                cat["relations"] = [
                    r
                    for r in (cat.get("relations") or [])
                    if r.get("anchor_page_id") != page_id and r.get("page_id") != page_id
                ]

                # 2) 남아있는 pages 기준으로 group 정리
                remaining_group_ids = set(p.get("group_id") for p in cat["pages"] if p.get("group_id"))
                cat["groups"] = [g for g in (cat.get("groups") or []) if g.get("id") in remaining_group_ids]

                _save_drawing_qr_catalog(cat)

                # 3) 파일 정리 (storage_path 기반으로 삭제, 폴백은 {page_id}.png/PDF)
                try:
                    storage_path = page.get("storage_path") or f"pages/{page_id}.pdf"
                    if isinstance(storage_path, str):
                        rel = storage_path.replace("\\", "/")
                        if rel.startswith("pages/") and ".." not in rel and not rel.startswith("/"):
                            pdf_path = (_dq_dir / rel).resolve()
                            if pdf_path.exists():
                                pdf_path.unlink()
                except Exception:
                    pass

                try:
                    png_path = (_dq_images_dir / f"{page_id}.png").resolve()
                    if png_path.exists():
                        png_path.unlink()
                except Exception:
                    pass

                return {"status": "success"}

            @self.app.post("/api/drawing-qr/pages/{page_id}/ungroup")
            async def post_drawing_qr_page_ungroup(page_id: str):
                """도면을 현재 그룹에서 해제합니다(페이지 자체는 유지)."""
                if not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")

                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                page = next((p for p in pages if isinstance(p, dict) and p.get("id") == page_id), None)
                if not page:
                    raise HTTPException(status_code=404, detail="page not found")

                gid = page.get("group_id")
                if not gid:
                    return {"status": "success", "group_id": None}

                page["group_id"] = None

                # 남아있는 pages 기준으로 빈 그룹 정리
                remaining_group_ids = set(p.get("group_id") for p in pages if p.get("group_id"))
                cat["groups"] = [g for g in (cat.get("groups") or []) if g.get("id") in remaining_group_ids]

                _save_drawing_qr_catalog(cat)
                return {"status": "success", "group_id": gid}

            def _project_id_of_page(cat: Dict[str, Any], page_id: str) -> Optional[str]:
                pages = cat.get("pages") or []
                uploads = cat.get("uploads") or []
                page = next((p for p in pages if p.get("id") == page_id), None)
                if not page:
                    return None
                uid = page.get("upload_id")
                up = next((u for u in uploads if u.get("id") == uid), None)
                return up.get("project_id") if up else None

            @self.app.post("/api/drawing-qr/pages/{anchor_page_id}/related")
            async def post_drawing_qr_page_related(anchor_page_id: str, request: Request):
                """기준 도면(anchor)에서 다른 도면을 관련 도면으로 등록."""
                body: Dict[str, Any] = {}
                try:
                    b = await request.json()
                    if isinstance(b, dict):
                        body = b
                except Exception:
                    pass
                page_id = (body.get("page_id") or "").strip()
                if not _is_uuid_like(anchor_page_id or "") or not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")
                if anchor_page_id == page_id:
                    raise HTTPException(status_code=400, detail="같은 도면은 등록할 수 없습니다.")

                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                if not any(p.get("id") == anchor_page_id for p in pages):
                    raise HTTPException(status_code=404, detail="anchor page not found")
                if not any(p.get("id") == page_id for p in pages):
                    raise HTTPException(status_code=404, detail="page not found")

                pj_a = _project_id_of_page(cat, anchor_page_id)
                pj_b = _project_id_of_page(cat, page_id)
                if pj_a and pj_b and pj_a != pj_b:
                    raise HTTPException(status_code=400, detail="같은 프로젝트의 도면끼리만 등록할 수 있습니다.")

                rels = cat.get("relations") or []
                exists = any(r.get("anchor_page_id") == anchor_page_id and r.get("page_id") == page_id for r in rels)
                if not exists:
                    rels.append(
                        {
                            "id": str(uuid.uuid4()),
                            "anchor_page_id": anchor_page_id,
                            "page_id": page_id,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    cat["relations"] = rels
                    _save_drawing_qr_catalog(cat)
                return {"status": "success"}

            @self.app.delete("/api/drawing-qr/pages/{anchor_page_id}/related/{page_id}")
            async def delete_drawing_qr_page_related(anchor_page_id: str, page_id: str):
                """현재 도면(anchor) 기준으로 관련 도면 관계를 해제."""
                if not _is_uuid_like(anchor_page_id or "") or not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")
                cat = _load_drawing_qr_catalog()
                rels = cat.get("relations") or []
                before = len(rels)
                rels = [
                    r
                    for r in rels
                    if not (
                        (r.get("anchor_page_id") == anchor_page_id and r.get("page_id") == page_id)
                        or (r.get("anchor_page_id") == page_id and r.get("page_id") == anchor_page_id)
                    )
                ]
                if len(rels) != before:
                    cat["relations"] = rels
                    _save_drawing_qr_catalog(cat)
                return {"status": "success"}

            @self.app.get("/api/drawing-qr/pages/{page_id}/related")
            async def get_drawing_qr_page_related(page_id: str, project_id: Optional[str] = None):
                """현재 도면 기준 1-hop 관련 도면(들어오는/나가는 링크 합집합) 조회."""
                if not _is_uuid_like(page_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid page_id")
                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                uploads = cat.get("uploads") or []
                rels = cat.get("relations") or []

                page = next((p for p in pages if p.get("id") == page_id), None)
                if not page:
                    raise HTTPException(status_code=404, detail="page not found")

                effective_project_id = (project_id or "").strip() or _project_id_of_page(cat, page_id)
                upload_ids = {u.get("id") for u in uploads if u.get("project_id") == effective_project_id and u.get("id")}

                related_ids: List[str] = []
                for r in rels:
                    a = r.get("anchor_page_id")
                    b = r.get("page_id")
                    if a == page_id and b:
                        related_ids.append(str(b))
                    elif b == page_id and a:
                        related_ids.append(str(a))
                # unique preserving order
                seen = set()
                uniq_ids = []
                for rid in related_ids:
                    if rid in seen:
                        continue
                    seen.add(rid)
                    uniq_ids.append(rid)

                rel_pages = []
                for p in pages:
                    pid = p.get("id")
                    if not pid or pid not in seen:
                        continue
                    if effective_project_id and p.get("upload_id") not in upload_ids:
                        continue
                    rel_pages.append(
                        {
                            **p,
                            "id": pid,
                            "file_url": f"/api/drawing-qr/pages/{pid}/file",
                            "image_url": f"/api/drawing-qr/pages/{pid}/image",
                        }
                    )

                prod = [p for p in rel_pages if p.get("kind") == "production"]
                inst = [p for p in rel_pages if p.get("kind") == "installation"]
                unc = [p for p in rel_pages if p.get("kind") not in ("production", "installation")]
                prod.sort(key=lambda x: x.get("page_number") or 0)
                inst.sort(key=lambda x: x.get("page_number") or 0)
                unc.sort(key=lambda x: x.get("page_number") or 0)

                return {
                    "production_pages": prod,
                    "installation_pages": inst,
                    "unclassified_pages": unc,
                }

            @self.app.get("/api/drawing-qr/projects")
            async def list_drawing_qr_projects():
                """프로젝트 목록 (1 프로젝트에 여러 upload 연결)."""
                cat = _load_drawing_qr_catalog()
                projects = cat.get("projects") or []
                uploads = cat.get("uploads") or []
                pages = cat.get("pages") or []

                # upload_id -> project_id
                up_to_proj: Dict[str, Optional[str]] = {}
                for u in uploads:
                    uid = u.get("id")
                    if not uid:
                        continue
                    up_to_proj[uid] = u.get("project_id")

                out: List[Dict[str, Any]] = []
                for pr in projects:
                    pid = pr.get("id")
                    if not pid:
                        continue
                    related_upload_ids = [uid for uid, apid in up_to_proj.items() if apid == pid]
                    upload_set = set(related_upload_ids)
                    page_count = sum(1 for p in pages if p.get("upload_id") in upload_set)
                    out.append(
                        {
                            "project_id": pid,
                            "name": pr.get("name") or pid,
                            "created_at": pr.get("created_at"),
                            "page_count": page_count,
                            "upload_count": len(related_upload_ids),
                        }
                    )

                out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
                return out

            @self.app.post("/api/drawing-qr/projects")
            async def create_drawing_qr_project(
                name: str = Form(...),
            ):
                """프로젝트 생성(업로드와 무관)."""
                cat = _load_drawing_qr_catalog()
                projects = cat.get("projects") or []
                if not isinstance(projects, list):
                    projects = []
                clean_name = (name or "").strip()
                if not clean_name:
                    raise HTTPException(status_code=400, detail="name is required")
                pid = str(uuid.uuid4())
                projects.append(
                    {
                        "id": pid,
                        "name": clean_name,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                cat["projects"] = projects
                _save_drawing_qr_catalog(cat)
                return {"project_id": pid, "name": clean_name}

            @self.app.put("/api/drawing-qr/projects/{project_id}")
            async def update_drawing_qr_project(
                project_id: str,
                name: str = Form(...),
            ):
                """프로젝트 이름 수정."""
                if not _is_uuid_like(project_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid project_id")
                clean_name = (name or "").strip()
                if not clean_name:
                    raise HTTPException(status_code=400, detail="name is required")
                cat = _load_drawing_qr_catalog()
                projects = cat.get("projects") or []
                target = next((p for p in projects if p.get("id") == project_id), None)
                if not target:
                    raise HTTPException(status_code=404, detail="Project not found")
                target["name"] = clean_name
                cat["projects"] = projects
                _save_drawing_qr_catalog(cat)
                return {"project_id": project_id, "name": clean_name}

            @self.app.get("/api/drawing-qr/projects/by-upload/{upload_id}")
            async def get_drawing_qr_project_by_upload(upload_id: str):
                """upload_id가 속한 project_id 조회."""
                if not _is_uuid_like(upload_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid upload_id")
                cat = _load_drawing_qr_catalog()
                uploads = cat.get("uploads") or []
                upload = next((u for u in uploads if u.get("id") == upload_id), None)
                if not upload:
                    raise HTTPException(status_code=404, detail="Project not found")
                if upload.get("project_id"):
                    return {"project_id": upload.get("project_id")}

                # 과거 데이터 마이그레이션: project_id가 없는 upload이면 자동으로 프로젝트 생성
                projects = cat.get("projects") or []
                if not isinstance(projects, list):
                    projects = []
                pid = str(uuid.uuid4())
                projects.append(
                    {
                        "id": pid,
                        "name": upload.get("filename") or pid,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                upload["project_id"] = pid
                cat["uploads"] = uploads
                cat["projects"] = projects
                _save_drawing_qr_catalog(cat)
                return {"project_id": pid}

            @self.app.get("/api/drawing-qr/projects/{project_id}")
            async def get_drawing_qr_project(project_id: str):
                """프로젝트의 도면(페이지) 목록."""
                if not _is_uuid_like(project_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid project_id")
                cat = _load_drawing_qr_catalog()
                uploads = cat.get("uploads") or []
                pages = cat.get("pages") or []
                projects = cat.get("projects") or []
                proj = next((p for p in projects if p.get("id") == project_id), None)
                if not proj:
                    raise HTTPException(status_code=404, detail="Project not found")

                upload_ids = [u.get("id") for u in uploads if u.get("project_id") == project_id and u.get("id")]
                upload_set = set(upload_ids)
                upload_order = {uid: idx for idx, uid in enumerate(upload_ids)}
                project_pages = []
                for p in pages:
                    if p.get("upload_id") not in upload_set:
                        continue
                    pid = p.get("id")
                    if not pid:
                        continue
                    project_pages.append(
                        {
                            "page_id": pid,
                            "page_number": p.get("page_number"),
                            "qr_string": p.get("qr_string"),
                            "kind": p.get("kind"),  # production/installation/None
                            "group_id": p.get("group_id"),
                            "dwg_no": p.get("dwg_no"),
                            "file_url": f"/api/drawing-qr/pages/{pid}/file",
                            "image_url": f"/api/drawing-qr/pages/{pid}/image",
                            "_upload_order": upload_order.get(p.get("upload_id"), 10**9),
                        }
                    )
                # 도면 목록: 업로드 순서(프로젝트에 연결된 upload 순) -> 페이지 번호 순
                project_pages.sort(key=lambda x: (x.get("_upload_order") or 10**9, x.get("page_number") or 0))
                for p in project_pages:
                    p.pop("_upload_order", None)
                return {
                    "project": {
                        "project_id": project_id,
                        "name": proj.get("name") or project_id,
                        "created_at": proj.get("created_at"),
                        "upload_count": len(upload_ids),
                        "page_count": len(project_pages),
                    },
                    "drawings": project_pages,
                }

            @self.app.get("/api/drawing-qr/projects/{project_id}/groups")
            async def get_drawing_qr_project_groups(project_id: str):
                """프로젝트 내 그룹 목록(제작/설치/미분류 도면 포함)."""
                if not _is_uuid_like(project_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid project_id")
                cat = _load_drawing_qr_catalog()
                groups = cat.get("groups") or []
                pages = cat.get("pages") or []
                uploads = cat.get("uploads") or []
                upload_ids = [u.get("id") for u in uploads if u.get("project_id") == project_id and u.get("id")]
                upload_set = set(upload_ids)
                pages_in_project = [p for p in pages if p.get("upload_id") in upload_set]

                def enrich_page(p: Dict[str, Any]) -> Dict[str, Any]:
                    pid = p.get("id")
                    if not pid:
                        return p
                    return {
                        **p,
                        "file_url": f"/api/drawing-qr/pages/{pid}/file",
                        "image_url": f"/api/drawing-qr/pages/{pid}/image",
                    }

                out = []
                for g in groups:
                    gid = g.get("id")
                    if not gid:
                        continue
                    prod = [enrich_page(p) for p in pages_in_project if p.get("group_id") == gid and p.get("kind") == "production"]
                    inst = [enrich_page(p) for p in pages_in_project if p.get("group_id") == gid and p.get("kind") == "installation"]
                    unclassified = [enrich_page(p) for p in pages_in_project if p.get("group_id") == gid and p.get("kind") not in ("production", "installation")]
                    if not prod and not inst and not unclassified:
                        continue
                    # 페이지 번호순
                    prod.sort(key=lambda x: x.get("page_number") or 0)
                    inst.sort(key=lambda x: x.get("page_number") or 0)
                    unclassified.sort(key=lambda x: x.get("page_number") or 0)
                    out.append(
                        {
                            "group": g,
                            "production_pages": prod,
                            "installation_pages": inst,
                            "unclassified_pages": unclassified,
                        }
                    )
                out.sort(key=lambda x: (x.get("group") or {}).get("created_at") or "", reverse=True)
                return {"groups": out}

            @self.app.delete("/api/drawing-qr/projects/{project_id}")
            async def delete_drawing_qr_project(project_id: str):
                """프로젝트 삭제(관련 upload/pages/images 정리)."""
                if not _is_uuid_like(project_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid project_id")
                cat = _load_drawing_qr_catalog()
                pages = cat.get("pages") or []
                uploads = cat.get("uploads") or []

                removed_upload_ids = [u.get("id") for u in uploads if u.get("project_id") == project_id and u.get("id")]
                if not removed_upload_ids:
                    # 이미 연관이 없으면 projects에서도 제거
                    cat["projects"] = [p for p in (cat.get("projects") or []) if p.get("id") != project_id]
                    _save_drawing_qr_catalog(cat)
                    return {"status": "success"}

                removed_upload_set = set(removed_upload_ids)

                removed_pages = [p for p in pages if p.get("upload_id") in removed_upload_set]
                removed_page_ids = [p.get("id") for p in removed_pages if p.get("id")]

                if not removed_page_ids:
                    cat["uploads"] = [u for u in uploads if u.get("project_id") != project_id]
                    cat["projects"] = [p for p in (cat.get("projects") or []) if p.get("id") != project_id]
                    _save_drawing_qr_catalog(cat)
                    return {"status": "success"}

                # 1) uploads 제거
                cat["uploads"] = [u for u in uploads if u.get("project_id") != project_id]
                # 2) pages 제거
                cat["pages"] = [p for p in pages if p.get("upload_id") not in removed_upload_set]

                # 3) groups 중 pages가 남아있는 것만 유지
                remaining_group_ids = set(p.get("group_id") for p in cat["pages"] if p.get("group_id"))
                cat["groups"] = [g for g in (cat.get("groups") or []) if g.get("id") in remaining_group_ids]
                cat["projects"] = [p for p in (cat.get("projects") or []) if p.get("id") != project_id]

                _save_drawing_qr_catalog(cat)

                # 4) 파일 정리
                for pid in removed_page_ids:
                    try:
                        pdf_path = _dq_dir / "pages" / f"{pid}.pdf"
                        if pdf_path.exists():
                            pdf_path.unlink()
                    except Exception:
                        pass
                    try:
                        png_path = _dq_images_dir / f"{pid}.png"
                        if png_path.exists():
                            png_path.unlink()
                    except Exception:
                        pass

                return {"status": "success"}

            @self.app.post("/api/drawing-qr/projects/{project_id}/upload")
            async def post_drawing_qr_project_upload(
                project_id: str,
                file: UploadFile = File(...),
                request_id: Optional[str] = Form(None),
                client_id: Optional[str] = Form(None),
            ):
                """특정 프로젝트에 PDF 업로드(여러 파일 지원)."""
                import requests

                if not _is_uuid_like(project_id or ""):
                    raise HTTPException(status_code=400, detail="Invalid project_id")

                cat = _load_drawing_qr_catalog()
                projects = cat.get("projects") or []
                if not any(p.get("id") == project_id for p in projects):
                    raise HTTPException(status_code=404, detail="Project not found")

                rid = (request_id or "").strip() or str(uuid.uuid4())
                orig_name = (file.filename or "upload.pdf").replace("\\", "/").split("/")[-1]
                if not orig_name.lower().endswith(".pdf"):
                    raise HTTPException(status_code=400, detail="PDF만 업로드할 수 있습니다.")

                incoming = _dq_dir / "incoming"
                incoming.mkdir(parents=True, exist_ok=True)
                temp_name = f"{uuid.uuid4()}.pdf"
                temp_path = incoming / temp_name
                try:
                    body = await file.read()
                    max_bytes = int(os.getenv("DRAWING_QR_UPLOAD_MAX_MB", "200")) * 1024 * 1024
                    if len(body) > max_bytes:
                        raise HTTPException(status_code=413, detail="파일이 너무 큽니다.")
                    if len(body) < 8:
                        raise HTTPException(status_code=400, detail="빈 또는 너무 짧은 파일입니다.")
                    temp_path.write_bytes(body)
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

                publish_timeout = int(os.getenv("DRAWING_QR_PUBLISH_TIMEOUT_SEC", "300"))
                upload_id_out: Optional[str] = None
                pages_out: Optional[List[Any]] = None
                try:
                    body = {
                        "type": "DRAWING_QR_PDF_UPLOAD",
                        "payload": {
                            "filename": orig_name,
                            "pdf_temp_relpath": f"incoming/{temp_name}",
                            "request_id": rid,
                            "project_id": project_id,
                        },
                    }
                    if client_id:
                        body["sse_client_ids"] = [str(client_id)]

                    r = requests.post(
                        f"{self.event_bus_url.rstrip('/')}/publish",
                        json=body,
                        timeout=publish_timeout,
                    )
                    r.raise_for_status()

                    # 최근 로그에서 DONE 매칭
                    try:
                        rr = requests.get(
                            f"{self.event_bus_url.rstrip('/')}/api/events/recent",
                            params={"limit": 100},
                            timeout=30,
                        )
                        if rr.status_code == 200:
                            evs = rr.json()
                            if isinstance(evs, list):
                                for ev in reversed(evs):
                                    if ev.get("type") != "DRAWING_QR_PDF_UPLOAD_DONE":
                                        continue
                                    pl = ev.get("payload") or {}
                                    if str(pl.get("request_id") or "") == str(rid):
                                        pages_out = pl.get("pages")
                                        upload_id_out = pl.get("upload_id")
                                        break
                    except Exception:
                        pass
                finally:
                    try:
                        temp_path.unlink(missing_ok=True)
                    except OSError:
                        pass

                # 대용량 업로드는 DONE 이벤트가 늦게 도착할 수 있으므로,
                # 즉시 매칭 실패를 서버 오류로 처리하지 않습니다.
                if not upload_id_out:
                    return {
                        "status": "success",
                        "request_id": rid,
                        "project_id": project_id,
                        "upload_id": None,
                        "pages": None,
                    }

                # 업로드를 프로젝트에 연결(uploads에 project_id 추가)
                cat = _load_drawing_qr_catalog()
                uploads = cat.get("uploads") or []
                for u in uploads:
                    if u.get("id") == upload_id_out:
                        u["project_id"] = project_id
                cat["uploads"] = uploads
                _save_drawing_qr_catalog(cat)

                return {
                    "status": "success",
                    "request_id": rid,
                    "project_id": project_id,
                    "upload_id": upload_id_out,
                    "pages": pages_out,
                }

            @self.app.post("/api/drawing-qr/upload")
            async def post_drawing_qr_upload(
                file: UploadFile = File(...),
                request_id: Optional[str] = Form(None),
                client_id: Optional[str] = Form(None),
                project_id: Optional[str] = Form(None),
            ):
                """
                대용량 도면 PDF는 JSON Base64 대신 multipart로 전달합니다.
                임시 저장 후 DRAWING_QR_PDF_UPLOAD 이벤트로 모듈에 pdf_temp_relpath를 넘깁니다.
                """
                import requests

                rid = (request_id or "").strip() or str(uuid.uuid4())
                orig_name = (file.filename or "upload.pdf").replace("\\", "/").split("/")[-1]
                if not orig_name.lower().endswith(".pdf"):
                    raise HTTPException(status_code=400, detail="PDF만 업로드할 수 있습니다.")

                # project_id가 없으면 자동으로 프로젝트 1개 생성
                cat = _load_drawing_qr_catalog()
                projects = cat.get("projects") or []
                if not isinstance(projects, list):
                    projects = []
                target_project_id = (project_id or "").strip() or None
                if target_project_id:
                    if not _is_uuid_like(target_project_id):
                        raise HTTPException(status_code=400, detail="Invalid project_id")
                    if not any(p.get("id") == target_project_id for p in projects):
                        raise HTTPException(status_code=404, detail="Project not found")
                else:
                    pid = str(uuid.uuid4())
                    base_name = orig_name[:-4] if orig_name.lower().endswith(".pdf") else orig_name
                    projects.append(
                        {
                            "id": pid,
                            "name": base_name.strip() or "프로젝트",
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    cat["projects"] = projects
                    _save_drawing_qr_catalog(cat)
                    target_project_id = pid

                incoming = _dq_dir / "incoming"
                incoming.mkdir(parents=True, exist_ok=True)
                temp_name = f"{uuid.uuid4()}.pdf"
                temp_path = incoming / temp_name
                try:
                    body = await file.read()
                    max_bytes = int(os.getenv("DRAWING_QR_UPLOAD_MAX_MB", "200")) * 1024 * 1024
                    if len(body) > max_bytes:
                        raise HTTPException(status_code=413, detail="파일이 너무 큽니다.")
                    if len(body) < 8:
                        raise HTTPException(status_code=400, detail="빈 또는 너무 짧은 파일입니다.")
                    temp_path.write_bytes(body)
                except HTTPException:
                    raise
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e))

                publish_timeout = int(os.getenv("DRAWING_QR_PUBLISH_TIMEOUT_SEC", "300"))
                try:
                    body = {
                        "type": "DRAWING_QR_PDF_UPLOAD",
                        "payload": {
                            "filename": orig_name,
                            "pdf_temp_relpath": f"incoming/{temp_name}",
                            "request_id": rid,
                            "project_id": target_project_id,
                        },
                    }
                    if client_id:
                        body["sse_client_ids"] = [str(client_id)]

                    r = requests.post(
                        f"{self.event_bus_url.rstrip('/')}/publish",
                        json=body,
                        timeout=publish_timeout,
                    )
                    r.raise_for_status()
                except Exception as e:
                    try:
                        temp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                    raise HTTPException(status_code=500, detail=f"이벤트 발행 실패: {e}")

                # 모듈이 발행한 DRAWING_QR_PDF_UPLOAD_DONE을 이벤트 로그에서 조회해 본문에 실어 보냄.
                # (SSE request_id 매칭 실패·프록시 지연 시에도 업로드 직후 UI가 QR 목록을 갱신하도록)
                pages_out: Optional[List[Any]] = None
                upload_id_out: Optional[str] = None
                try:
                    rr = requests.get(
                        f"{self.event_bus_url.rstrip('/')}/api/events/recent",
                        params={"limit": 100},
                        timeout=30,
                    )
                    if rr.status_code == 200:
                        evs = rr.json()
                        if isinstance(evs, list):
                            for ev in reversed(evs):
                                if ev.get("type") != "DRAWING_QR_PDF_UPLOAD_DONE":
                                    continue
                                pl = ev.get("payload") or {}
                                if str(pl.get("request_id") or "") == str(rid):
                                    pages_out = pl.get("pages")
                                    upload_id_out = pl.get("upload_id")
                                    break
                except Exception:
                    pass

                # 대용량 업로드는 DONE 이벤트가 늦게 도착할 수 있으므로,
                # 즉시 매칭 실패를 서버 오류로 처리하지 않습니다.
                if not upload_id_out:
                    return {
                        "status": "success",
                        "request_id": rid,
                        "upload_id": None,
                        "project_id": target_project_id,
                        "pages": None,
                    }

                # 업로드를 프로젝트에 연결(uploads에 project_id 추가)
                cat = _load_drawing_qr_catalog()
                uploads = cat.get("uploads") or []
                for u in uploads:
                    if u.get("id") == upload_id_out:
                        u["project_id"] = target_project_id
                cat["uploads"] = uploads
                _save_drawing_qr_catalog(cat)

                return {
                    "status": "success",
                    "request_id": rid,
                    "upload_id": upload_id_out,
                    "project_id": target_project_id,
                    "pages": pages_out,
                }

        @self.app.get("/api/events/stream")
        async def stream_events(request: Request):
            """SSE: 이벤트 버스 SSE 스트림을 프록시 (이벤트 발생 시 즉시 푸시). 쿼리(client_id, targeted_only 등) 전달."""
            event_bus_url = self.event_bus_url.rstrip("/")
            try:
                import aiohttp
            except ImportError:
                import requests
                # aiohttp 없으면 기존 폴링 방식 폴백
                recent_url = f"{event_bus_url}/api/events/recent"

                async def fallback_generator():
                    last_event_id: Optional[str] = None
                    poll_interval = 0.5
                    while True:
                        try:
                            params = {"limit": 50}
                            if last_event_id:
                                params["since_event_id"] = last_event_id
                            resp = await asyncio.to_thread(
                                requests.get,
                                recent_url,
                                params=params,
                                timeout=10,
                            )
                            if resp.status_code == 200:
                                events = resp.json()
                                if not events:
                                    yield ": keep-alive\n\n"
                                for ev in events:
                                    payload = json.dumps(ev, ensure_ascii=False)
                                    yield f"data: {payload}\n\n"
                                    last_event_id = ev.get("event_id") or last_event_id
                        except Exception as e:
                            print(f"[UI Server] ERROR: {e}")
                        await asyncio.sleep(poll_interval)

                return StreamingResponse(
                    fallback_generator(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        "X-Accel-Buffering": "no",
                    },
                )

            q = request.url.query
            stream_url = f"{event_bus_url}/api/events/stream" + (f"?{q}" if q else "")

            async def proxy_generator():
                async with aiohttp.ClientSession() as session:
                    try:
                        async with session.get(
                            stream_url,
                            timeout=aiohttp.ClientTimeout(total=None, sock_read=60),
                        ) as resp:
                            if resp.status != 200:
                                yield f"data: {json.dumps({'error': 'stream failed', 'status': resp.status}, ensure_ascii=False)}\n\n"
                                return
                            async for chunk in resp.content.iter_chunked(8192):
                                if chunk:
                                    yield chunk.decode("utf-8", errors="replace")
                    except asyncio.CancelledError:
                        raise
                    except Exception as e:
                        print(f"[UI Server] SSE proxy error: {e}")
                        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

            return StreamingResponse(
                proxy_generator(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

    def _get_index_html(self) -> str:
        if not self.service_def:
            return "<html><body>Service not found</body></html>"
        m = self.service_def.metadata
        name = m.name
        sid = m.id
        # YAML interface: 기준 링크 목록
        iface_links = ""
        if self.service_def.interfaces:
            iface_links = "<h3>인터페이스 (YAML interface:)</h3><ul>"
            for iface in self.service_def.interfaces:
                mid = iface.id or iface.type
                url = f"/static/{mid}/" if iface.binding else "#"
                label = iface.label or mid or "(unnamed)"
                iface_links += f'<li><a href="{url}">{label}</a> ({iface.type})</li>'
            iface_links += "</ul>"
        return f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{name}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }}
        .container {{ max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        h1 {{ color: #333; margin-bottom: 10px; }}
        .service-id {{ color: #666; font-size: 14px; margin-bottom: 30px; }}
        .api-info {{ background: #f9f9f9; padding: 15px; border-radius: 4px; margin-top: 20px; }}
        .api-endpoint {{ font-family: monospace; color: #0066cc; margin: 5px 0; }}
        ul {{ margin: 10px 0; }} ul li {{ margin: 5px 0; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{name}</h1>
        <div class="service-id">Service ID: {sid}</div>
        <p>이 서비스의 UI는 YAML <code>interface:</code> 정의를 기준으로 서빙됩니다.</p>
        {iface_links}
        <div class="api-info">
            <h3>API 엔드포인트</h3>
            <div class="api-endpoint">GET /api/service - 서비스 정보</div>
            <div class="api-endpoint">GET /api/interfaces - 인터페이스 정의 (YAML interface)</div>
            <div class="api-endpoint">GET /api/config - 설정 스키마 및 값</div>
            <div class="api-endpoint">POST /api/config - 설정 업데이트</div>
            <div class="api-endpoint">POST /api/events/publish - 이벤트 발행</div>
        </div>
    </div>
</body>
</html>"""


def create_ui_server(
    service_id: str,
    services_dir: str,
    event_bus_url: str = "http://localhost:8000",
    port: int = 0,
    use_frontend_dev: bool = False,
    frontend_dev_port: Optional[int] = None,
) -> ServiceUIServer:
    """UI 서버 생성 및 실행 (uvicorn)"""
    import uvicorn
    import socket

    server = ServiceUIServer(
        service_id,
        Path(services_dir),
        event_bus_url,
        use_frontend_dev=use_frontend_dev,
        frontend_dev_port=frontend_dev_port,
    )

    if port == 0:
        # 자동 포트 할당
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            port = s.getsockname()[1]
    else:
        # 지정 포트가 사용 중이면 OS에 빈 포트를 받아 자동 전환
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("0.0.0.0", port))
        except OSError as e:
            print(f"⚠️  포트 {port}가 이미 사용 중입니다. ({e.strerror})")
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s2:
                s2.bind(("", 0))
                port = s2.getsockname()[1]
            print(f"✅ 포트 {port}로 변경되었습니다.")

    # Vite 등 로컬 프록시가 실제 바인딩 포트를 알 수 있도록 서비스 폴더에 기록
    try:
        sd = (
            server.service_def.service_dir
            if server.service_def and getattr(server.service_def, "service_dir", None)
            else None
        )
        print(f"sd: {sd}")
        if sd:
            port_file = Path(sd) / ".ui-server-port"
            port_file.write_text(f"{port}\n", encoding="utf-8")
            print(f"📝 Vite 프록시용 포트 기록: {port_file} → {port}")
    except OSError as werr:
        print(f"⚠️  .ui-server-port 기록 실패: {werr}")

    print(f"🚀 UI 서버 시작: http://0.0.0.0:{port}")
    uvicorn.run(server.app, host="0.0.0.0", port=port)
    return server
