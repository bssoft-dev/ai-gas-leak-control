"""AI 가스 누출 공통 데이터 경로·헬퍼."""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List


def data_dir() -> Path:
    base = os.getenv("AI_GAS_LEAK_DATA_DIR")
    if base:
        return Path(base)
    mod_dir = Path(__file__).resolve().parent
    return mod_dir.parent.parent / "data" / "ai_gas_leak"


def path(name: str) -> Path:
    p = data_dir() / name
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_json(file_path: Path, default: Any) -> Any:
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return default


def save_json(file_path: Path, data: Any) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def default_policy() -> Dict[str, Any]:
    return {
        "level1_warning_pct": 1.5,
        "level2_siren_pct": 2.5,
        "level3_valve_pct": 3.0,
        "grace_seconds": 3,
    }


def append_ai_history(entry: Dict[str, Any], max_items: int = 500) -> None:
    p = path("ai_history.json")
    data = load_json(p, [])
    if not isinstance(data, list):
        data = []
    data.append(entry)
    if len(data) > max_items:
        data = data[-max_items:]
    save_json(p, data)


def append_control_history(entry: Dict[str, Any], max_items: int = 2000) -> None:
    p = path("control_history.json")
    data = load_json(p, [])
    if not isinstance(data, list):
        data = []
    data.append(entry)
    if len(data) > max_items:
        data = data[-max_items:]
    save_json(p, data)


def append_alarm_history(entry: Dict[str, Any], max_items: int = 2000) -> None:
    p = path("alarm_history.json")
    data = load_json(p, [])
    if not isinstance(data, list):
        data = []
    data.append(entry)
    if len(data) > max_items:
        data = data[-max_items:]
    save_json(p, data)


def append_raw_tick(tick: Dict[str, Any], max_lines: int = 5000) -> None:
    raw_dir = data_dir() / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    day = datetime.utcnow().strftime("%Y%m%d")
    fp = raw_dir / f"raw_{day}.jsonl"
    line = json.dumps(tick, ensure_ascii=False) + "\n"
    with open(fp, "a", encoding="utf-8") as f:
        f.write(line)
    # 오래된 라인 정리 (단순: 파일 크기 제한)
    try:
        if fp.stat().st_size > 2_000_000:
            lines = fp.read_text(encoding="utf-8").splitlines()
            fp.write_text("\n".join(lines[-max_lines:]) + "\n", encoding="utf-8")
    except OSError:
        pass


def bump_daily_usage(liters: float) -> None:
    p = path("daily_usage.json")
    today = datetime.utcnow().strftime("%Y-%m-%d")
    doc = load_json(p, {"date": today, "cumulative_liters": 0.0})
    if doc.get("date") != today:
        doc = {"date": today, "cumulative_liters": 0.0}
    doc["cumulative_liters"] = float(doc.get("cumulative_liters", 0)) + liters
    save_json(p, doc)


def preprocess_sample(
    pressure: float,
    flow: float,
    concentration: float,
    *,
    prev: Dict[str, float] | None = None,
) -> Dict[str, float]:
    """이상치 보정·용접 흄 노이즈 완화(이동평균)·결측 보간(직전값)."""
    if prev:
        if abs(pressure - prev.get("pressure", pressure)) > 0.15:
            pressure = prev["pressure"] + 0.05 * (pressure - prev["pressure"])
        if abs(flow - prev.get("flow", flow)) > 3.0:
            flow = prev["flow"] + 0.05 * (flow - prev["flow"])
        if abs(concentration - prev.get("concentration", concentration)) > 2.0:
            concentration = prev["concentration"] + 0.05 * (concentration - prev["concentration"])
    # 용접 흄: 짧은 스파이크 완화
    if prev and concentration > prev.get("concentration", 0) + 1.2:
        concentration = (concentration + prev["concentration"]) / 2
    return {
        "pressure": round(max(0.0, pressure), 4),
        "flow": round(max(0.0, flow), 2),
        "concentration": round(max(0.0, min(10.0, concentration)), 2),
    }


def build_data_mart_snapshot() -> None:
    """정제 스냅샷(Mart): state + sensors 요약."""
    state = load_json(path("state.json"), {})
    sensors = load_json(path("sensors.json"), [])
    save_json(
        path("data_mart.json"),
        {
            "generated_at": utc_now(),
            "risk_level": state.get("risk_level", 0),
            "valve_closed": state.get("valve_closed", False),
            "sensor_count": len(sensors) if isinstance(sensors, list) else 0,
            "mes_equipment_running": state.get("mes_equipment_running", True),
        },
    )
