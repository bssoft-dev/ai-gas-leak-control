"""
MinIO·데이터포털 업로드용 패키지 자동 생성.

운영 수집 데이터(센서·시계열·상태)와 이벤트 로그(AI/제어/경보)를 분리하여
`data/ai_gas_leak/minio_upload/` 에 저장·압축합니다.
매뉴얼 v2.0: 확장자별 zip, 2GB 분할, 원천데이터/이벤트로그 폴더.

참고: docs/데이터업로드_MinIO_저장형식.md
"""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from gas_leak_data import (
    data_dir,
    list_daily_timeseries_dates,
    load_all_daily_timeseries_merged,
    load_daily_timeseries,
    load_json,
    migrate_buffer_timeseries_to_daily,
    path,
    save_json,
    timeseries_daily_dir,
    utc_now,
)

UPLOAD_ROOT_NAME = "minio_upload"
MANIFEST_VERSION = "2.0"
SERVICE_ID = "com.SagoHub.ai-gas-leak-control"
DATASET_DESCRIPTION = "ai-gas-leak-prod"
MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024  # 2GB — 매뉴얼 §3
COMPANY_FOLDER = os.getenv("GAS_LEAK_UPLOAD_COMPANY_FOLDER", "Example_bluesp")

# 매뉴얼 폴더명 (학습/검증·라벨링 아님)
FOLDER_COLLECTED = "원천데이터"  # 센서·시계열·상태 등 수집 데이터
FOLDER_EVENT_LOGS = "이벤트로그"  # AI/제어/경보 이벤트 로그

_last_export_at: Optional[float] = None
_last_export_mtime: float = 0.0


def upload_root() -> Path:
    root = data_dir() / UPLOAD_ROOT_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def _batch_id(now: Optional[datetime] = None) -> str:
    dt = now or datetime.now(timezone.utc)
    return dt.strftime("%Y%m%d_%H%M%S")


def _write_text(fp: Path, text: str) -> None:
    fp.parent.mkdir(parents=True, exist_ok=True)
    fp.write_text(text, encoding="utf-8")


def _write_json(fp: Path, data: Any) -> None:
    _write_text(fp, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def _write_ndjson(fp: Path, rows: List[Dict[str, Any]]) -> None:
    fp.parent.mkdir(parents=True, exist_ok=True)
    with open(fp, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _csv_string(headers: List[str], rows: List[List[Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def _flatten_timeseries(ts: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[List[Any]]]:
    ndjson_rows: List[Dict[str, Any]] = []
    csv_rows: List[List[Any]] = []

    def add_series(metric_type: str, series: Any, unit: str, sensor_id: str = "") -> None:
        if not isinstance(series, list):
            return
        for pt in series:
            if not isinstance(pt, dict):
                continue
            t, v = pt.get("t"), pt.get("v")
            ndjson_rows.append(
                {
                    "timestamp": t,
                    "metric_type": metric_type,
                    "sensor_id": sensor_id or None,
                    "value": v,
                    "unit": unit,
                }
            )
            csv_rows.append([t, metric_type, sensor_id or "", v, unit])

    add_series("pressure", ts.get("pressure"), "MPa")
    add_series("flow", ts.get("flow"), "L/min")
    add_series("flow_diff", ts.get("flow_diff"), "L/min")
    sensors_map = ts.get("sensors") or {}
    if isinstance(sensors_map, dict):
        for sid, series in sensors_map.items():
            add_series("sensor", series, "", str(sid))
    return ndjson_rows, csv_rows


def _sensors_csv_rows(sensors: List[Dict[str, Any]]) -> Tuple[List[str], List[List[Any]]]:
    headers = ["id", "zone_id", "label", "value", "unit", "status", "sensor_type"]
    rows = []
    for s in sensors:
        if not isinstance(s, dict):
            continue
        rows.append(
            [
                s.get("id", ""),
                s.get("zone_id", ""),
                s.get("label", ""),
                s.get("value"),
                s.get("unit", ""),
                s.get("status", ""),
                s.get("sensor_type", ""),
            ]
        )
    return headers, rows


def _history_csv_rows(items: List[Dict[str, Any]], extra_cols: List[str]) -> Tuple[List[str], List[List[Any]]]:
    headers = ["at", "type", "message"] + extra_cols
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = [item.get("at", ""), item.get("type", ""), item.get("message", "")]
        for col in extra_cols:
            row.append(item.get(col, ""))
        rows.append(row)
    return headers, rows


def _merge_event_logs(
    ai_history: List[Dict[str, Any]],
    control_history: List[Dict[str, Any]],
    alarm_history: List[Dict[str, Any]],
) -> Tuple[List[str], List[List[Any]], List[Dict[str, Any]]]:
    """통합 이벤트 로그 (CSV + NDJSON)."""
    headers = ["at", "log_category", "type", "message", "detail_json"]
    csv_rows: List[List[Any]] = []
    ndjson_rows: List[Dict[str, Any]] = []

    def append_category(category: str, items: List[Dict[str, Any]]) -> None:
        for item in items:
            if not isinstance(item, dict):
                continue
            detail = {k: v for k, v in item.items() if k not in ("at", "type", "message")}
            ndjson_rows.append(
                {
                    "at": item.get("at"),
                    "log_category": category,
                    "type": item.get("type"),
                    "message": item.get("message"),
                    **detail,
                }
            )
            csv_rows.append(
                [
                    item.get("at", ""),
                    category,
                    item.get("type", ""),
                    item.get("message", ""),
                    json.dumps(detail, ensure_ascii=False) if detail else "",
                ]
            )

    append_category("ai", ai_history)
    append_category("control", control_history)
    append_category("alarm", alarm_history)
    ndjson_rows.sort(key=lambda r: r.get("at") or "")
    csv_rows.sort(key=lambda r: r[0] or "")
    return headers, csv_rows, ndjson_rows


def _build_dataset_info(state: Dict[str, Any]) -> Dict[str, Any]:
    base_id = state.get("upload_base_id") or str(uuid.uuid5(uuid.NAMESPACE_DNS, SERVICE_ID))
    return {
        "base_informations": {
            "description": DATASET_DESCRIPTION,
            "base_id": base_id,
            "service_id": SERVICE_ID,
        },
        "dataset": {
            "name_ko": "AI 가스 누출 — 센서 수집·이벤트 로그 데이터",
            "name_en": "AI Gas Leak Sensor Telemetry and Event Logs",
            "data_purpose": "operational_collection_and_event_logs",
            "format": ["json", "csv", "ndjson"],
            "encoding": "UTF-8",
            "generated_at": utc_now(),
        },
        "minio": {
            "suggested_bucket": "sagohub-data",
            "suggested_prefix": f"ai-gas-leak/{DATASET_DESCRIPTION}",
            "upload_note": f"mc cp -r minio_upload/zip_packages/latest/ myminio/sagohub-data/",
        },
    }


def _next_dataset_id(root: Path) -> int:
    reg_path = root / "dataset_registry.json"
    reg = load_json(reg_path, {"next_id": 1})
    ds_id = int(reg.get("next_id", 1))
    reg["next_id"] = ds_id + 1
    if not isinstance(reg.get("history"), list):
        reg["history"] = []
    reg["history"].append({"dataset_id": ds_id, "assigned_at": utc_now()})
    reg["history"] = reg["history"][-100:]
    save_json(reg_path, reg)
    return ds_id


UPLOAD_ZIP_FILENAME = "upload_data.zip"


def _stage_batch_files(batch_dir: Path, staging: Path) -> int:
    """배치 collected/event_logs → staging/원천데이터|이벤트로그. 반환: 파일 수."""
    collected_src = batch_dir / "collected"
    events_src = batch_dir / "event_logs"
    collected_stage = staging / FOLDER_COLLECTED
    events_stage = staging / FOLDER_EVENT_LOGS
    count = 0

    daily_dest = collected_stage / "timeseries_daily"
    migrate_buffer_timeseries_to_daily()
    for day in list_daily_timeseries_dates():
        src = timeseries_daily_dir() / f"{day}.json"
        if src.exists():
            _stage_copy(src, daily_dest / f"{day}.json")
            count += 1

    for sub in ("csv", "json", "ndjson"):
        src_sub = collected_src / sub
        if src_sub.exists():
            for fp in src_sub.iterdir():
                if fp.is_file():
                    _stage_copy(fp, collected_stage / fp.name)
                    count += 1
    assets = collected_src / "assets"
    if assets.exists():
        for fp in assets.iterdir():
            if fp.is_file():
                _stage_copy(fp, collected_stage / fp.name)
                count += 1
    for sub in ("csv", "json", "ndjson"):
        src_sub = events_src / sub
        if src_sub.exists():
            for fp in src_sub.iterdir():
                if fp.is_file():
                    _stage_copy(fp, events_stage / fp.name)
                    count += 1
    return count


def _zip_directory_tree(source_dir: Path, zip_path: Path) -> Tuple[int, List[str]]:
    """디렉터리 전체를 단일 zip 1개로 압축. 반환: (size_bytes, arcname 목록)."""
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    arcnames: List[str] = []
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fp in sorted(source_dir.rglob("*")):
            if fp.is_file():
                arc = fp.relative_to(source_dir).as_posix()
                zf.write(fp, arcname=arc)
                arcnames.append(arc)
    return zip_path.stat().st_size, arcnames


def _stage_copy(src: Path, dest: Path) -> None:
    if src.exists() and src.is_file():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def build_upload_zip_packages(batch_dir: Path, root: Path, batch: str, dataset_id: int) -> Path:
    """
    원천데이터 + 이벤트로그를 **단일 zip 1개**(`upload_data.zip`)로 압축.
    zip 내부: 원천데이터/, 이벤트로그/, zip_manifest.json
    """
    zip_root = root / "zip_packages" / COMPANY_FOLDER / str(dataset_id)
    if zip_root.exists():
        shutil.rmtree(zip_root)
    zip_root.mkdir(parents=True)

    staging = zip_root / "_staging"
    staging.mkdir()
    file_count = _stage_batch_files(batch_dir, staging)

    zip_info = {
        "generated_at": utc_now(),
        "batch_id": batch,
        "dataset_id": dataset_id,
        "company_folder": COMPANY_FOLDER,
        "data_purpose": "sensor_collection_and_event_logs",
        "folder_layout": {
            FOLDER_COLLECTED: "센서·시계열·상태·도면 등 수집 데이터",
            FOLDER_EVENT_LOGS: "AI 판단·제어·경보 이벤트 로그",
        },
        "manual_rules": {
            "single_zip": True,
            "max_zip_bytes": MAX_ZIP_BYTES,
            "no_training_validation_split": True,
        },
        "upload_path": f"{COMPANY_FOLDER}/{dataset_id}/",
        "file_count": file_count,
    }
    _write_json(staging / "zip_manifest.json", zip_info)

    upload_zip = zip_root / UPLOAD_ZIP_FILENAME
    size_bytes, arcnames = _zip_directory_tree(staging, upload_zip)
    shutil.rmtree(staging)

    zip_info["archive"] = {
        "name": UPLOAD_ZIP_FILENAME,
        "size_bytes": size_bytes,
        "encoding": "UTF-8",
        "entries": arcnames,
        "exceeds_2gb": size_bytes > MAX_ZIP_BYTES,
    }
    _write_json(zip_root / "zip_manifest.json", zip_info)

    latest_dir = root / "zip_packages" / "latest"
    if latest_dir.exists():
        shutil.rmtree(latest_dir)
    latest_dir.mkdir(parents=True)
    shutil.copy2(upload_zip, latest_dir / UPLOAD_ZIP_FILENAME)
    shutil.copy2(zip_root / "zip_manifest.json", latest_dir / "zip_manifest.json")

    return zip_root


def _source_files_mtime() -> float:
    names = (
        "state.json",
        "sensors.json",
        "timeseries.json",
        "ai_history.json",
        "control_history.json",
        "alarm_history.json",
        "daily_usage.json",
        "drawings.json",
        "data_mart.json",
        "ai_feedback.json",
        "edge_registry.json",
    )
    mt = 0.0
    for name in names:
        fp = path(name)
        if fp.exists():
            mt = max(mt, fp.stat().st_mtime)
    raw_dir = data_dir() / "raw"
    if raw_dir.exists():
        for fp in raw_dir.glob("raw_*.jsonl"):
            mt = max(mt, fp.stat().st_mtime)
    daily_dir = timeseries_daily_dir()
    if daily_dir.exists():
        for fp in daily_dir.glob("*.json"):
            mt = max(mt, fp.stat().st_mtime)
    return mt


def export_minio_upload_package(*, force: bool = False, min_interval_sec: int = 60) -> Path:
    global _last_export_at, _last_export_mtime

    import time

    now_ts = time.time()
    src_mtime = _source_files_mtime()
    if (
        not force
        and _last_export_at is not None
        and (now_ts - _last_export_at) < min_interval_sec
        and src_mtime <= _last_export_mtime
    ):
        return upload_root() / "latest"

    state = load_json(path("state.json"), {})
    sensors = load_json(path("sensors.json"), [])
    migrate_buffer_timeseries_to_daily()
    timeseries = load_json(path("timeseries.json"), {})
    timeseries_all = load_all_daily_timeseries_merged()
    daily_dates = list_daily_timeseries_dates()
    ai_history = load_json(path("ai_history.json"), [])
    control_history = load_json(path("control_history.json"), [])
    alarm_history = load_json(path("alarm_history.json"), [])
    daily_usage = load_json(path("daily_usage.json"), {})
    drawings = load_json(path("drawings.json"), [])
    data_mart = load_json(path("data_mart.json"), {})
    ai_feedback = load_json(path("ai_feedback.json"), [])
    edge_registry = load_json(path("edge_registry.json"), {})

    if not isinstance(sensors, list):
        sensors = []
    if not isinstance(ai_history, list):
        ai_history = []
    if not isinstance(control_history, list):
        control_history = []
    if not isinstance(alarm_history, list):
        alarm_history = []
    if not isinstance(drawings, list):
        drawings = []
    if not isinstance(timeseries, dict):
        timeseries = {}
    if not isinstance(ai_feedback, list):
        ai_feedback = []

    batch = _batch_id()
    root = upload_root()
    batch_dir = root / "batches" / batch
    collected = batch_dir / "collected"
    event_logs = batch_dir / "event_logs"
    meta_dir = batch_dir / "metadata"
    schema_dir = batch_dir / "schemas"

    coll_csv = collected / "csv"
    coll_json = collected / "json"
    coll_ndjson = collected / "ndjson"
    coll_assets = collected / "assets"
    ev_csv = event_logs / "csv"
    ev_json = event_logs / "json"
    ev_ndjson = event_logs / "ndjson"

    # ===== 수집 데이터 (원천) =====
    portal_state = {"base_informations": _build_dataset_info(state)["base_informations"], **state}
    timeseries_realtime = load_json(path("timeseries.json"), {})
    if not isinstance(timeseries_realtime, dict):
        timeseries_realtime = {}
    _write_json(coll_json / "state.json", portal_state)
    _write_json(coll_json / "sensors.json", sensors)
    _write_json(coll_json / "timeseries_realtime.json", timeseries_realtime)
    _write_json(coll_json / "timeseries.json", timeseries_all if timeseries_all.get("pressure") else timeseries_realtime)
    if daily_dates:
        _write_json(
            coll_json / "timeseries_daily_index.json",
            {"dates": daily_dates, "updated_at": utc_now()},
        )
    _write_json(coll_json / "daily_usage.json", daily_usage)
    _write_json(coll_json / "data_mart.json", data_mart)
    _write_json(coll_json / "drawings.json", drawings)
    if edge_registry:
        _write_json(coll_json / "edge_registry.json", edge_registry)

    sh, sr = _sensors_csv_rows(sensors)
    _write_text(coll_csv / "sensors_snapshot.csv", _csv_string(sh, sr))

    _, ts_csv = _flatten_timeseries(timeseries_all if timeseries_all.get("pressure") else timeseries)
    _write_text(
        coll_csv / "timeseries.csv",
        _csv_string(["timestamp", "metric_type", "sensor_id", "value", "unit"], ts_csv),
    )
    _write_text(
        coll_csv / "daily_usage.csv",
        _csv_string(
            ["date", "cumulative_liters"],
            [[daily_usage.get("date", ""), daily_usage.get("cumulative_liters", 0)]],
        ),
    )

    ts_ndjson, _ = _flatten_timeseries(timeseries_all if timeseries_all.get("pressure") else timeseries)
    _write_ndjson(coll_ndjson / "timeseries.ndjson", ts_ndjson)

    raw_lines: List[Dict[str, Any]] = []
    raw_dir = data_dir() / "raw"
    if raw_dir.exists():
        for fp in sorted(raw_dir.glob("raw_*.jsonl"))[-7:]:
            try:
                for line in fp.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        raw_lines.append(json.loads(line))
            except (json.JSONDecodeError, OSError):
                pass
    _write_ndjson(coll_ndjson / "raw_ticks.ndjson", raw_lines)

    for d in drawings:
        rel = (d or {}).get("file_path") or ""
        if rel and ".." not in rel:
            img = data_dir() / rel
            if img.exists():
                _stage_copy(img, coll_assets / img.name)

    # ===== 이벤트 로그 =====
    _write_json(ev_json / "ai_history.json", ai_history)
    _write_json(ev_json / "control_history.json", control_history)
    _write_json(ev_json / "alarm_history.json", alarm_history)
    if ai_feedback:
        _write_json(ev_json / "ai_feedback.json", ai_feedback)

    ah_h, ah_r = _history_csv_rows(ai_history, ["reason", "zone_id", "sensor_id", "value", "unit"])
    _write_text(ev_csv / "ai_history.csv", _csv_string(ah_h, ah_r))

    ch_h, ch_r = _history_csv_rows(control_history, ["action", "reason", "zone_id", "level"])
    _write_text(ev_csv / "control_history.csv", _csv_string(ch_h, ch_r))

    al_h, al_r = _history_csv_rows(alarm_history, ["channel", "target", "sent"])
    _write_text(ev_csv / "alarm_history.csv", _csv_string(al_h, al_r))

    ev_headers, ev_csv_rows, ev_ndjson_rows = _merge_event_logs(ai_history, control_history, alarm_history)
    _write_text(ev_csv / "event_logs.csv", _csv_string(ev_headers, ev_csv_rows))
    _write_ndjson(ev_ndjson / "event_logs.ndjson", ev_ndjson_rows)

    # --- 메타·스키마 ---
    dataset_info = _build_dataset_info(state)
    dataset_info["batch_id"] = batch
    dataset_info["upload_categories"] = {
        "collected": FOLDER_COLLECTED,
        "event_logs": FOLDER_EVENT_LOGS,
    }
    _write_json(meta_dir / "dataset_info.json", dataset_info)

    schemas = {
        "sensors_snapshot.schema.json": {
            "category": "collected",
            "columns": [
                {"name": "id", "type": "TEXT", "required": True},
                {"name": "zone_id", "type": "TEXT"},
                {"name": "label", "type": "TEXT"},
                {"name": "value", "type": "REAL"},
                {"name": "unit", "type": "TEXT"},
                {"name": "status", "type": "TEXT"},
                {"name": "sensor_type", "type": "TEXT"},
            ],
        },
        "timeseries.schema.json": {
            "category": "collected",
            "columns": [
                {"name": "timestamp", "type": "TIMESTAMP", "required": True},
                {"name": "metric_type", "type": "TEXT", "required": True},
                {"name": "sensor_id", "type": "TEXT"},
                {"name": "value", "type": "REAL"},
                {"name": "unit", "type": "TEXT"},
            ],
        },
        "event_logs.schema.json": {
            "category": "event_logs",
            "columns": [
                {"name": "at", "type": "TIMESTAMP", "required": True},
                {"name": "log_category", "type": "TEXT", "required": True},
                {"name": "type", "type": "TEXT"},
                {"name": "message", "type": "TEXT"},
                {"name": "detail_json", "type": "TEXT"},
            ],
        },
    }
    for name, schema in schemas.items():
        _write_json(schema_dir / name, schema)

    # --- manifest ---
    manifest_files = []
    for category_dir, category_name in ((collected, "collected"), (event_logs, "event_logs")):
        if not category_dir.exists():
            continue
        for fp in sorted(category_dir.rglob("*")):
            if not fp.is_file():
                continue
            rel = fp.relative_to(batch_dir).as_posix()
            ext = fp.suffix.lower().lstrip(".")
            fmt = "ndjson" if ext in ("ndjson", "jsonl") else ext or "bin"
            ctype = {
                "csv": "text/csv; charset=utf-8",
                "json": "application/json",
                "ndjson": "application/x-ndjson",
            }.get(fmt, "application/octet-stream")
            entry: Dict[str, Any] = {
                "path": rel,
                "category": category_name,
                "format": fmt,
                "content_type": ctype,
                "encoding": "UTF-8",
                "size_bytes": fp.stat().st_size,
            }
            if fmt == "csv":
                entry["delimiter"] = ","
                entry["header"] = True
            manifest_files.append(entry)

    for fp in sorted(meta_dir.glob("*")):
        manifest_files.append(
            {
                "path": f"metadata/{fp.name}",
                "category": "metadata",
                "format": "json",
                "content_type": "application/json",
                "encoding": "UTF-8",
                "size_bytes": fp.stat().st_size,
            }
        )
    for fp in sorted(schema_dir.glob("*")):
        manifest_files.append(
            {
                "path": f"schemas/{fp.name}",
                "category": "metadata",
                "format": "json",
                "content_type": "application/json",
                "encoding": "UTF-8",
                "size_bytes": fp.stat().st_size,
            }
        )

    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "generated_at": utc_now(),
        "batch_id": batch,
        "encoding": "UTF-8",
        "data_purpose": "sensor_collection_and_event_logs",
        "dataset": dataset_info["base_informations"],
        "upload_categories": {
            "collected": {"folder": FOLDER_COLLECTED, "path": "collected/"},
            "event_logs": {"folder": FOLDER_EVENT_LOGS, "path": "event_logs/"},
        },
        "files": manifest_files,
        "minio_upload": {
            "recommended_command": f"mc cp --recursive {root}/zip_packages/latest/ myminio/sagohub-data/",
        },
    }
    _write_json(batch_dir / "manifest.json", manifest)

    dataset_id = _next_dataset_id(root)
    zip_root = build_upload_zip_packages(batch_dir, root, batch, dataset_id)
    manifest["zip_packages"] = {
        "dataset_id": dataset_id,
        "company_folder": COMPANY_FOLDER,
        "path": str(zip_root.relative_to(root)),
        "latest_path": "zip_packages/latest",
        "upload_zip": UPLOAD_ZIP_FILENAME,
        "folders_inside_zip": [FOLDER_COLLECTED, FOLDER_EVENT_LOGS],
    }
    _write_json(batch_dir / "manifest.json", manifest)

    latest_dir = root / "latest"
    if latest_dir.exists():
        shutil.rmtree(latest_dir)
    shutil.copytree(batch_dir, latest_dir)

    batches_index = load_json(root / "batches_index.json", {"batches": []})
    if not isinstance(batches_index.get("batches"), list):
        batches_index["batches"] = []
    batches_index["batches"].append(
        {
            "batch_id": batch,
            "generated_at": utc_now(),
            "path": f"batches/{batch}",
            "dataset_id": dataset_id,
            "zip_path": f"zip_packages/{COMPANY_FOLDER}/{dataset_id}",
            "categories": [FOLDER_COLLECTED, FOLDER_EVENT_LOGS],
        }
    )
    batches_index["batches"] = batches_index["batches"][-48:]
    batches_index["latest"] = "latest"
    _write_json(root / "batches_index.json", batches_index)

    _last_export_at = now_ts
    _last_export_mtime = src_mtime
    return batch_dir


if __name__ == "__main__":
    out = export_minio_upload_package(force=True)
    root = upload_root()
    print(f"MinIO upload package: {out}")
    print(f"Zip packages: {root / 'zip_packages' / 'latest'}")
