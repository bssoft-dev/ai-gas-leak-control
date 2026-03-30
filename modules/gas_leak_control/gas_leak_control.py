"""
AI 가스 누출 자동제어 모듈
- GAS_LEAK_EMERGENCY_STOP: 비상 밸브 차단
- GAS_LEAK_VALVE_RESET: 밸브 수동 해제
- GAS_LEAK_STATUS_QUERY: 구역/센서/시계열 상태 조회
- Rule-base: 농도 3% 이상 시 즉시 차단, AI 오차율 3초 이상 초과 시 Critical 판정
"""
from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 데이터 디렉터리 (프로젝트 루트 기준 data/ai_gas_leak)
def _data_dir() -> Path:
    base = os.getenv("AI_GAS_LEAK_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    project_root = mod_dir.parent.parent
    return project_root / "data" / "ai_gas_leak"


def _state_path() -> Path:
    p = _data_dir() / "state.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _sensors_path() -> Path:
    return _data_dir() / "sensors.json"


def _timeseries_path() -> Path:
    return _data_dir() / "timeseries.json"


def _ai_history_path() -> Path:
    return _data_dir() / "ai_history.json"


def _control_history_path() -> Path:
    return _data_dir() / "control_history.json"


def _daily_usage_path() -> Path:
    return _data_dir() / "daily_usage.json"


MAX_AI_HISTORY = 500
MAX_CONTROL_HISTORY = 500


def _default_policy() -> Dict[str, Any]:
    return {
        "level1_warning_pct": 1.5,
        "level2_siren_pct": 2.5,
        "level3_valve_pct": 3.0,
        "grace_seconds": 3,
    }


def _bump_daily_usage_liters(liters_increment: float) -> None:
    """유량(L/min) 기준 금일 누적 사용량(추정, L)."""
    path = _daily_usage_path()
    today = datetime.utcnow().strftime("%Y-%m-%d")
    doc = _load_json(path, {"date": today, "cumulative_liters": 0.0})
    if doc.get("date") != today:
        doc = {"date": today, "cumulative_liters": 0.0}
    try:
        doc["cumulative_liters"] = float(doc.get("cumulative_liters", 0)) + float(liters_increment)
    except (TypeError, ValueError):
        doc["cumulative_liters"] = float(liters_increment)
    _save_json(path, doc)


def _append_control_history(entry: Dict[str, Any]) -> None:
    path = _control_history_path()
    data = _load_json(path, [])
    if not isinstance(data, list):
        data = []
    data.append(entry)
    if len(data) > MAX_CONTROL_HISTORY:
        data = data[-MAX_CONTROL_HISTORY:]
    _save_json(path, data)


def _append_ai_history(entry: Dict[str, Any]) -> None:
    """AI 판단 이력 추가 (시각, 유형, 메시지, 센서/값 등)."""
    path = _ai_history_path()
    data = _load_json(path, [])
    if not isinstance(data, list):
        data = []
    data.append(entry)
    if len(data) > MAX_AI_HISTORY:
        data = data[-MAX_AI_HISTORY:]
    _save_json(path, data)


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


# 시계열 최대 포인트 수 (실시간 차트용)
MAX_SERIES_POINTS = 120


def _append_timeseries(ts_path: Path, pressure: float, flow: float) -> None:
    data = _load_json(ts_path, {"pressure": [], "flow": [], "sensors": {}})
    now = datetime.utcnow().isoformat() + "Z"
    data["pressure"] = (data.get("pressure") or []) + [{"t": now, "v": pressure}]
    data["flow"] = (data.get("flow") or []) + [{"t": now, "v": flow}]
    for key in ("pressure", "flow"):
        arr = data.get(key) or []
        if len(arr) > MAX_SERIES_POINTS:
            data[key] = arr[-MAX_SERIES_POINTS:]
    _save_json(ts_path, data)


def _append_sensors_timeseries(ts_path: Path, sensor_values: Dict[str, float]) -> None:
    """센서별 시계열 한 번에 추가 (sensor_id -> value)."""
    if not sensor_values:
        return
    data = _load_json(ts_path, {"pressure": [], "flow": [], "sensors": {}})
    if "sensors" not in data or not isinstance(data["sensors"], dict):
        data["sensors"] = {}
    now = datetime.utcnow().isoformat() + "Z"
    for sid, val in sensor_values.items():
        data["sensors"].setdefault(sid, [])
        data["sensors"][sid] = (data["sensors"][sid] or []) + [{"t": now, "v": val}]
        if len(data["sensors"][sid]) > MAX_SERIES_POINTS:
            data["sensors"][sid] = data["sensors"][sid][-MAX_SERIES_POINTS:]
    _save_json(ts_path, data)


class GasLeakControlModule(Module):
    """가스 누출 제어: 비상 차단, 밸브 리셋, 상태 조회"""

    name = "M_GasLeakControl"
    description = "AI 가스 누출 자동제어 (Rule/AI 하이브리드, 밸브 제어)"
    capabilities = [
        "GAS_LEAK_EMERGENCY_STOP",
        "GAS_LEAK_VALVE_RESET",
        "GAS_LEAK_STATUS_QUERY",
        "GAS_LEAK_MES_STATUS",
        "GAS_LEAK_ALARM_CONTROL",
        "GAS_LEAK_CALL_MANAGER",
        "GAS_LEAK_POLICY_SAVE",
        "GAS_LEAK_CANCEL_AUTO_SHUTDOWN",
    ]

    def __init__(self):
        super().__init__()
        self._simulator_running = False
        self._simulator_thread: threading.Thread | None = None

    def can_handle(self, event: Event) -> float:
        if event.type in (
            "GAS_LEAK_EMERGENCY_STOP",
            "GAS_LEAK_VALVE_RESET",
            "GAS_LEAK_STATUS_QUERY",
            "GAS_LEAK_MES_STATUS",
            "GAS_LEAK_ALARM_CONTROL",
            "GAS_LEAK_CALL_MANAGER",
            "GAS_LEAK_POLICY_SAVE",
            "GAS_LEAK_CANCEL_AUTO_SHUTDOWN",
        ):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "GAS_LEAK_EMERGENCY_STOP":
            return self._handle_emergency_stop(event)
        if event.type == "GAS_LEAK_VALVE_RESET":
            return self._handle_valve_reset(event)
        if event.type == "GAS_LEAK_STATUS_QUERY":
            return self._handle_status_query(event)
        if event.type == "GAS_LEAK_MES_STATUS":
            return self._handle_mes_status(event)
        if event.type == "GAS_LEAK_ALARM_CONTROL":
            return self._handle_alarm_control(event)
        if event.type == "GAS_LEAK_CALL_MANAGER":
            return self._handle_call_manager(event)
        if event.type == "GAS_LEAK_POLICY_SAVE":
            return self._handle_policy_save(event)
        if event.type == "GAS_LEAK_CANCEL_AUTO_SHUTDOWN":
            return self._handle_cancel_auto_shutdown(event)
        return []

    def _handle_emergency_stop(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        zone_id = payload.get("zone_id")
        reason = payload.get("reason", "manual")

        state = _load_json(
            _state_path(),
            {"valve_closed": False, "zones": [], "emergency_at": None, "last_control": None, "alarm_beacon_on": False, "alarm_siren_on": False},
        )
        now = datetime.utcnow().isoformat() + "Z"
        state["valve_closed"] = True
        state["emergency_at"] = now
        state["last_control"] = "emergency_stop"
        state["alarm_beacon_on"] = True
        state["alarm_siren_on"] = True

        zones = state.get("zones") or []
        for z in zones:
            if zone_id and z.get("id") == zone_id:
                z["status"] = "critical"
            elif not zone_id:
                z["status"] = "critical"
        state["zones"] = zones
        _save_json(_state_path(), state)
        _append_ai_history({
            "at": now,
            "type": "emergency_stop",
            "message": "비상 밸브 차단",
            "reason": reason,
            "zone_id": zone_id,
        })
        _append_ai_history({
            "at": now,
            "type": "call_manager",
            "message": "관리자 호출 요청됨 (비상 차단)",
        })
        _append_control_history({"at": now, "action": "emergency_stop", "detail": f"수동 비상 차단 ({reason})", "level": 3})

        return [
            Event(
                type="GAS_LEAK_EMERGENCY_STOP_RESULT",
                payload={
                    "success": True,
                    "valve_closed": True,
                    "at": now,
                    "zone_id": zone_id,
                    "reason": reason,
                },
                source_module=self.name,
            )
        ]

    def _handle_valve_reset(self, event: Event) -> List[Event]:
        state = _load_json(
            _state_path(),
            {"valve_closed": True, "zones": [], "emergency_at": None, "last_control": None, "alarm_beacon_on": True, "alarm_siren_on": True},
        )
        now = datetime.utcnow().isoformat() + "Z"
        state["valve_closed"] = False
        state["last_control"] = "valve_reset"
        state["alarm_beacon_on"] = False
        state["alarm_siren_on"] = False
        zones = state.get("zones") or []
        for z in zones:
            z["status"] = "normal"
        state["zones"] = zones
        _save_json(_state_path(), state)
        _append_ai_history({
            "at": now,
            "type": "valve_reset",
            "message": "밸브 수동 해제",
        })
        _append_control_history({"at": now, "action": "valve_reset", "detail": "밸브 수동 해제", "level": 0})

        return [
            Event(
                type="GAS_LEAK_VALVE_RESET_RESULT",
                payload={"success": True, "valve_closed": False, "at": now},
                source_module=self.name,
            )
        ]

    def _handle_status_query(self, event: Event) -> List[Event]:
        state = _load_json(_state_path(), {"valve_closed": False, "zones": [], "emergency_at": None})
        sensors = _load_json(_sensors_path(), [])
        timeseries = _load_json(_timeseries_path(), {"pressure": [], "flow": [], "sensors": {}})
        return [
            Event(
                type="GAS_LEAK_STATUS_RESULT",
                payload={
                    "state": state,
                    "sensors": sensors,
                    "timeseries": timeseries,
                },
                source_module=self.name,
            )
        ]

    def _handle_mes_status(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        equipment_running = payload.get("equipment_running", True)
        work_order_id = payload.get("work_order_id") or payload.get("work_order")
        state = _load_json(_state_path(), {"valve_closed": False, "zones": [], "mes_equipment_running": True, "mes_work_order_id": None, "mes_updated_at": None})
        now = datetime.utcnow().isoformat() + "Z"
        state["mes_equipment_running"] = bool(equipment_running)
        state["mes_work_order_id"] = work_order_id
        state["mes_updated_at"] = now
        _save_json(_state_path(), state)
        return [
            Event(
                type="GAS_LEAK_MES_STATUS_RESULT",
                payload={"success": True, "equipment_running": state["mes_equipment_running"], "at": now},
                source_module=self.name,
            )
        ]

    def _handle_alarm_control(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        beacon_on = payload.get("beacon_on") if "beacon_on" in payload else payload.get("alarm_beacon_on")
        siren_on = payload.get("siren_on") if "siren_on" in payload else payload.get("alarm_siren_on")
        state = _load_json(_state_path(), {"alarm_beacon_on": False, "alarm_siren_on": False})
        now = datetime.utcnow().isoformat() + "Z"
        if beacon_on is not None:
            state["alarm_beacon_on"] = bool(beacon_on)
        if siren_on is not None:
            state["alarm_siren_on"] = bool(siren_on)
        _save_json(_state_path(), state)
        return [
            Event(
                type="GAS_LEAK_ALARM_CONTROL_RESULT",
                payload={"success": True, "alarm_beacon_on": state.get("alarm_beacon_on"), "alarm_siren_on": state.get("alarm_siren_on"), "at": now},
                source_module=self.name,
            )
        ]

    def _handle_call_manager(self, event: Event) -> List[Event]:
        now = datetime.utcnow().isoformat() + "Z"
        _append_ai_history({
            "at": now,
            "type": "call_manager",
            "message": "관리자 호출",
        })
        return [
            Event(
                type="GAS_LEAK_CALL_MANAGER_RESULT",
                payload={"success": True, "at": now},
                source_module=self.name,
            )
        ]

    def _handle_policy_save(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        state = _load_json(
            _state_path(),
            {
                "valve_closed": False,
                "zones": [],
                "policy": _default_policy(),
                "auto_shutdown_deadline": None,
                "risk_level": 0,
            },
        )
        pol = dict(state.get("policy") or _default_policy())
        for key in ("level1_warning_pct", "level2_siren_pct", "level3_valve_pct", "grace_seconds"):
            if key in payload and payload[key] is not None:
                try:
                    pol[key] = float(payload[key]) if key != "grace_seconds" else int(float(payload[key]))
                except (TypeError, ValueError):
                    pass
        pol["level1_warning_pct"] = max(0.0, min(100.0, float(pol.get("level1_warning_pct", 1.5))))
        pol["level2_siren_pct"] = max(0.0, min(100.0, float(pol.get("level2_siren_pct", 2.5))))
        pol["level3_valve_pct"] = max(0.0, min(100.0, float(pol.get("level3_valve_pct", 3.0))))
        pol["grace_seconds"] = max(0, min(3600, int(pol.get("grace_seconds", 3))))
        if pol["level1_warning_pct"] > pol["level2_siren_pct"]:
            pol["level2_siren_pct"] = pol["level1_warning_pct"]
        if pol["level2_siren_pct"] > pol["level3_valve_pct"]:
            pol["level3_valve_pct"] = pol["level2_siren_pct"]
        now = datetime.utcnow().isoformat() + "Z"
        state["policy"] = pol
        _save_json(_state_path(), state)
        _append_control_history({"at": now, "action": "policy_save", "detail": "정책/임계치 저장", "level": 0})
        return [
            Event(
                type="GAS_LEAK_POLICY_SAVE_RESULT",
                payload={"success": True, "policy": pol, "at": now},
                source_module=self.name,
            )
        ]

    def _handle_cancel_auto_shutdown(self, event: Event) -> List[Event]:
        state = _load_json(_state_path(), {"auto_shutdown_deadline": None})
        now = datetime.utcnow().isoformat() + "Z"
        state["auto_shutdown_deadline"] = None
        _save_json(_state_path(), state)
        _append_control_history({"at": now, "action": "cancel_auto_shutdown", "detail": "자동 차단 유예 취소", "level": 0})
        return [
            Event(
                type="GAS_LEAK_CANCEL_AUTO_SHUTDOWN_RESULT",
                payload={"success": True, "at": now},
                source_module=self.name,
            )
        ]

    def run(
        self,
        event_bus_url: str = "http://localhost:8000",
        service_url: str = "http://localhost:8000",
        poll_interval: int = 5,
        use_push: bool = True,
    ):
        """모듈 실행 시 시계열 시뮬레이터 시작 (1초 주기 데이터 생성)"""
        self._start_simulator()
        super().run(
            event_bus_url=event_bus_url,
            service_url=service_url,
            poll_interval=poll_interval,
            use_push=use_push,
        )

    def _start_simulator(self) -> None:
        if self._simulator_running:
            return
        self._simulator_running = True
        self._simulator_thread = threading.Thread(target=self._simulator_loop, daemon=True)
        self._simulator_thread.start()

    def _simulator_loop(self) -> None:
        import random
        base_pressure = 0.40
        base_flow = 12.0
        base_concentration = 1.0
        last_logged_risk = -1
        while self._simulator_running:
            try:
                state = _load_json(_state_path(), {})
                if state.get("valve_closed"):
                    time.sleep(1)
                    continue
                pol = dict(state.get("policy") or _default_policy())
                l1 = float(pol.get("level1_warning_pct", 1.5))
                l2 = float(pol.get("level2_siren_pct", 2.5))
                l3 = float(pol.get("level3_valve_pct", 3.0))
                grace = int(pol.get("grace_seconds", 3))
                mes_running = state.get("mes_equipment_running", True)
                pressure = base_pressure + random.uniform(-0.02, 0.02)
                flow = base_flow + random.uniform(-0.5, 0.5)
                concentration = base_concentration + random.uniform(-0.5, 0.5)
                concentration = max(0.0, min(5.0, round(concentration, 2)))
                _append_timeseries(_timeseries_path(), round(pressure, 4), round(flow, 2))
                _bump_daily_usage_liters(max(0.0, flow) / 60.0)
                sensors = _load_json(_sensors_path(), [])
                ts_path = _timeseries_path()
                sensor_series: Dict[str, float] = {}
                max_conc = 0.0
                for s in sensors:
                    sid = s.get("id")
                    st = s.get("sensor_type") or ""
                    if "압력" in s.get("label", "") or st == "pressure":
                        val = round(pressure + random.uniform(-0.01, 0.01), 3)
                        s["value"] = val
                    elif st == "concentration":
                        val = round(concentration + random.uniform(-0.1, 0.1), 2)
                        val = max(0.0, min(10.0, val))
                        s["value"] = val
                        max_conc = max(max_conc, val)
                    else:
                        val = round(flow + random.uniform(-0.2, 0.2), 2)
                        s["value"] = val
                    if sid:
                        sensor_series[sid] = s["value"]
                    if st == "pressure" and val > 0.45:
                        _append_ai_history({
                            "at": datetime.utcnow().isoformat() + "Z",
                            "type": "anomaly_detected",
                            "message": "압력 이상치 감지",
                            "sensor_id": sid,
                            "sensor_label": s.get("label"),
                            "value": val,
                            "unit": s.get("unit", "MPa"),
                        })
                    elif st == "flow" and val > 13.5:
                        _append_ai_history({
                            "at": datetime.utcnow().isoformat() + "Z",
                            "type": "anomaly_detected",
                            "message": "유량 이상치 감지",
                            "sensor_id": sid,
                            "sensor_label": s.get("label"),
                            "value": val,
                            "unit": s.get("unit", "L/min"),
                        })
                    elif st == "concentration" and val >= l3:
                        _append_ai_history({
                            "at": datetime.utcnow().isoformat() + "Z",
                            "type": "anomaly_detected",
                            "message": f"가스 농도 {l3}% 이상 — Level3(위험)",
                            "sensor_id": sid,
                            "sensor_label": s.get("label"),
                            "value": val,
                            "unit": s.get("unit", "%"),
                        })
                    if not mes_running and (st == "flow" and val > 0.5 or st == "pressure" and val > 0.1 or st == "concentration" and val > 0.5):
                        _append_ai_history({
                            "at": datetime.utcnow().isoformat() + "Z",
                            "type": "anomaly_detected",
                            "message": "비가동 중 가스 유입 감지 (오탐지 방지 로직)",
                            "sensor_id": sid,
                            "sensor_label": s.get("label"),
                            "value": val,
                            "unit": s.get("unit", ""),
                        })
                _append_sensors_timeseries(ts_path, sensor_series)
                _save_json(_sensors_path(), sensors)

                if not any((s.get("sensor_type") == "concentration") for s in sensors):
                    max_conc = concentration

                risk = 0
                if max_conc >= l3:
                    risk = 3
                elif max_conc >= l2:
                    risk = 2
                elif max_conc >= l1:
                    risk = 1

                state = _load_json(
                    _state_path(),
                    {"policy": _default_policy(), "zones": [], "auto_shutdown_deadline": None, "risk_level": 0},
                )
                now = datetime.utcnow()
                now_iso = now.isoformat() + "Z"
                zones = state.get("zones") or []
                if not zones:
                    zones = [
                        {"id": "zone1", "name": "Zone 1", "status": "normal", "x": 20, "y": 30},
                        {"id": "zone2", "name": "Zone 2", "status": "normal", "x": 50, "y": 30},
                        {"id": "zone3", "name": "Zone 3", "status": "normal", "x": 80, "y": 30},
                    ]
                st_z = "normal"
                if risk == 1:
                    st_z = "warning"
                elif risk >= 2:
                    st_z = "critical"
                for z in zones:
                    z["status"] = st_z
                state["zones"] = zones
                state["risk_level"] = risk

                if risk < 3:
                    state["auto_shutdown_deadline"] = None

                if risk >= 2:
                    state["alarm_beacon_on"] = True
                    state["alarm_siren_on"] = True
                elif risk == 1:
                    state["alarm_beacon_on"] = True
                    state["alarm_siren_on"] = False
                else:
                    state["alarm_beacon_on"] = False
                    state["alarm_siren_on"] = False

                if last_logged_risk != risk and risk >= 1:
                    _append_control_history({
                        "at": now_iso,
                        "action": "risk_level",
                        "detail": f"가스 농도 단계 {risk} (최대 {max_conc:.2f}%)",
                        "level": risk,
                    })
                last_logged_risk = risk

                trigger_valve = False
                if risk >= 3 and max_conc >= l3:
                    if grace <= 0:
                        trigger_valve = True
                    else:
                        dl = state.get("auto_shutdown_deadline")
                        if not dl:
                            deadline = now + timedelta(seconds=grace)
                            state["auto_shutdown_deadline"] = deadline.isoformat() + "Z"
                            _append_control_history({
                                "at": now_iso,
                                "action": "grace_started",
                                "detail": f"Level3 유예 {grace}초 후 자동 차단 예정",
                                "level": 3,
                            })
                        else:
                            try:
                                raw = str(dl).replace("Z", "").split("+")[0]
                                ddl = datetime.fromisoformat(raw)
                                if now >= ddl:
                                    trigger_valve = True
                            except Exception:
                                trigger_valve = True

                if trigger_valve:
                    state["valve_closed"] = True
                    state["emergency_at"] = now_iso
                    state["last_control"] = "rule_concentration"
                    state["alarm_beacon_on"] = True
                    state["alarm_siren_on"] = True
                    state["auto_shutdown_deadline"] = None
                    _save_json(_state_path(), state)
                    _append_ai_history({
                        "at": now_iso,
                        "type": "emergency_stop",
                        "message": f"가스 농도 Level3 ({l3}%) — 자동 밸브 차단",
                        "reason": "rule_concentration",
                    })
                    _append_ai_history({
                        "at": now_iso,
                        "type": "call_manager",
                        "message": "관리자 호출 요청됨 (농도 기준 차단)",
                    })
                    _append_control_history({"at": now_iso, "action": "auto_valve_close", "detail": "정책 기준 자동 밸브 차단", "level": 3})
                else:
                    _save_json(_state_path(), state)
            except Exception:
                pass
            time.sleep(1)
