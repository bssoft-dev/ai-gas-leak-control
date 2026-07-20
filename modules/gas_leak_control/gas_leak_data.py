"""AI 가스 누출 공통 데이터 경로·헬퍼."""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


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


def timeseries_daily_dir() -> Path:
    d = data_dir() / "timeseries" / "daily"
    d.mkdir(parents=True, exist_ok=True)
    return d


def timeseries_daily_path(day: str) -> Path:
    return timeseries_daily_dir() / f"{day}.json"


def _empty_daily_timeseries(day: str) -> Dict[str, Any]:
    return {"date": day, "pressure": [], "flow": [], "flow_diff": [], "sensors": {}}


def _dedupe_points(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    out: List[Dict[str, Any]] = []
    for pt in points:
        if not isinstance(pt, dict):
            continue
        key = str(pt.get("t", ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(pt)
    out.sort(key=lambda p: p.get("t") or "")
    return out


def _merge_daily_doc(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    day = incoming.get("date") or existing.get("date") or utc_now()[:10]
    merged = _empty_daily_timeseries(day)
    for key in ("pressure", "flow", "flow_diff"):
        merged[key] = _dedupe_points((existing.get(key) or []) + (incoming.get(key) or []))
    sensors: Dict[str, List[Dict[str, Any]]] = {}
    for src in (existing, incoming):
        smap = src.get("sensors") or {}
        if not isinstance(smap, dict):
            continue
        for sid, series in smap.items():
            sensors.setdefault(str(sid), [])
            if isinstance(series, list):
                sensors[str(sid)].extend(series)
    merged["sensors"] = {sid: _dedupe_points(arr) for sid, arr in sensors.items()}
    merged["updated_at"] = utc_now()
    merged["point_count"] = sum(len(merged[k]) for k in ("pressure", "flow", "flow_diff"))
    return merged


def _update_daily_index(day: str) -> None:
    idx_path = data_dir() / "timeseries" / "daily_index.json"
    idx = load_json(idx_path, {"dates": []})
    dates = idx.get("dates") if isinstance(idx.get("dates"), list) else []
    if day not in dates:
        dates.append(day)
        dates.sort()
    save_json(idx_path, {"dates": dates, "updated_at": utc_now()})


def append_daily_timeseries(
    pressure: float,
    flow: float,
    flow_diff: float,
    sensor_values: Dict[str, float],
    *,
    timestamp: Optional[str] = None,
) -> None:
    """일별 시계열 파일에 누적 저장 (truncate 없음). timeseries.json 은 실시간 버퍼만 유지."""
    now = timestamp or utc_now()
    day = now[:10]
    fp = timeseries_daily_path(day)
    doc = load_json(fp, _empty_daily_timeseries(day))
    incoming = _empty_daily_timeseries(day)
    incoming["pressure"] = [{"t": now, "v": pressure}]
    incoming["flow"] = [{"t": now, "v": flow}]
    incoming["flow_diff"] = [{"t": now, "v": flow_diff}]
    incoming["sensors"] = {sid: [{"t": now, "v": val}] for sid, val in sensor_values.items()}
    save_json(fp, _merge_daily_doc(doc, incoming))
    _update_daily_index(day)


def migrate_buffer_timeseries_to_daily() -> int:
    """
    timeseries.json(및 timeseries copy.json)의 버퍼 데이터를 일별 파일로 병합.
    실시간 차트용 버퍼는 유지하고, 과거 포인트는 일별 파일에 보존.
    """
    marker = data_dir() / "timeseries" / ".buffer_migrated_v1"
    sources = [path("timeseries.json")]
    copy_fp = data_dir() / "timeseries copy.json"
    if copy_fp.exists():
        sources.append(copy_fp)

    by_day: Dict[str, Dict[str, Any]] = {}

    def ingest_doc(ts: Dict[str, Any]) -> None:
        if not isinstance(ts, dict):
            return
        for key in ("pressure", "flow", "flow_diff"):
            for pt in ts.get(key) or []:
                if not isinstance(pt, dict):
                    continue
                t = pt.get("t") or ""
                if len(t) < 10:
                    continue
                day = t[:10]
                bucket = by_day.setdefault(day, _empty_daily_timeseries(day))
                bucket[key].append(pt)
        smap = ts.get("sensors") or {}
        if isinstance(smap, dict):
            for sid, series in smap.items():
                for pt in series or []:
                    if not isinstance(pt, dict):
                        continue
                    t = pt.get("t") or ""
                    if len(t) < 10:
                        continue
                    day = t[:10]
                    bucket = by_day.setdefault(day, _empty_daily_timeseries(day))
                    bucket["sensors"].setdefault(str(sid), []).append(pt)

    for src in sources:
        if src.exists():
            ingest_doc(load_json(src, {}))

    if not by_day:
        return 0

    for day, chunk in by_day.items():
        fp = timeseries_daily_path(day)
        existing = load_json(fp, _empty_daily_timeseries(day))
        save_json(fp, _merge_daily_doc(existing, chunk))
        _update_daily_index(day)

    marker.write_text(utc_now(), encoding="utf-8")
    return len(by_day)


def list_daily_timeseries_dates() -> List[str]:
    idx = load_json(data_dir() / "timeseries" / "daily_index.json", {"dates": []})
    dates = idx.get("dates") if isinstance(idx.get("dates"), list) else []
    if dates:
        return dates
    daily = timeseries_daily_dir()
    return sorted(p.stem for p in daily.glob("*.json") if p.is_file())


def load_daily_timeseries(day: str) -> Dict[str, Any]:
    fp = timeseries_daily_path(day)
    if not fp.exists():
        return _empty_daily_timeseries(day)
    doc = load_json(fp, _empty_daily_timeseries(day))
    if isinstance(doc, dict):
        return doc
    return _empty_daily_timeseries(day)


def load_all_daily_timeseries_merged() -> Dict[str, Any]:
    """업로드·분석용: 모든 일별 파일 병합."""
    merged = _empty_daily_timeseries("all")
    for day in list_daily_timeseries_dates():
        doc = load_daily_timeseries(day)
        merged = _merge_daily_doc(merged, doc)
    merged["date"] = "all"
    return merged


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
    """정제 스냅샷(Mart): state + sensors 요약 + MinIO 업로드 패키지."""
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
    try:
        from minio_upload_export import export_minio_upload_package

        export_minio_upload_package()
    except Exception as exc:
        print(f"[GasLeakData] MinIO upload export skipped: {exc}")
