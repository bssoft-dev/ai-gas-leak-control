#!/bin/bash
# UI 서버 중지 스크립트

set -e

echo "============================================================"
echo "UI 서버 중지"
echo "============================================================"

# 실행 중인 모든 UI 서버 컨테이너 찾기 및 중지
containers=$(docker ps --filter "name=SagoHub-ui-" --format "{{.Names}}")

if [ -z "$containers" ]; then
    echo "실행 중인 UI 서버가 없습니다."
    exit 0
fi

echo "중지할 UI 서버:"
echo "$containers"
echo ""

for container in $containers; do
    echo "🛑 중지 중: $container"
    docker stop "$container" || true
    docker rm "$container" || true
done

echo ""
echo "✅ 모든 UI 서버 중지 완료"
