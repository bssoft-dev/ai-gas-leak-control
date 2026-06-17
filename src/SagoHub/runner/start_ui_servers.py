#!/usr/bin/env python3
"""
UI 서버 동적 실행 스크립트 (Python 버전)
각 서비스의 service.yaml에서 UI 서버 설정을 읽어서 Docker 컨테이너로 실행
"""
import os
import yaml
import subprocess
import sys
from pathlib import Path

def main():
    script_dir = Path(__file__).resolve().parent  # SagoHub/runner
    project_root = script_dir.parent.parent.parent  # src -> project root
    pipelines_dir = Path(os.getenv("PIPELINES_DIR", os.getenv("SERVICES_DIR", str(project_root / "services"))))
    event_bus_url = os.getenv("EVENT_BUS_URL", "http://event-bus:8000")
    
    print("============================================================")
    print("UI 서버 동적 실행")
    print("============================================================")
    print(f"서비스 디렉토리: {pipelines_dir}")
    print(f"SagoHub URL: {event_bus_url}")
    print("")
    
    if not pipelines_dir.exists():
        print(f"❌ 서비스 디렉토리를 찾을 수 없습니다: {pipelines_dir}")
        sys.exit(1)
    
    ui_servers = []
    
    # 각 서비스의 YAML 파일 읽기
    for service_dir in pipelines_dir.iterdir():
        if not service_dir.is_dir():
            continue
        
        service_yaml = service_dir / "service.yaml"
        if not service_yaml.exists():
            continue
        
        try:
            with open(service_yaml, 'r', encoding='utf-8') as f:
                service_data = yaml.safe_load(f)
                print(f"   서비스 데이터: {service_data}")
        except Exception as e:
            print(f"⚠️  {service_yaml} 파싱 실패: {e}")
            continue
        
        service_info = service_data.get('service', {})
        service_id = service_info.get('id')
        if not service_id:
            continue
        
        ui_server_config = service_info.get('ui_server')
        if not ui_server_config:
            continue
        
        host = ui_server_config.get('host', 'localhost')
        if host is None:
            print(f"⚠️  {service_id}: host가 설정되지 않았습니다. 스킵합니다.")
            continue
        
        external_port = os.getenv("SERVICE_UI_PORT", ui_server_config.get('external_port'))
        if external_port is None:
            print(f"⚠️  {service_id}: external_port가 설정되지 않았습니다. 스킵합니다.")
            continue
        
        internal_port = ui_server_config.get('port', 8080)
        service_name = service_id.split('.')[-1]
        container_name = f"SagoHub-ui-{service_name.replace('-', '_')}"
        
        ui_servers.append({
            'service_id': service_id,
            'service_name': service_name,
            'container_name': container_name,
            'host': host,
            'external_port': external_port,
            'internal_port': internal_port,
            'event_bus_url': ui_server_config.get('event_bus_url', event_bus_url)
        })
    
    if not ui_servers:
        print("⚠️  실행할 UI 서버가 없습니다.")
        return
    
    print(f"발견된 UI 서버: {len(ui_servers)}개\n")
    
    # 각 UI 서버 실행
    for server in ui_servers:
        service_id = server['service_id']
        container_name = server['container_name']
        external_port = server['external_port']
        internal_port = server['internal_port']
        
        # 이미 실행 중인지 확인
        result = subprocess.run(
            ['docker', 'ps', '--filter', f'name={container_name}', '--format', '{{.Names}}'],
            capture_output=True,
            text=True
        )
        
        if container_name in result.stdout:
            print(f"⏭️  {service_id} 이미 실행 중입니다. (포트: {external_port})")
            continue
        
        print(f"🚀 UI 서버 시작: {service_id}")
        print(f"   컨테이너: {container_name}")
        print(f"   포트: {external_port}:{internal_port}")
        
        # Docker 이미지 확인 및 빌드
        image_name = 'foldering-engine'
        check_image = subprocess.run(
            ['docker', 'images', '--format', '{{.Repository}}', image_name],
            capture_output=True,
            text=True
        )
        
        if image_name not in check_image.stdout:
            print(f"   ⚠️  Docker 이미지 '{image_name}'가 없습니다.")
            print(f"   💡 먼저 'docker-compose build'를 실행하세요.")
            continue
        
        # Docker 명령어 구성
        cmd = [
            'docker', 'run', '-d',
            '--name', container_name,
            '--network', 'foldering-network',
            '-p', f'{external_port}:{internal_port}',
            '-v', f'{pipelines_dir}:/services:ro',
            '-e', f'SERVICE_ID={service_id}',
            '-e', 'PIPELINES_DIR=/services',
            '-e', f'EVENT_BUS_URL={server["event_bus_url"]}',
            '--restart', 'unless-stopped',
            image_name,
            'python', 'service_ui_runner.py'
        ]
        
        try:
            subprocess.run(cmd, check=True, cwd=script_dir)
            print(f"   ✅ 시작 완료\n")
        except subprocess.CalledProcessError as e:
            print(f"   ❌ 시작 실패: {e}\n")
    
    print("✅ 모든 UI 서버 실행 완료")
    print("\n실행 중인 UI 서버 확인:")
    subprocess.run(['docker', 'ps', '--filter', 'name=SagoHub-ui-', '--format', 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'])

if __name__ == "__main__":
    main()
