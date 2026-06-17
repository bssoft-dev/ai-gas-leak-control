"""엣지 로컬 제어 HTTP (포트 26030) — 서버 릴레이 대상."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, Optional

HandlerFactory = Callable[[str, Dict], None]


class _EdgeHandler(BaseHTTPRequestHandler):
    _dispatch: Optional[HandlerFactory] = None

    def log_message(self, format, *args):
        pass

    def _read_json(self) -> Dict:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def _json_response(self, code: int, body: Dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = self.path.split("?")[0]
        payload = self._read_json()
        routes = {
            "/api/control/emergency-stop": "GAS_LEAK_EMERGENCY_STOP",
            "/api/control/valve-reset": "GAS_LEAK_VALVE_RESET",
            "/api/control/alarm": "GAS_LEAK_ALARM_CONTROL",
            "/api/control/policy-save": "GAS_LEAK_POLICY_SAVE",
            "/api/control/cancel-auto-shutdown": "GAS_LEAK_CANCEL_AUTO_SHUTDOWN",
        }
        event_type = routes.get(path)
        if not event_type or not self._dispatch:
            self._json_response(404, {"success": False, "error": "not_found"})
            return
        try:
            self._dispatch(event_type, payload)
            self._json_response(200, {"success": True})
        except Exception as e:
            self._json_response(500, {"success": False, "error": str(e)})


def start_edge_http(port: int, dispatch: HandlerFactory) -> ThreadingHTTPServer:
    _EdgeHandler._dispatch = dispatch
    server = ThreadingHTTPServer(("0.0.0.0", port), _EdgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
