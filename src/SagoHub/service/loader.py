"""
서비스 로더: services/ 폴더에서 서비스 스캔 및 로드
"""
from pathlib import Path
from typing import Dict, List, Optional

from .schema import ServiceDef


class ServiceLoader:
    """서비스 로더"""

    def __init__(self, services_dir: Path):
        self.services_dir = Path(services_dir)
        self.services_dir.mkdir(parents=True, exist_ok=True)

    def scan_services(self) -> List[Path]:
        """services/ 폴더에서 service.yaml 파일 스캔"""
        services = []
        if not self.services_dir.exists():
            return services
        for item in self.services_dir.iterdir():
            if item.is_dir():
                # service.yaml
                yaml_path = item / "service.yaml"
                if yaml_path.exists():
                    services.append(yaml_path)
        return services

    def load_service(self, yaml_path: Path) -> Optional[ServiceDef]:
        """서비스 YAML 파일 로드"""
        try:
            return ServiceDef.from_yaml(yaml_path)
        except Exception as e:
            print(f"⚠️ 서비스 로드 실패 ({yaml_path}): {e}")
            return None

    def load_all_services(self) -> Dict[str, ServiceDef]:
        """모든 서비스 로드"""
        services = {}
        yaml_paths = self.scan_services()
        for yaml_path in yaml_paths:
            svc = self.load_service(yaml_path)
            if svc:
                services[svc.metadata.id] = svc
        return services
