"""
AI 가스 누출 자동제어 모듈
- 3단계 위험(주의/사이렌/차단) + 유예(grace)
- Rule·AI 하이브리드, raw 저장·전처리·Data Mart
"""
from __future__ import annotations

import os
import random
import sys
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

import yaml

sys.path.append(os.path.dirname(__file__))
from ai_model import GasLeakAIModel
from edge_http import start_edge_http
from gas_leak_data import (
    append_ai_history,
    append_alarm_history,
    append_control_history,
    append_raw_tick,
    build_data_mart_snapshot,
    bump_daily_usage,
    data_dir,
    default_policy,
    load_json,
    path,
    preprocess_sample,
    save_json,
    utc_now,
)

from SagoHub.core.event import Event
from SagoHub.core.module import Module

MAX_SERIES_POINTS = 120
EDGE_HTTP_PORT = int(os.getenv("GAS_LEAK_EDGE_HTTP_PORT", "26030"))


def _state_path() -> Path:
    return path("state.json")


def _sensors_path() -> Path:
    return path("sensors.json")


def _timeseries_path() -> Path:
    return path("timeseries.json")


def _default_state() -> Dict[str, Any]:
    return {
        "valve_closed": False,
        "zones": [],
        "emergency_at": None,
        "last_control": None,
        "alarm_beacon_on": False,
        "alarm_siren_on": False,
        "mes_equipment_running": True,
        "mes_work_order_id": None,
        "mes_updated_at": None,
        "risk_level": 0,
        "risk_message": None,
        "policy": default_policy(),
        "auto_shutdown_deadline": None,
        "auto_shutdown_cancelled": False,
        "edge_load_percent": 12.0,
        "edge_last_heartbeat": None,
        "daily_gas_liters": 0.0,
        "flow_diff_latest": 0.0,
        "cctv_popup_url": None,
    }


def _append_timeseries(ts_path: Path, pressure: float, flow: float, flow_diff: float = 0.0) -> None:
    data = load_json(ts_path, {"pressure": [], "flow": [], "flow_diff": [], "sensors": {}})
    now = utc_now()
    data["pressure"] = (data.get("pressure") or []) + [{"t": now, "v": pressure}]
    data["flow"] = (data.get("flow") or []) + [{"t": now, "v": flow}]
    data["flow_diff"] = (data.get("flow_diff") or []) + [{"t": now, "v": flow_diff}]
    for key in ("pressure", "flow", "flow_diff"):
        arr = data.get(key) or []
        if len(arr) > MAX_SERIES_POINTS:
            data[key] = arr[-MAX_SERIES_POINTS:]
    save_json(ts_path, data)


def _append_sensors_timeseries(ts_path: Path, sensor_values: Dict[str, float]) -> None:
    if not sensor_values:
        return
    data = load_json(ts_path, {"pressure": [], "flow": [], "sensors": {}})
    if "sensors" not in data or not isinstance(data["sensors"], dict):
        data["sensors"] = {}
    now = utc_now()
    for sid, val in sensor_values.items():
        data["sensors"].setdefault(sid, [])
        data["sensors"][sid] = (data["sensors"][sid] or []) + [{"t": now, "v": val}]
        if len(data["sensors"][sid]) > MAX_SERIES_POINTS:
            data["sensors"][sid] = data["sensors"][sid][-MAX_SERIES_POINTS:]
    save_json(ts_path, data)


class GasLeakControlModule(Module):
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
        "GAS_LEAK_EDGE_REGISTER",
        "GAS_LEAK_AI_FEEDBACK",
        "GAS_LEAK_COLLECTION_POLICY",
    ]

    def __init__(self):
        super().__init__()
        self._simulator_running = False
        self._simulator_thread: threading.Thread | None = None
        self._prev_sample: Dict[str, float] | None = None
        self._prev_flow = 12.0
        self.sensor_window: deque = deque(maxlen=10)
        self.ai_model = GasLeakAIModel()
        self._load_config()
        self._edge_http_started = False

    def _load_config(self) -> None:
        self.rule_threshold_percent = 3.0
        self.ai_error_threshold_sec = 3
        try:
            yaml_path = (
                Path(__file__).resolve().parent.parent.parent
                / "services"
                / "ai-gas-leak-control"
                / "service.yaml"
            )
            if yaml_path.exists():
                with open(yaml_path, "r", encoding="utf-8") as f:
                    config_data = yaml.safe_load(f)
                c = config_data.get("config", {})
                if "rule_threshold_percent" in c:
                    self.rule_threshold_percent = c["rule_threshold_percent"].get("default", 3.0)
                if "ai_error_threshold_sec" in c:
                    self.ai_error_threshold_sec = c["ai_error_threshold_sec"].get("default", 3)
        except Exception as e:
            print(f"[GasLeakControl] Config load error: {e}")

    def _get_policy(self, state: Dict[str, Any]) -> Dict[str, Any]:
        p = state.get("policy") or default_policy()
        return {**default_policy(), **p}

    def _edge_dispatch(self, event_type: str, payload: Dict) -> None:
        ev = Event(type=event_type, payload=payload or {}, source_module="edge_http")
        self.process(ev)

    def _ensure_edge_http(self) -> None:
        if self._edge_http_started:
            return
        start_edge_http(EDGE_HTTP_PORT, self._edge_dispatch)
        self._edge_http_started = True
        print(f"[GasLeakControl] Edge HTTP listening on :{EDGE_HTTP_PORT}")

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
            "GAS_LEAK_EDGE_REGISTER",
            "GAS_LEAK_AI_FEEDBACK",
            "GAS_LEAK_COLLECTION_POLICY",
        ):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        handlers = {
            "GAS_LEAK_EMERGENCY_STOP": self._handle_emergency_stop,
            "GAS_LEAK_VALVE_RESET": self._handle_valve_reset,
            "GAS_LEAK_STATUS_QUERY": self._handle_status_query,
            "GAS_LEAK_MES_STATUS": self._handle_mes_status,
            "GAS_LEAK_ALARM_CONTROL": self._handle_alarm_control,
            "GAS_LEAK_CALL_MANAGER": self._handle_call_manager,
            "GAS_LEAK_POLICY_SAVE": self._handle_policy_save,
            "GAS_LEAK_CANCEL_AUTO_SHUTDOWN": self._handle_cancel_auto_shutdown,
            "GAS_LEAK_EDGE_REGISTER": self._handle_edge_register,
            "GAS_LEAK_AI_FEEDBACK": self._handle_ai_feedback,
            "GAS_LEAK_COLLECTION_POLICY": self._handle_collection_policy,
        }
        fn = handlers.get(event.type)
        return fn(event) if fn else []

    def _handle_emergency_stop(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        zone_id = payload.get("zone_id")
        reason = payload.get("reason", "manual")
        state = load_json(_state_path(), _default_state())
        now = utc_now()
        state["valve_closed"] = True
        state["emergency_at"] = now
        state["last_control"] = "emergency_stop"
        state["alarm_beacon_on"] = True
        state["alarm_siren_on"] = True
        state["risk_level"] = 3
        state["auto_shutdown_deadline"] = None
        for z in state.get("zones") or []:
            if not zone_id or z.get("id") == zone_id:
                z["status"] = "critical"
        save_json(_state_path(), state)
        append_ai_history({"at": now, "type": "emergency_stop", "message": "비상 밸브 차단", "reason": reason, "zone_id": zone_id})
        append_control_history({"at": now, "action": "emergency_stop", "reason": reason, "zone_id": zone_id})
        append_alarm_history({"at": now, "channel": "siren", "message": "비상 차단 — 사이렌", "sent": True})
        self._notify_sms_stub(now, "119/안전관리자", "비상 가스 차단 발생")
        build_data_mart_snapshot()
        return [
            Event(
                type="GAS_LEAK_EMERGENCY_STOP_RESULT",
                payload={"success": True, "valve_closed": True, "at": now, "zone_id": zone_id, "reason": reason},
                source_module=self.name,
            )
        ]

    def _handle_valve_reset(self, event: Event) -> List[Event]:
        state = load_json(_state_path(), _default_state())
        now = utc_now()
        state["valve_closed"] = False
        state["last_control"] = "valve_reset"
        state["alarm_beacon_on"] = False
        state["alarm_siren_on"] = False
        state["risk_level"] = 0
        state["auto_shutdown_deadline"] = None
        state["auto_shutdown_cancelled"] = False
        for z in state.get("zones") or []:
            z["status"] = "normal"
        save_json(_state_path(), state)
        append_ai_history({"at": now, "type": "valve_reset", "message": "밸브 수동 해제"})
        append_control_history({"at": now, "action": "valve_reset"})
        return [
            Event(
                type="GAS_LEAK_VALVE_RESET_RESULT",
                payload={"success": True, "valve_closed": False, "at": now},
                source_module=self.name,
            )
        ]

    def _handle_status_query(self, event: Event) -> List[Event]:
        state = load_json(_state_path(), _default_state())
        sensors = load_json(_sensors_path(), [])
        timeseries = load_json(_timeseries_path(), {"pressure": [], "flow": [], "sensors": {}})
        return [
            Event(
                type="GAS_LEAK_STATUS_RESULT",
                payload={"state": state, "sensors": sensors, "timeseries": timeseries},
                source_module=self.name,
            )
        ]

    def _handle_mes_status(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        state = load_json(_state_path(), _default_state())
        now = utc_now()
        state["mes_equipment_running"] = bool(payload.get("equipment_running", True))
        state["mes_work_order_id"] = payload.get("work_order_id") or payload.get("work_order")
        state["mes_updated_at"] = now
        save_json(_state_path(), state)
        return [
            Event(
                type="GAS_LEAK_MES_STATUS_RESULT",
                payload={"success": True, "equipment_running": state["mes_equipment_running"], "at": now},
                source_module=self.name,
            )
        ]

    def _handle_alarm_control(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        state = load_json(_state_path(), _default_state())
        now = utc_now()
        if "beacon_on" in payload or "alarm_beacon_on" in payload:
            state["alarm_beacon_on"] = bool(payload.get("beacon_on", payload.get("alarm_beacon_on")))
        if "siren_on" in payload or "alarm_siren_on" in payload:
            state["alarm_siren_on"] = bool(payload.get("siren_on", payload.get("alarm_siren_on")))
        save_json(_state_path(), state)
        append_control_history({"at": now, "action": "alarm_control", **{k: state[k] for k in ("alarm_beacon_on", "alarm_siren_on")}})
        return [
            Event(
                type="GAS_LEAK_ALARM_CONTROL_RESULT",
                payload={
                    "success": True,
                    "alarm_beacon_on": state.get("alarm_beacon_on"),
                    "alarm_siren_on": state.get("alarm_siren_on"),
                    "at": now,
                },
                source_module=self.name,
            )
        ]

    def _handle_call_manager(self, event: Event) -> List[Event]:
        now = utc_now()
        append_ai_history({"at": now, "type": "call_manager", "message": "관리자 호출"})
        append_alarm_history({"at": now, "channel": "sms", "message": "안전관리자 호출", "sent": True})
        self._notify_sms_stub(now, "safety_manager", "가스 누출 관리자 호출")
        return [Event(type="GAS_LEAK_CALL_MANAGER_RESULT", payload={"success": True, "at": now}, source_module=self.name)]

    def _handle_policy_save(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        state = load_json(_state_path(), _default_state())
        policy = self._get_policy(state)
        for key in ("level1_warning_pct", "level2_siren_pct", "level3_valve_pct", "grace_seconds"):
            if key in payload:
                policy[key] = float(payload[key]) if key != "grace_seconds" else int(payload[key])
        if "rule_threshold_percent" in payload:
            policy["level3_valve_pct"] = float(payload["rule_threshold_percent"])
            self.rule_threshold_percent = float(payload["rule_threshold_percent"])
        if "ai_error_threshold_sec" in payload:
            self.ai_error_threshold_sec = int(payload["ai_error_threshold_sec"])
        state["policy"] = policy
        save_json(_state_path(), state)
        save_json(path("collection_policy.json"), load_json(path("collection_policy.json"), {"interval_sec": 1}))
        append_control_history({"at": utc_now(), "action": "policy_save", "policy": policy})
        return [
            Event(
                type="GAS_LEAK_POLICY_SAVE_RESULT",
                payload={"success": True, "policy": policy},
                source_module=self.name,
            )
        ]

    def _handle_cancel_auto_shutdown(self, event: Event) -> List[Event]:
        state = load_json(_state_path(), _default_state())
        now = utc_now()
        state["auto_shutdown_deadline"] = None
        state["auto_shutdown_cancelled"] = True
        if state.get("risk_level", 0) >= 3 and not state.get("valve_closed"):
            state["risk_level"] = 2
        save_json(_state_path(), state)
        append_control_history({"at": now, "action": "cancel_auto_shutdown"})
        return [Event(type="GAS_LEAK_CANCEL_AUTO_SHUTDOWN_RESULT", payload={"success": True, "at": now}, source_module=self.name)]

    def _handle_edge_register(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        edge_id = payload.get("edge_id", "local")
        status = load_json(path("edge_status.json"), {})
        status[edge_id] = {
            "load_percent": payload.get("load_percent", random.uniform(8, 35)),
            "online": True,
            "last_seen": utc_now(),
            "ip": payload.get("ip"),
        }
        save_json(path("edge_status.json"), status)
        state = load_json(_state_path(), _default_state())
        state["edge_last_heartbeat"] = utc_now()
        state["edge_load_percent"] = status[edge_id].get("load_percent", 12.0)
        save_json(_state_path(), state)
        return []

    def _handle_ai_feedback(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        entry = {
            "at": utc_now(),
            "type": "false_positive_feedback",
            "sensor_id": payload.get("sensor_id"),
            "note": payload.get("note", ""),
            "relabeled": payload.get("relabeled", "normal"),
        }
        fb = load_json(path("ai_feedback.json"), [])
        if not isinstance(fb, list):
            fb = []
        fb.append(entry)
        save_json(path("ai_feedback.json"), fb[-500:])
        return [Event(type="GAS_LEAK_AI_FEEDBACK_RESULT", payload={"success": True}, source_module=self.name)]

    def _handle_collection_policy(self, event: Event) -> List[Event]:
        payload = event.payload or {}
        doc = load_json(path("collection_policy.json"), {"interval_sec": 1, "per_sensor": {}})
        doc.update({k: v for k, v in payload.items() if k in ("interval_sec", "per_sensor")})
        save_json(path("collection_policy.json"), doc)
        return [Event(type="GAS_LEAK_COLLECTION_POLICY_RESULT", payload={"success": True, "policy": doc}, source_module=self.name)]

    def _notify_sms_stub(self, at: str, target: str, message: str) -> None:
        append_alarm_history({"at": at, "channel": "sms_stub", "target": target, "message": message, "sent": True})

    def _notify_app_stub(self, at: str, level: int, message: str) -> None:
        append_alarm_history({"at": at, "channel": "app_push_stub", "level": level, "message": message, "sent": True})

    def run(
        self,
        event_bus_url: str = "http://localhost:8000",
        service_url: str = "http://localhost:8000",
        poll_interval: int = 5,
        use_push: bool = True,
    ):
        self._ensure_edge_http()
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

    def _apply_risk_levels(self, state: Dict[str, Any], concentration: float, policy: Dict[str, Any]) -> Dict[str, Any]:
        l1 = float(policy.get("level1_warning_pct", 1.5))
        l2 = float(policy.get("level2_siren_pct", 2.5))
        l3 = float(policy.get("level3_valve_pct", self.rule_threshold_percent))
        grace = int(policy.get("grace_seconds", self.ai_error_threshold_sec))
        now = datetime.utcnow()
        now_str = now.isoformat() + "Z"

        if concentration >= l3:
            state["risk_level"] = 3
            state["risk_message"] = f"위험: 농도 {concentration}% (차단 임계 {l3}%)"
            if not state.get("auto_shutdown_deadline") and not state.get("valve_closed"):
                deadline = now + timedelta(seconds=grace)
                state["auto_shutdown_deadline"] = deadline.isoformat() + "Z"
                append_ai_history({"at": now_str, "type": "risk_level3", "message": state["risk_message"]})
        elif concentration >= l2:
            state["risk_level"] = 2
            state["risk_message"] = f"경고: 농도 {concentration}%"
            state["alarm_siren_on"] = True
            state["auto_shutdown_deadline"] = None
            append_alarm_history({"at": now_str, "channel": "siren", "message": state["risk_message"], "sent": True})
        elif concentration >= l1:
            state["risk_level"] = 1
            state["risk_message"] = f"주의: 농도 {concentration}%"
            self._notify_app_stub(now_str, 1, state["risk_message"])
        else:
            state["risk_level"] = 0
            state["risk_message"] = None
            if not state.get("valve_closed"):
                state["alarm_siren_on"] = False
        return state

    def _simulator_loop(self) -> None:
        ai_error_duration_sec = 0
        tick = 0
        while self._simulator_running:
            try:
                state = load_json(_state_path(), _default_state())
                policy = self._get_policy(state)
                l3 = float(policy.get("level3_valve_pct", self.rule_threshold_percent))
                grace = int(policy.get("grace_seconds", self.ai_error_threshold_sec))

                # 유예 만료 → 자동 차단
                deadline_s = state.get("auto_shutdown_deadline")
                if (
                    deadline_s
                    and not state.get("valve_closed")
                    and not state.get("auto_shutdown_cancelled")
                ):
                    try:
                        dl = datetime.fromisoformat(deadline_s.replace("Z", "+00:00")).replace(tzinfo=None)
                        if datetime.utcnow() >= dl:
                            ev = Event(
                                type="GAS_LEAK_EMERGENCY_STOP",
                                payload={"reason": "auto_grace_expired"},
                                source_module=self.name,
                            )
                            self.process(ev)
                            time.sleep(1)
                            continue
                    except ValueError:
                        pass

                if state.get("valve_closed"):
                    time.sleep(1)
                    continue

                mes_running = state.get("mes_equipment_running", True)
                raw_p = 0.40 + random.uniform(-0.02, 0.05)
                raw_f = 12.0 + random.uniform(-0.5, 0.8)
                raw_c = 1.0 + random.uniform(-0.5, 1.2)
                sample = preprocess_sample(raw_p, raw_f, raw_c, prev=self._prev_sample)
                self._prev_sample = sample
                pressure, flow, concentration = sample["pressure"], sample["flow"], sample["concentration"]
                flow_diff = abs(flow - self._prev_flow)
                self._prev_flow = flow

                append_raw_tick({"t": utc_now(), "pressure": pressure, "flow": flow, "concentration": concentration})
                _append_timeseries(_timeseries_path(), pressure, flow, flow_diff)
                bump_daily_usage(flow * 0.01)
                self.sensor_window.append(sample)

                sensors = load_json(_sensors_path(), [])
                sensor_series: Dict[str, float] = {}
                max_conc = concentration
                for s in sensors:
                    sid = s.get("id")
                    st = s.get("sensor_type") or ""
                    if "압력" in s.get("label", "") or st == "pressure":
                        val = round(pressure + random.uniform(-0.01, 0.01), 3)
                    elif st == "concentration":
                        val = round(concentration + random.uniform(-0.1, 0.1), 2)
                        max_conc = max(max_conc, val)
                    else:
                        val = round(flow + random.uniform(-0.2, 0.2), 2)
                    s["value"] = val
                    if sid:
                        sensor_series[sid] = val
                _append_sensors_timeseries(_timeseries_path(), sensor_series)
                save_json(_sensors_path(), sensors)

                mse = self.ai_model.predict(list(self.sensor_window))
                ai_anomaly = False
                if mse > 0.1:
                    ai_error_duration_sec += 1
                    if ai_error_duration_sec >= self.ai_error_threshold_sec:
                        ai_anomaly = True
                else:
                    ai_error_duration_sec = 0

                if not mes_running and (flow > 12.5 or pressure > 0.42 or concentration > 1.5):
                    append_ai_history(
                        {
                            "at": utc_now(),
                            "type": "welding_exception",
                            "message": "비가동 중 가스 유입 — 용접 예외 처리",
                        }
                    )

                state["flow_diff_latest"] = round(flow_diff, 3)
                state["edge_load_percent"] = round(10 + (mse * 50) + random.uniform(0, 5), 1)
                state["edge_last_heartbeat"] = utc_now()
                daily = load_json(path("daily_usage.json"), {})
                state["daily_gas_liters"] = daily.get("cumulative_liters", 0)
                if max_conc >= l3 * 0.9:
                    state["cctv_popup_url"] = "/api/gas-leak/cctv/demo"
                state = self._apply_risk_levels(state, max_conc, policy)
                save_json(_state_path(), state)

                if max_conc >= l3 and not state.get("valve_closed"):
                    pass  # grace handles shutdown
                elif ai_anomaly:
                    ev = Event(type="GAS_LEAK_EMERGENCY_STOP", payload={"reason": "ai_anomaly"}, source_module=self.name)
                    self.process(ev)
                    ai_error_duration_sec = 0

                if tick % 30 == 0:
                    build_data_mart_snapshot()
                tick += 1
            except Exception:
                pass
            coll = load_json(path("collection_policy.json"), {"interval_sec": 1})
            time.sleep(max(1, int(coll.get("interval_sec", 1))))
