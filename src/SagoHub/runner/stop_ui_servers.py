#!/usr/bin/env python3
"""
UI 서버 중지 스크립트 (Python 버전)
"""
import subprocess
import sys

def main():
    print("============================================================")
    print("UI 서버 중지")
    print("============================================================")
    
    # 실행 중인 모든 UI 서버 컨테이너 찾기
    result = subprocess.run(
        ['docker', 'ps', '--filter', 'name=SagoHub-ui-', '--format', '{{.Names}}'],
        capture_output=True,
        text=True
    )
    
    containers = [c.strip() for c in result.stdout.strip().split('\n') if c.strip()]
    
    if not containers:
        print("실행 중인 UI 서버가 없습니다.")
        return
    
    print("중지할 UI 서버:")
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
    
    print("")
    print("✅ 모든 UI 서버 중지 완료")

if __name__ == "__main__":
    main()
