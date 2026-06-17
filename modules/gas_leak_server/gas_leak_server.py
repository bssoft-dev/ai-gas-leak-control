import json
import os
import requests
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

def _data_dir() -> Path:
    base = os.getenv("AI_GAS_LEAK_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "ai_gas_leak"

def _registry_path() -> Path:
    p = _data_dir() / "edge_registry.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p

def _state_path() -> Path:
    return _data_dir() / "state.json"

def _sensors_path() -> Path:
    return _data_dir() / "sensors.json"

def _timeseries_path() -> Path:
    return _data_dir() / "timeseries.json"

def _ai_history_path() -> Path:
    return _data_dir() / "ai_history.json"

def _load_json(path: Path, default: Any) -> Any:
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return default

def _save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

MAX_AI_HISTORY = 500

class GasLeakServerModule(Module):
    """서버 노드: 엣지 등록 관리, 데이터 동기화 수신, 제어 명령 릴레이"""
    name = "M_GasLeakServer"
    description = "AI 가스 누출 엣지 연동 서버 모듈"
    
    def can_handle(self, event: Event) -> float:
        if event.type in (
            "GAS_LEAK_EDGE_REGISTER",
            "GAS_LEAK_SYNC_STATE",
            "GAS_LEAK_SYNC_LOG",
            "GAS_LEAK_EMERGENCY_STOP",
            "GAS_LEAK_VALVE_RESET",
            "GAS_LEAK_ALARM_CONTROL",
            "GAS_LEAK_POLICY_SAVE",
            "GAS_LEAK_CANCEL_AUTO_SHUTDOWN",
        ):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "GAS_LEAK_EDGE_REGISTER":
            return self._handle_edge_register(event)
        if event.type == "GAS_LEAK_SYNC_STATE":
            return self._handle_sync_state(event)
        if event.type == "GAS_LEAK_SYNC_LOG":
            return self._handle_sync_log(event)
        # 제어 명령 릴레이
        if event.type in ("GAS_LEAK_EMERGENCY_STOP", "GAS_LEAK_VALVE_RESET", "GAS_LEAK_ALARM_CONTROL", "GAS_LEAK_POLICY_SAVE", "GAS_LEAK_CANCEL_AUTO_SHUTDOWN"):
            return self._relay_command_to_edge(event)
        return []

    def _handle_edge_register(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        edge_id = payload.get("edge_id", "default")
        ip = payload.get("ip")
        port = payload.get("port", 26030)
        
        registry = _load_json(_registry_path(), {})
        registry[edge_id] = {
            "ip": ip,
            "port": port,
            "registered_at": datetime.utcnow().isoformat() + "Z"
        }
        _save_json(_registry_path(), registry)
        print(f"[Server] Edge registered: {edge_id} -> {ip}:{port}")
        return []

    def _handle_sync_state(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        if "state" in payload:
            _save_json(_state_path(), payload["state"])
        if "sensors" in payload:
            _save_json(_sensors_path(), payload["sensors"])
        if "timeseries" in payload:
            _save_json(_timeseries_path(), payload["timeseries"])
        return []

    def _handle_sync_log(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        log_entry = payload.get("log")
        if not log_entry:
            return []
            
        history = _load_json(_ai_history_path(), [])
        if not isinstance(history, list):
            history = []
        history.append(log_entry)
        if len(history) > MAX_AI_HISTORY:
            history = history[-MAX_AI_HISTORY:]
        _save_json(_ai_history_path(), history)
        return []

    def _relay_command_to_edge(self, event: Event) -> List[Event]:
        registry = _load_json(_registry_path(), {})
        edge_id = event.payload.get("edge_id", "default") if event.payload else "default"
        
        # 기본적으로 첫 번째 등록된 엣지 또는 지정된 엣지로 명령을 보냅니다.
        if edge_id not in registry and registry:
            edge_id = list(registry.keys())[0]
            
        edge_info = registry.get(edge_id)
        if not edge_info or not edge_info.get("ip"):
            print(f"[Server] No valid IP for edge '{edge_id}'. Cannot relay command {event.type}.")
            return []
            
        ip = edge_info["ip"]
        port = edge_info.get("port", 26030)
        
        endpoint_map = {
            "GAS_LEAK_EMERGENCY_STOP": "/api/control/emergency-stop",
            "GAS_LEAK_VALVE_RESET": "/api/control/valve-reset",
            "GAS_LEAK_ALARM_CONTROL": "/api/control/alarm",
            "GAS_LEAK_POLICY_SAVE": "/api/control/policy-save",
            "GAS_LEAK_CANCEL_AUTO_SHUTDOWN": "/api/control/cancel-auto-shutdown"
        }
        
        path = endpoint_map.get(event.type)
        if not path:
            return []
            
        url = f"http://{ip}:{port}{path}"
        try:
            res = requests.post(url, json=event.payload or {}, timeout=3)
            print(f"[Server] Relayed {event.type} to {url} - Status: {res.status_code}")
            
            # 엣지에서 성공적으로 처리했다면, UI에 성공 결과를 반환하기 위해 이벤트를 발생시킵니다.
            result_event_type = event.type + "_RESULT"
            return [
                Event(
                    type=result_event_type,
                    payload={"success": res.status_code == 200, "relay": True, "edge_id": edge_id},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            print(f"[Server] Failed to relay {event.type} to {url}: {e}")
            return [
                Event(
                    type=event.type + "_RESULT",
                    payload={"success": False, "error": str(e)},
                    source_module=self.name,
                )
            ]
