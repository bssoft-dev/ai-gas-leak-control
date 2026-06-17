#!/usr/bin/env python3
"""
서비스 UI 서버 실행 스크립트
"""
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Union

RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
sys.path.insert(0, str(SRC_ROOT))

from SagoHub.service.ui_server import create_ui_server, _resolve_binding_path
from SagoHub.service.loader import ServiceLoader


def _get_frontend_dir(service_def, services_dir: Path) -> Optional[Path]:
    """서비스의 첫 번째 interface binding에서 frontend 디렉토리 경로 반환."""
    if not getattr(service_def, "interfaces", None) or not service_def.interfaces:
        return None
    iface = service_def.interfaces[0]
    if not iface.binding:
        return None
    binding_path = _resolve_binding_path(
        iface.binding,
        services_dir,
        service_def.service_dir if service_def else None,
    )
    if not binding_path or not (binding_path / "package.json").exists():
        return None
    return binding_path


def main(
    service_id: str,
    services_dir: Optional[Union[str, Path]] = None,
    event_bus_url: Optional[str] = None,
    port: Optional[int] = None,
):
    """서비스 UI 서버 실행."""
    services_dir = services_dir or os.getenv("PIPELINES_DIR", os.getenv("SERVICES_DIR", str(PROJECT_ROOT / "services")))
    services_dir = Path(services_dir) if isinstance(services_dir, str) else services_dir
    event_bus_url = event_bus_url or os.getenv("EVENT_BUS_URL", "http://localhost:8000")

    loader = ServiceLoader(services_dir)
    services = loader.load_all_services()
    service_def = services.get(service_id)
    if not service_def:
        raise ValueError(f"서비스를 찾을 수 없습니다: {service_id}")

    if not getattr(service_def, "interfaces", None) or len(service_def.interfaces) == 0:
        print(f"⚠️  서비스에 interface가 정의되지 않았습니다. UI 서버를 건너뜁니다: {service_id}")
        return

    ui_server_config = service_def.metadata.ui_server
    if port is None:
        if ui_server_config:
            port = ui_server_config.external_port if ui_server_config.external_port is not None else ui_server_config.port
            port = int(port)
        else:
            port = int(os.getenv("UI_PORT", "8080"))

    # 서비스별 모드: service.yaml의 ui_server.mode (publish | dev)
    use_frontend_dev = (
        ui_server_config is not None
        and getattr(ui_server_config, "mode", "publish").strip().lower() == "dev"
    )
    try:
        frontend_dev_port = int(os.getenv("FRONTEND_DEV_PORT", "5173").strip() or "5173")
    except (ValueError, TypeError):
        frontend_dev_port = 5173
    if use_frontend_dev:
        frontend_dir = _get_frontend_dir(service_def, services_dir)
        if frontend_dir:
            print(f"📦 FRONTEND_DEV: npm run dev 실행 중: {frontend_dir}")
            try:
                # Vite를 고정 포트에서 실행 (UI 서버가 같은 포트에서 프록시하므로)
                subprocess.Popen(
                    ["npm", "run", "dev", "--", "--port", str(frontend_dev_port)],
                    cwd=str(frontend_dir),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
            except Exception as e:
                print(f"⚠️  npm run dev 시작 실패: {e}")
            else:
                # Vite 기동 대기 (같은 포트에서 프록시하므로)
                for _ in range(15):
                    try:
                        import urllib.request
                        urllib.request.urlopen(f"http://127.0.0.1:{frontend_dev_port}", timeout=1)
                        break
                    except Exception:
                        time.sleep(0.5)
                else:
                    print("⚠️  Vite dev 서버 기동 대기 중... (첫 요청이 지연될 수 있음)")
        else:
            print("⚠️  FRONTEND_DEV이지만 frontend 디렉토리를 찾을 수 없습니다.")

    print(f"🚀 서비스 UI 서버 시작: {service_id}")
    print(f"   포트: {port}")
    print(f"   서비스 디렉토리: {services_dir}")
    print(f"   SagoHub URL: {event_bus_url}")
    create_ui_server(
        service_id,
        str(services_dir),
        event_bus_url,
        port,
        use_frontend_dev=use_frontend_dev,
        frontend_dev_port=frontend_dev_port if use_frontend_dev else None,
    )


if __name__ == "__main__":
    service_id = os.getenv("SERVICE_ID")
    if not service_id:
        print("❌ SERVICE_ID 환경 변수가 필요합니다.")
        sys.exit(1)
    main(service_id)
