#!/usr/bin/env python3
"""
서비스 동적 실행 스크립트
각 서비스의 service.yaml에서 서비스를 읽어서 Docker 컨테이너 또는 프로세스로 실행
"""
import os
import sys
import yaml
import subprocess
from pathlib import Path

def main():
    script_dir = Path(__file__).resolve().parent  # SagoHub/runner
    project_root = script_dir.parent.parent.parent  # src -> project root
    pipelines_dir = Path(os.getenv("PIPELINES_DIR", os.getenv("SERVICES_DIR", str(project_root / "services"))))
    use_docker = os.getenv("USE_DOCKER", "false").lower() in ("true", "1", "yes")
    
    # EVENT_BUS_URL 설정: Docker 모드면 event-bus, 직접 실행 모드면 localhost
    if os.getenv("EVENT_BUS_URL"):
        event_bus_url = os.getenv("EVENT_BUS_URL")
    elif use_docker:
        event_bus_url = "http://event-bus:8000"
    else:
        event_bus_host = os.getenv("EVENT_BUS_HOST", "localhost")
        event_bus_port = os.getenv("EVENT_BUS_PORT", "8000")
        event_bus_url = f"http://{event_bus_host}:{event_bus_port}"
    
    print("============================================================")
    print("서비스 동적 실행")
    print("============================================================")
    print(f"서비스 디렉토리: {pipelines_dir}")
    print(f"SagoHub URL: {event_bus_url}")
    print(f"실행 모드: {'Docker' if use_docker else '직접 실행'}")
    print("")
    
    if not pipelines_dir.exists():
        print(f"❌ 서비스 디렉토리를 찾을 수 없습니다: {pipelines_dir}")
        sys.exit(1)
    
    services = []
    
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
        
        services.append({
            'service_id': service_id,
            'service_dir': service_dir,
        })
    
    if not services:
        print("⚠️  실행할 서비스가 없습니다.")
        return
    
    print(f"발견된 서비스: {len(services)}개\n")
    
    # 선택된 서비스 필터링 (SELECTED_PIPELINE / SELECTED_SERVICE 환경 변수)
    selected_pipeline = os.getenv("SELECTED_SERVICE", os.getenv("SELECTED_PIPELINE", ""))
    if selected_pipeline:
        services = [s for s in services if 
                     s['service_id'] == selected_pipeline or 
                     s['service_id'].endswith(f".{selected_pipeline}")]
        if not services:
            print(f"⚠️  선택된 서비스를 찾을 수 없습니다: {selected_pipeline}")
            return
    
    # 각 서비스 실행
    for service in services:
        service_id = service['service_id']
        service_name = service_id.split('.')[-1]
        
        if use_docker:
            # Docker 모드: 별도 컨테이너로 실행
            container_name = f"SagoHub-service-{service_name.replace('-', '_')}"
            
            # 이미 실행 중인지 확인
            result = subprocess.run(
                ['docker', 'ps', '--filter', f'name={container_name}', '--format', '{{.Names}}'],
                capture_output=True,
                text=True
            )
            
            if container_name in result.stdout:
                print(f"⏭️  {service_id} 이미 실행 중입니다.")
                continue
            
            print(f"🚀 서비스 시작 (Docker): {service_id}")
            print(f"   컨테이너: {container_name}")
            
            # Docker 명령어 구성
            cmd = [
                'docker', 'run', '-d',
                '--name', container_name,
                '--network', 'foldering-network',
                '-v', f'{pipelines_dir}:/services:ro',
                '-e', f'PIPELINES_DIR=/services',
                '-e', f'EVENT_BUS_URL={event_bus_url}',
                '--restart', 'unless-stopped',
                'foldering-engine',  # 이미지 이름
                'python', 'service_runner.py', service_id
            ]
            
            try:
                subprocess.run(cmd, check=True, cwd=script_dir)
                print(f"   ✅ 시작 완료\n")
            except subprocess.CalledProcessError as e:
                print(f"   ❌ 시작 실패: {e}\n")
        else:
            # 직접 실행 모드: 별도 프로세스로 실행
            print(f"🚀 서비스 시작 (프로세스): {service_id}")
            
            try:
                # 별도 프로세스로 실행
                process = subprocess.Popen(
                    [sys.executable, str(script_dir / "service_runner.py"), service_id],
                    cwd=str(script_dir),
                    env=dict(os.environ, **{
                        'PIPELINES_DIR': str(pipelines_dir),
                        'EVENT_BUS_URL': event_bus_url,
                    })
                )
                print(f"   ✅ 시작 완료 (PID: {process.pid})\n")
            except Exception as e:
                print(f"   ❌ 시작 실패: {e}\n")
    
    print("✅ 모든 서비스 실행 완료")
    
    if use_docker:
        print("\n실행 중인 서비스 확인:")
        subprocess.run(['docker', 'ps', '--filter', 'name=SagoHub-service-', '--format', 'table {{.Names}}\t{{.Status}}'])

if __name__ == "__main__":
    main()
