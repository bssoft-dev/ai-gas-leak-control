#!/bin/bash
# SagoHub - 코어 전용 실행 (이벤트 버스 + 모듈만)
# 프로젝트 루트에서 실행: ./run-core.sh
# 서비스는 별도로 run-services.sh 로 실행

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
ENGINE_DIR="$PROJECT_ROOT/src/SagoHub/runner"
SERVICES_DIR="${SERVICES_DIR:-$PROJECT_ROOT/services}"

COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
DOCKER_COMPOSE_CMD=""
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
fi

cd "$ENGINE_DIR"

# .env 파일 확인 (프로젝트 루트)
ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  .env 파일이 없습니다. env.example을 복사하여 생성합니다...${NC}"
    if [ -f "$PROJECT_ROOT/env.example" ]; then
        cp "$PROJECT_ROOT/env.example" "$ENV_FILE"
        echo -e "${GREEN}✅ .env 파일 생성 완료${NC}"
        echo -e "${YELLOW}⚠️  .env 파일을 확인하고 필요한 설정을 수정하세요.${NC}"
    else
        echo -e "${RED}❌ env.example 파일을 찾을 수 없습니다.${NC}"
        exit 1
    fi
fi

# .env 파일 로드
export $(grep -v '^#' "$ENV_FILE" | xargs)

# USE_DOCKER 환경 변수 확인 (기본값: false)
USE_DOCKER="${USE_DOCKER:-false}"
USE_DOCKER=$(echo "$USE_DOCKER" | tr '[:upper:]' '[:lower:]')

echo -e "${BLUE}============================================================${NC}"
echo -e "${BLUE}SagoHub - 코어 (이벤트 버스 + 모듈)${NC}"
echo -e "${BLUE}============================================================${NC}"
echo ""
echo -e "${CYAN}코어만 실행합니다. 서비스는 ./run-services.sh 로 별도 실행하세요.${NC}"
echo -e "${BLUE}엔진 디렉토리: $ENGINE_DIR${NC}"
echo ""

# Docker 모드 확인
if [ "$USE_DOCKER" = "true" ] || [ "$USE_DOCKER" = "1" ] || [ "$USE_DOCKER" = "yes" ]; then
    echo -e "${GREEN}🐳 Docker 모드로 실행합니다${NC}"
    echo ""
    
    # Docker 설치 확인
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker가 설치되어 있지 않습니다.${NC}"
        echo "   Docker를 설치하거나 USE_DOCKER=false로 설정하세요."
        exit 1
    fi
    
    if [ -z "$DOCKER_COMPOSE_CMD" ]; then
        echo -e "${RED}❌ Docker Compose를 사용할 수 없습니다.${NC}"
        echo "   'docker compose' 또는 'docker-compose'를 설치하거나 USE_DOCKER=false로 설정하세요."
        exit 1
    fi
    
    if [ ! -f "$COMPOSE_FILE" ]; then
        echo -e "${RED}❌ docker-compose.yml을 찾을 수 없습니다: $COMPOSE_FILE${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}감시 디렉토리: ${LOCAL_MOUNT_POINT:-$PROJECT_ROOT/obsidian}${NC}"
    echo -e "${BLUE}Compose: $COMPOSE_FILE ($DOCKER_COMPOSE_CMD)${NC}"
    HPORT="${EVENT_BUS_HOST_PORT:-8000}"
    echo -e "${CYAN}이벤트 버스: 호스트 :${HPORT} → 컨테이너 :26010 (고정)${NC}"
    echo -e "${CYAN}호스트에서 run-services 시 .env에 EVENT_BUS_URL=http://127.0.0.1:${HPORT}${NC}"
    echo ""
    (cd "$PROJECT_ROOT" && $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up)

else
    echo -e "${GREEN}🐍 Python 직접 실행 모드${NC}"
    echo ""
    
    # Python 설치 확인
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}❌ Python3가 설치되어 있지 않습니다.${NC}"
        exit 1
    fi
    
    # 가상환경 확인 및 생성 (프로젝트 루트)
    VENV_DIR="$PROJECT_ROOT/venv"
    VENV_PIP="$VENV_DIR/bin/pip"
    VENV_PYTHON="$VENV_DIR/bin/python"
    
    # 가상환경이 없거나 손상된 경우 재생성
    NEED_RECREATE=false
    if [ ! -d "$VENV_DIR" ]; then
        NEED_RECREATE=true
        echo -e "${YELLOW}⚠️  가상환경이 없습니다. 생성합니다...${NC}"
    elif [ ! -f "$VENV_PIP" ] || [ ! -f "$VENV_PYTHON" ]; then
        NEED_RECREATE=true
        echo -e "${YELLOW}⚠️  가상환경이 손상되었습니다. 재생성합니다...${NC}"
    else
        # pip 파일의 shebang이 올바른 경로를 가리키는지 확인
        if [ -f "$VENV_PIP" ]; then
            PIP_SHEBANG=$(head -n 1 "$VENV_PIP" 2>/dev/null | grep -o "^#!.*" || echo "")
            if [ -n "$PIP_SHEBANG" ]; then
                EXPECTED_PYTHON="$VENV_DIR/bin/python3"
                if [[ "$PIP_SHEBANG" != *"$VENV_DIR"* ]] && [[ "$PIP_SHEBANG" != *"$PROJECT_ROOT"* ]]; then
                    NEED_RECREATE=true
                    echo -e "${YELLOW}⚠️  가상환경의 pip가 잘못된 경로를 가리킵니다. 재생성합니다...${NC}"
                fi
            fi
        fi
        
        # 가상환경의 python이 제대로 작동하는지 확인 (위 검사를 통과한 경우에만)
        if [ "$NEED_RECREATE" = false ] && ! "$VENV_PYTHON" -c "import sys; sys.exit(0)" 2>/dev/null; then
            NEED_RECREATE=true
            echo -e "${YELLOW}⚠️  가상환경이 손상되었습니다. 재생성합니다...${NC}"
        fi
    fi
    
    if [ "$NEED_RECREATE" = true ]; then
        rm -rf "$VENV_DIR"
        python3 -m venv "$VENV_DIR"
        echo -e "${GREEN}✅ 가상환경 생성 완료${NC}"
    fi
    
    # 가상환경 활성화
    source "$VENV_DIR/bin/activate"
    
    # requirements.txt 확인 (프로젝트 루트)
    if [ -f "$PROJECT_ROOT/requirements.txt" ]; then
        echo -e "${BLUE}📦 의존성 패키지 설치 중...${NC}"
        "$VENV_PIP" install -q --upgrade pip
        "$VENV_PIP" install -q -r "$PROJECT_ROOT/requirements.txt"
        echo -e "${GREEN}✅ 의존성 설치 완료${NC}"
    else
        echo -e "${YELLOW}⚠️  requirements.txt 파일을 찾을 수 없습니다.${NC}"
    fi
    
    if [ ! -f "main_core.py" ]; then
        echo -e "${RED}❌ main_core.py 파일을 찾을 수 없습니다.${NC}"
        exit 1
    fi

    echo -e "${BLUE}감시 디렉토리: ${LOCAL_MOUNT_POINT:-$PROJECT_ROOT/obsidian}${NC}"
    echo ""
    "$VENV_PYTHON" main_core.py
fi
