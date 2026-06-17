#!/usr/bin/env python3
"""SagoHub 서비스 기반 아키텍처 테스트"""
import os
import sys
import tempfile
from pathlib import Path

RUNNER_ROOT = Path(__file__).resolve().parent
SRC_ROOT = RUNNER_ROOT.parent.parent
PROJECT_ROOT = SRC_ROOT.parent
sys.path.insert(0, str(SRC_ROOT))

try:
    import yaml
except ImportError:
    print("⚠️ PyYAML이 필요합니다: pip install pyyaml")
    sys.exit(1)

from SagoHub.service import Service, ServiceLoader, ServiceManager
from SagoHub.core import Orchestrator


def test_service_yaml_parsing():
    """service.yaml 파싱 테스트"""
    print("=" * 60)
    print("Service YAML 파싱 테스트")
    print("=" * 60)
    
    yaml_content = """
service:
  id: "com.SagoHub.test"
  version: "1.0.0"
  name: "Test Service"
  description: "테스트 서비스"
  author: "Test"
  category: "utility"

config:
  target_folder:
    type: "path"
    label: "타겟 폴더"
    default: "./test"
    required: true

pipelines:
  - name: "Test Pipeline"
    on:
      event: "FILE_CREATED"
      filter: "**/*.txt"
    steps:
      - id: "step1"
        module: "fs.read"
        args:
          path: "${event.path}"
"""
    
    with tempfile.TemporaryDirectory() as tmp:
        yaml_path = Path(tmp) / "service.yaml"
        yaml_path.write_text(yaml_content, encoding="utf-8")
        svc = Service.from_yaml(yaml_path)
        assert svc.metadata.id == "com.SagoHub.test"
        assert svc.metadata.version == "1.0.0"
        assert len(svc.pipelines) == 1, f"파이프라인 수: {len(svc.pipelines)}"
        assert svc.pipelines[0].name == "Test Pipeline"
        assert len(svc.config_schema) == 1
        assert "target_folder" in svc.config_schema
        print("✅ Service YAML 파싱 OK")
    print()


def test_service_loader():
    """서비스 로더 테스트"""
    print("=" * 60)
    print("Service Loader 테스트")
    print("=" * 60)
    
    with tempfile.TemporaryDirectory() as tmp:
        services_dir = Path(tmp) / "services"
        services_dir.mkdir()
        test_service_dir = services_dir / "test-service"
        test_service_dir.mkdir()
        yaml_path = test_service_dir / "service.yaml"
        yaml_path.write_text("""
service:
  id: "com.SagoHub.test"
  version: "1.0.0"
  name: "Test"
  description: "Test"
config: {}
pipelines: []
""", encoding="utf-8")
        
        loader = ServiceLoader(services_dir)
        services = loader.load_all_services()
        assert len(services) == 1
        assert "com.SagoHub.test" in services
        print(f"✅ 서비스 로드: {len(services)}개")
    print()


def test_service_manager():
    """서비스 매니저 테스트"""
    print("=" * 60)
    print("Service Manager 테스트")
    print("=" * 60)
    
    with tempfile.TemporaryDirectory() as tmp:
        services_dir = Path(tmp) / "services"
        services_dir.mkdir()
        test_service_dir = services_dir / "test-service"
        test_service_dir.mkdir()
        yaml_path = test_service_dir / "service.yaml"
        yaml_path.write_text("""
service:
  id: "com.SagoHub.test"
  version: "1.0.0"
  name: "Test"
  description: "Test"
config:
  target:
    type: "string"
    default: "default_value"
pipelines:
  - name: "Test"
    on:
      event: "FILE_CREATED"
      filter: "**/*"
    steps:
      - module: "fs.read"
        args: {}
""", encoding="utf-8")
        
        orch = Orchestrator()
        manager = ServiceManager(services_dir, orchestrator=orch)
        services = manager.load_all()
        assert len(services) == 1
        
        # 기본값 적용 확인
        svc = services["com.SagoHub.test"]
        assert svc.config.get("target") == "default_value"
        
        # 활성화
        assert manager.activate_service("com.SagoHub.test")
        assert len(manager.list_active()) == 1
        
        # 비활성화
        assert manager.deactivate_service("com.SagoHub.test")
        assert len(manager.list_active()) == 0
        
        print("✅ 서비스 매니저 생명주기 OK")
    print()


def test_variable_resolution():
    """동적 변수 참조 해석 테스트"""
    print("=" * 60)
    print("동적 변수 참조 테스트")
    print("=" * 60)
    
    from SagoHub.service.schema import Service, ServiceMetadata, ServiceConfig
    
    svc = Service(
        metadata=ServiceMetadata(id="test", version="1.0.0", name="Test"),
        config=ServiceConfig(values={"target_folder": "./test", "enabled": True}),
    )
    
    # config 변수
    result = svc.resolve_variable("${config.target_folder}", {})
    assert result == "./test"
    
    # event 변수
    context = {"event": {"path": "/path/to/file.txt", "filename": "file.txt"}}
    result = svc.resolve_variable("${event.path}", context)
    assert result == "/path/to/file.txt"
    
    # 복합 문자열
    result = svc.resolve_variable("Path: ${event.path}, Config: ${config.target_folder}", context)
    assert "Path: /path/to/file.txt" in result
    assert "Config: ./test" in result
    
    print("✅ 동적 변수 참조 해석 OK")
    print()


if __name__ == "__main__":
    test_service_yaml_parsing()
    test_service_loader()
    test_service_manager()
    test_variable_resolution()
    print("=" * 60)
    print("SagoHub 서비스 아키텍처 테스트 완료")
    print("=" * 60)
