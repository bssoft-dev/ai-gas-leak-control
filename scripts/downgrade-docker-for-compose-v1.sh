#!/bin/bash
# docker-compose 1.x(Python) + Docker Engine 27+ 조합에서 KeyError 'ContainerConfig' 가 날 때,
# Ubuntu 24.04(noble) 기본 저장소의 docker.io 24.x 로 맞추는 스크립트입니다.
#
# 사용법 (프로젝트 루트에서):
#   sudo bash scripts/downgrade-docker-for-compose-v1.sh
#
# 나중에 다시 최신 Docker로 올리려면:
#   sudo apt-mark unhold docker.io
#   sudo apt-get update && sudo apt-get upgrade docker.io
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "관리자 권한이 필요합니다. 실행: sudo bash $0"
  exit 1
fi

TARGET_DOCKER="docker.io=24.0.7-0ubuntu4"

echo "==> APT 업데이트"
apt-get update -qq

echo "==> docker.io 를 ${TARGET_DOCKER} 로 다운그레이드 (docker-compose 1.x 호환)"
apt-get install -y --allow-downgrades "${TARGET_DOCKER}"

echo "==> 자동 업그레이드로 다시 27.x 로 올라가지 않도록 버전 고정 (hold)"
apt-mark hold docker.io

echo ""
echo "설치된 버전:"
docker --version || true

echo ""
echo "완료. 이제 docker-compose up -d --build 를 다시 시도하세요."
echo "보안 업데이트를 받으려면 나중에 apt-mark unhold docker.io 후 upgrade 하세요."
