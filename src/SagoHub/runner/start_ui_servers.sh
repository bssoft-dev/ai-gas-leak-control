#!/bin/bash
# UI 서버 동적 실행 스크립트
# 각 서비스의 service.yaml에서 UI 서버 설정을 읽어서 Docker 컨테이너로 실행

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PIPELINES_DIR="${PIPELINES_DIR:-${SERVICES_DIR:-$PROJECT_ROOT/services}}"
EVENT_BUS_URL="${EVENT_BUS_URL:-http://event-bus:8000}"

echo "============================================================"
echo "UI 서버 동적 실행"
echo "============================================================"
echo "서비스 디렉토리: $PIPELINES_DIR"
echo "SagoHub URL: $EVENT_BUS_URL"
echo ""

# Python 스크립트로 UI 서버 목록 생성 및 실행
python3 << EOF
import os
import yaml
import subprocess
from pathlib import Path

pipelines_dir = Path("$PIPELINES_DIR")
event_bus_url = "$EVENT_BUS_URL"
script_dir = Path("$SCRIPT_DIR")

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
    except Exception as e:
        print(f"⚠️  {service_yaml} 파싱 실패: {e}")
        continue
    
    service_info = service_data.get('service', {})
    service_id = service_info.get('id')
    if not service_id:
        continue
    
    ui_server_config = service_info.get('ui_server')
    print(f"    UI 서버 설정(config): {ui_server_config}")
    if not ui_server_config:
        continue
    
    external_port = ui_server_config.get('external_port')
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
        'external_port': external_port,
        'internal_port': internal_port,
        'event_bus_url': ui_server_config.get('event_bus_url', event_bus_url)
    })

if not ui_servers:
    print("⚠️  실행할 UI 서버가 없습니다.")
    exit(0)

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
        'foldering-engine',  # 이미지 이름
        'python', 'service_ui_runner.py'
    ]
    
    try:
        subprocess.run(cmd, check=True, cwd=script_dir)
        print(f"   ✅ 시작 완료\n")
    except subprocess.CalledProcessError as e:
        print(f"   ❌ 시작 실패: {e}\n")

print("✅ 모든 UI 서버 실행 완료")
EOF

echo ""
echo "실행 중인 UI 서버 확인:"
docker ps --filter "name=SagoHub-ui-" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
