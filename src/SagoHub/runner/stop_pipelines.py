#!/usr/bin/env python3
"""
서비스 중지 스크립트
"""
import os
import sys
import subprocess
from pathlib import Path

def main():
    use_docker = os.getenv("USE_DOCKER", "false").lower() in ("true", "1", "yes")
    
    print("============================================================")
    print("서비스 중지")
    print("============================================================")
    
    if use_docker:
        # Docker 모드: 컨테이너 중지
        result = subprocess.run(
            ['docker', 'ps', '--filter', 'name=SagoHub-service-', '--format', '{{.Names}}'],
            capture_output=True,
            text=True
        )
        
        containers = [c.strip() for c in result.stdout.strip().split('\n') if c.strip()]
        
        if not containers:
            print("실행 중인 서비스가 없습니다.")
            return
        
        print("중지할 서비스:")
        for container in containers:
            print(f"  - {container}")
        print("")
        
        for container in containers:
            print(f"🛑 중지 중: {container}")
            try:
                subprocess.run(['docker', 'stop', container], check=True)
                subprocess.run(['docker', 'rm', container], check=True)
            except subprocess.CalledProcessError as e:
                print(f"   ⚠️  중지 실패: {e}")
        
        print("\n✅ 모든 서비스 중지 완료")
    else:
        # 직접 실행 모드: 프로세스 종료
        print("직접 실행 모드에서는 프로세스를 수동으로 종료하세요.")
        print("각 서비스 프로세스에 Ctrl+C를 보내거나 프로세스를 종료하세요.")

if __name__ == "__main__":
    main()
