import asyncio
import re
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from supabase import AsyncClient, create_async_client

from .settings import settings


# gateway/hub/app.py -> 프로젝트 루트 (services/ 폴더 위치)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

SERVICE_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


def _services_root_path() -> Path:
    if settings.hub_services_dir:
        return Path(settings.hub_services_dir).expanduser().resolve()
    return _PROJECT_ROOT / "services"


def _recipe_for_folder_name(folder_name: str) -> Optional[list[str]]:
    """폴더명과 HUB_RECIPES 키가 다를 수 있어(하이픈/언더스코어) 매칭 시도."""
    if folder_name in settings.recipes:
        return settings.recipes[folder_name]
    alt = folder_name.replace("-", "_")
    if alt != folder_name and alt in settings.recipes:
        return settings.recipes[alt]
    alt2 = folder_name.replace("_", "-")
    if alt2 != folder_name and alt2 in settings.recipes:
        return settings.recipes[alt2]
    return None


def _discover_services_from_fs() -> dict[str, Any]:
    root = _services_root_path()
    if not root.is_dir():
        return {
            "services": [],
            "count": 0,
            "services_root": str(root),
            "warning": "services directory not found",
        }

    entries: list[dict[str, Any]] = []
    for p in sorted(root.iterdir()):
        if not p.is_dir():
            continue
        name = p.name
        if name.startswith(".") or name in ("__pycache__",):
            continue
        entries.append(
            {
                "id": name,
                "path": str(p.resolve()),
                "has_service_yaml": (p / "service.yaml").is_file(),
                "hub_recipe": _recipe_for_folder_name(name),
            }
        )

    return {"services": entries, "count": len(entries), "services_root": str(root.resolve())}


def _task_table(service_name: str) -> str:
    if not SERVICE_RE.match(service_name):
        raise HTTPException(status_code=400, detail="Invalid service_name")
    return f"{service_name}_tasks"


def _table_query(table_name: str):
    """설정된 스키마(HUB_SUPABASE_SCHEMA)로 고정된 테이블 쿼리 핸들러."""
    assert supabase is not None
    return supabase.schema(settings.supabase_schema).table(table_name)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _history_item(step: str, status: str, result: Any = None, error: Any = None) -> dict[str, Any]:
    item: dict[str, Any] = {"step": step, "status": status, "at_ms": _now_ms()}
    if result is not None:
        item["result"] = result
    if error is not None:
        item["error"] = error
    return item


app = FastAPI(title="BS Message Hub", version="0.1.0")
supabase: Optional[AsyncClient] = None
_supabase_lock = asyncio.Lock()


async def _reinit_supabase_client() -> None:
    """설정 변경 후 비동기 Supabase 클라이언트 재생성."""
    global supabase
    settings.validate()
    async with _supabase_lock:
        supabase = await create_async_client(settings.supabase_url, settings.supabase_key)


async def _require_hub_config_auth(request: Request) -> None:
    """HUB_CONFIG_SECRET이 설정된 경우에만 POST /supabase/config 보호."""
    secret = settings.config_secret
    if not secret:
        return
    auth = request.headers.get("authorization") or ""
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = (request.headers.get("x-hub-config-token") or "").strip()
    if token != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing hub config token")


@app.on_event("startup")
async def _startup() -> None:
    global supabase
    settings.validate()
    supabase = await create_async_client(settings.supabase_url, settings.supabase_key)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True}


@app.post("/events")
async def ingest_event(request: Request) -> dict[str, Any]:
    """
    외부에서 이벤트를 수신해 Supabase `events` 테이블에 저장합니다.

    본문(JSON):
    - service_id (필수)
    - source_id (필수)
    - session_id (선택)
    - task_id (선택)
    - event_type (선택)
    - payload (선택, 객체. 기본 {})
    - metadata (선택, 객체. 기본 {})
    - event_id (선택, 미입력 시 서버에서 UUID 생성)
    - timestamp (선택, ISO8601 문자열 등 PostgREST가 파싱 가능한 값)
    """
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required")

    service_id = body.get("service_id")
    source_id = body.get("source_id")
    if not service_id or not source_id:
        raise HTTPException(status_code=400, detail="service_id and source_id are required")

    payload = body.get("payload")
    if payload is None:
        payload = {}
    elif not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be a JSON object")

    metadata = body.get("metadata")
    if metadata is None:
        metadata = {}
    elif not isinstance(metadata, dict):
        raise HTTPException(status_code=400, detail="metadata must be a JSON object")

    event_id = body.get("event_id")
    if event_id is not None:
        event_id = str(event_id).strip()
    if not event_id:
        event_id = str(uuid.uuid4())

    row: dict[str, Any] = {
        "event_id": event_id,
        "service_id": str(service_id).strip(),
        "source_id": str(source_id).strip(),
        "payload": payload,
        "metadata": metadata,
    }

    if body.get("session_id") is not None:
        row["session_id"] = str(body["session_id"]).strip() or None
    if body.get("task_id") is not None:
        row["task_id"] = str(body["task_id"]).strip() or None
    if body.get("event_type") is not None:
        row["event_type"] = str(body["event_type"]).strip() or None
    if body.get("timestamp") is not None:
        row["timestamp"] = body["timestamp"]

    assert supabase is not None
    try:
        res = await _table_query("events").insert(row).execute()
    except Exception as e:
        err = str(e).lower()
        if "duplicate" in err or "23505" in err or "unique" in err:
            raise HTTPException(status_code=409, detail="Duplicate event_id") from e
        raise HTTPException(status_code=502, detail=f"Failed to persist event: {e}") from e

    saved = res.data[0] if getattr(res, "data", None) else None
    return {"ok": True, "event": saved or row}


@app.get("/supabase/config")
async def get_supabase_config() -> dict[str, Any]:
    """
    Supabase 관련 설정 조회(비밀번호/키 전체는 반환하지 않음).
    """
    return {"supabase": settings.to_supabase_config_public()}


@app.post("/supabase/config")
async def set_supabase_config(
    request: Request,
    _: None = Depends(_require_hub_config_auth),
) -> dict[str, Any]:
    """
    Supabase URL/키 런타임 갱신(프로세스 메모리 + os.environ 동기화).
    본문 예: {"supabase_url":"...","supabase_service_role_key":"...","supabase_anon_key":"..."}
    키를 생략하면 기존 값 유지, null 또는 빈 문자열이면 해당 키 비움.

    HUB_CONFIG_SECRET이 설정된 경우 Authorization: Bearer <secret> 또는 X-Hub-Config-Token 필요.
    """
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    settings.apply_supabase_overrides(body, sync_environ=True)
    try:
        settings.validate()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        await _reinit_supabase_client()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to reinitialize Supabase client: {e}") from e
    return {"ok": True, "supabase": settings.to_supabase_config_public()}


@app.get("/supabase/status")
async def supabase_status() -> dict[str, Any]:
    """
    Supabase API(PostgREST) 연결 가능 여부 및 지연 시간(ms).
    """
    url = (settings.supabase_url or "").rstrip("/")
    key = settings.supabase_key
    if not url or not key:
        return {
            "ok": False,
            "reachable": False,
            "error": "supabase_url or key not configured",
            "latency_ms": None,
        }
    check_url = f"{url}/rest/v1/"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept-Profile": settings.supabase_schema,
    }
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(check_url, headers=headers)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        ok = 200 <= r.status_code < 300
        return {
            "ok": ok,
            "reachable": True,
            "http_status": r.status_code,
            "latency_ms": latency_ms,
            "checked_url": check_url,
        }
    except Exception as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": False,
            "reachable": False,
            "error": str(e),
            "latency_ms": latency_ms,
            "checked_url": check_url,
        }


@app.get("/services")
async def list_services() -> dict[str, Any]:
    """
    프로젝트 `services/` 폴더 아래 서비스 디렉터리 목록 조회.
    소스: 저장소 루트의 services/ (또는 환경변수 HUB_SERVICES_DIR).
    각 항목에 HUB_RECIPES와 폴더명이 맞으면 hub_recipe 필드로 레시피를 덧붙임.
    """
    return _discover_services_from_fs()


@app.get("/modules")
async def list_modules() -> dict[str, Any]:
    """
    허브가 호출 가능한 모듈 목록 조회.
    소스: HUB_MODULE_ADDRS 환경변수(=settings.module_addrs)
    """
    recipe_steps: set[str] = set()
    for recipe in settings.recipes.values():
        recipe_steps.update(recipe)

    modules = [
        {"module_name": name, "event_url": url, "used_in_any_recipe": name in recipe_steps}
        for name, url in sorted(settings.module_addrs.items())
    ]

    missing_addrs = sorted([step for step in recipe_steps if step not in settings.module_addrs])

    return {
        "modules": modules,
        "count": len(modules),
        "missing_module_addrs_for_recipe_steps": missing_addrs,
    }


@app.post("/start/{service_name}")
async def start_service(service_name: str, request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if service_name not in settings.recipes:
        raise HTTPException(status_code=404, detail="Unknown service_name (no recipe configured)")

    input_data = await request.json()
    recipe = settings.recipes[service_name]
    first_step = recipe[0]
    task_id = str(uuid.uuid4())

    table = _task_table(service_name)
    assert supabase is not None

    # 초기 상태 기록 (멱등성: task_id는 생성 시 유니크)
    await _table_query(table).insert(
        {
            "task_id": task_id,
            "current_step": first_step,
            "status": "processing",
            "payload": input_data,
            "last_input": input_data,
            "history": [_history_item(first_step, "processing")],
        }
    ).execute()

    background_tasks.add_task(_call_module_and_fail_on_error, service_name, task_id, first_step, input_data)
    return {"message": "Service started", "task_id": task_id, "current_step": first_step}


@app.get("/tasks/{service_name}/{task_id}")
async def get_task(service_name: str, task_id: str) -> dict[str, Any]:
    table = _task_table(service_name)
    assert supabase is not None
    res = await _table_query(table).select("*").eq("task_id", task_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="task_id not found")
    return res.data[0]


@app.post("/callback/{service_name}")
async def handle_callback(service_name: str, request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """
    모듈이 허브로 작업 완료를 보고하는 콜백.

    기대 페이로드:
    - task_id: str (필수)
    - step: str (필수)  # 이 콜백을 보낸 모듈/스텝
    - status: "success" | "failed" (필수)
    - result: any (선택)
    - error: any (선택)
    """
    body = await request.json()
    task_id = body.get("task_id")
    step = body.get("step")
    status = body.get("status")
    result = body.get("result")
    error = body.get("error")

    if not task_id or not step or status not in ("success", "failed"):
        raise HTTPException(status_code=400, detail="Invalid callback payload")

    table = _task_table(service_name)
    assert supabase is not None

    # 현재 상태를 읽고, 스텝/상태가 맞을 때만 전이 (무결성/멱등성)
    res = await _table_query(table).select("*").eq("task_id", task_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="task_id not found")
    row = res.data[0]

    if row.get("status") in ("success", "failed"):
        # 터미널 상태면 중복 콜백 무시 (멱등)
        return {"message": "Ignored (terminal)", "task_id": task_id, "status": row.get("status")}

    current_step = row.get("current_step")
    if current_step != step:
        # 이미 다음 스텝으로 넘어갔거나, 잘못된 콜백
        return {"message": "Ignored (step mismatch)", "task_id": task_id, "expected_step": current_step, "got_step": step}

    recipe = settings.recipes.get(service_name)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not configured")

    try:
        idx = recipe.index(step)
    except ValueError:
        raise HTTPException(status_code=400, detail="Step not in recipe")

    is_last = idx == (len(recipe) - 1)
    next_step = None if is_last else recipe[idx + 1]

    history = row.get("history") or []
    if status == "failed":
        history.append(_history_item(step, "failed", error=error))
        await _table_query(table).update(
            {
                "status": "failed",
                "error": error or {"message": "module reported failed"},
                "history": history,
            }
        ).eq("task_id", task_id).execute()
        return {"message": "Flow stopped (failed)", "task_id": task_id}

    # success
    history.append(_history_item(step, "success", result=result))

    if is_last:
        await _table_query(table).update(
            {
                "status": "success",
                "result_data": result,
                "history": history,
            }
        ).eq("task_id", task_id).execute()
        return {"message": "Flow completed", "task_id": task_id, "status": "success"}

    # 다음 스텝으로 전이 (DB 기준으로 current_step 이동)
    await _table_query(table).update(
        {
            "current_step": next_step,
            "status": "processing",
            "last_input": result,
            "history": history + [_history_item(next_step, "processing")],
        }
    ).eq("task_id", task_id).execute()

    background_tasks.add_task(_call_module_and_fail_on_error, service_name, task_id, next_step, result)
    return {"message": "Advanced", "task_id": task_id, "next_step": next_step}


async def _call_module_and_fail_on_error(service_name: str, task_id: str, step: str, payload: Any) -> None:
    """
    step 모듈을 호출. 호출 자체가 실패하면 DB를 failed로 닫는다.
    """
    table = _task_table(service_name)
    assert supabase is not None

    target_url = settings.module_addrs.get(step)
    if not target_url:
        await _mark_failed(table, task_id, step, {"message": "module address not configured", "step": step})
        return

    callback_base = settings.callback_public_base_url.rstrip("/")
    if not callback_base:
        # 기본: 현재 컨테이너/호스트 DNS를 알 수 없으므로, 사용자가 반드시 설정하는 것을 권장
        # 그래도 로컬 개발을 위해 상대적으로 안전한 기본값을 제공
        callback_base = "http://localhost:26100"

    callback_url = f"{callback_base}/callback/{service_name}"

    req_body = {
        "task_id": task_id,
        "action": "execute",
        "step": step,
        "payload": payload,
        "callback_url": callback_url,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.module_event_timeout_s) as client:
            r = await client.post(target_url, json=req_body)
            r.raise_for_status()
    except Exception as e:
        await _mark_failed(table, task_id, step, {"message": "failed to call module", "error": str(e), "target_url": target_url})


async def _mark_failed(table: str, task_id: str, step: str, error: Any) -> None:
    assert supabase is not None
    # best-effort: current_step이 이미 바뀌었을 수 있어도, task는 실패로 닫는다 (좀비 방지)
    res = await _table_query(table).select("history,status").eq("task_id", task_id).limit(1).execute()
    history = []
    if res.data:
        history = res.data[0].get("history") or []
        if (res.data[0].get("status") or "") in ("success", "failed"):
            return

    history.append(_history_item(step, "failed", error=error))
    await _table_query(table).update({"status": "failed", "error": error, "history": history}).eq("task_id", task_id).execute()

