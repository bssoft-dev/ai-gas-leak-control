#!/bin/bash
# SagoHub - Foldering Engine 실행 스크립트
# 프로젝트 루트에서 실행: ./run.sh
#
# 기능:
# - core, modules, services를 별도로 백그라운드 실행
# - 실행 상태를 logs/ 폴더에 저장
# - 상태 조회 및 중지 기능

set -e  # 에러 발생 시 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 프로젝트 루트 디렉토리
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
ENGINE_DIR="$PROJECT_ROOT/src/SagoHub/runner"
LOGS_DIR="$PROJECT_ROOT/logs"

# logs 디렉토리 생성
mkdir -p "$LOGS_DIR"

# .env 파일 확인
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

# 가상환경 설정
VENV_DIR="$PROJECT_ROOT/venv"
VENV_PYTHON="$VENV_DIR/bin/python"

# 상태 파일 경로
CORE_PID_FILE="$LOGS_DIR/core.pid"
CORE_STATUS_FILE="$LOGS_DIR/core.status"
CORE_LOG_FILE="$LOGS_DIR/core.log"

MODULES_PID_FILE="$LOGS_DIR/modules.pid"
MODULES_STATUS_FILE="$LOGS_DIR/modules.status"
MODULES_LOG_FILE="$LOGS_DIR/modules.log"

SERVICES_PID_FILE="$LOGS_DIR/services.pid"
SERVICES_STATUS_FILE="$LOGS_DIR/services.status"
SERVICES_LOG_FILE="$LOGS_DIR/services.log"

# 프로세스 상태 확인 함수
check_process() {
    local pid_file=$1
    local component=""
    
    # component 추출 (파일명에서)
    if [[ "$pid_file" == *"core"* ]]; then
        component="core"
    elif [[ "$pid_file" == *"modules"* ]]; then
        component="modules"
    elif [[ "$pid_file" == *"services"* ]]; then
        component="services"
    fi
    
    # Docker 모드에서 Core인 경우 docker-compose로 확인
    if [ "$component" = "core" ] && ([ "$USE_DOCKER" = "true" ] || [ "$USE_DOCKER" = "1" ] || [ "$USE_DOCKER" = "yes" ]); then
        cd "$ENGINE_DIR"
        if docker-compose ps 2>/dev/null | grep -q "Up"; then
            echo "running"
        else
            echo "stopped"
        fi
        return
    fi
    
    if [ ! -f "$pid_file" ]; then
        echo "stopped"
        return
    fi
    
    local pid=$(cat "$pid_file" 2>/dev/null)
    if [ -z "$pid" ]; then
        echo "stopped"
        return
    fi
    
    if ps -p "$pid" > /dev/null 2>&1; then
        echo "running"
    else
        echo "stopped"
    fi
}

# 상태 업데이트 함수
update_status() {
    local component=$1
    local status=$2
    local pid_file=""
    local status_file=""
    
    case $component in
        core)
            pid_file="$CORE_PID_FILE"
            status_file="$CORE_STATUS_FILE"
            ;;
        modules)
            pid_file="$MODULES_PID_FILE"
            status_file="$MODULES_STATUS_FILE"
            ;;
        services)
            pid_file="$SERVICES_PID_FILE"
            status_file="$SERVICES_STATUS_FILE"
            ;;
    esac
    
    local pid=""
    if [ -f "$pid_file" ]; then
        pid=$(cat "$pid_file" 2>/dev/null)
    fi
    
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "status=$status" > "$status_file"
    echo "pid=$pid" >> "$status_file"
    echo "timestamp=$timestamp" >> "$status_file"
}

# Core 시작 함수
start_core() {
    local current_status=$(check_process "$CORE_PID_FILE")
    if [ "$current_status" = "running" ]; then
        echo -e "${YELLOW}⚠️  Core가 이미 실행 중입니다.${NC}"
        return 1
    fi
    
    echo -e "${CYAN}🚀 Core 시작 중...${NC}"
    update_status "core" "starting"
    
    cd "$ENGINE_DIR"
    
    if [ "$USE_DOCKER" = "true" ] || [ "$USE_DOCKER" = "1" ] || [ "$USE_DOCKER" = "yes" ]; then
        # Docker 모드
        cd "$ENGINE_DIR"
        docker-compose up -d > "$CORE_LOG_FILE" 2>&1
        # Docker 모드에서는 PID 대신 docker-compose 상태로 관리
        echo "docker" > "$CORE_PID_FILE"
        local pid="docker"
    else
        # Python 직접 실행 모드
        if [ ! -f "$VENV_PYTHON" ]; then
            echo -e "${RED}❌ 가상환경이 없습니다. 먼저 가상환경을 설정하세요.${NC}"
            update_status "core" "error"
            return 1
        fi
        
        nohup "$VENV_PYTHON" main_core.py > "$CORE_LOG_FILE" 2>&1 &
        local pid=$!
    fi
    
    echo $pid > "$CORE_PID_FILE"
    update_status "core" "running"
    echo -e "${GREEN}✅ Core가 백그라운드에서 시작되었습니다. (PID: $pid)${NC}"
    echo -e "${BLUE}   로그: $CORE_LOG_FILE${NC}"
}

# Modules 시작 함수
start_modules() {
    local current_status=$(check_process "$MODULES_PID_FILE")
    if [ "$current_status" = "running" ]; then
        echo -e "${YELLOW}⚠️  Modules가 이미 실행 중입니다.${NC}"
        return 1
    fi
    
    echo -e "${CYAN}🚀 Modules 시작 중...${NC}"
    update_status "modules" "starting"
    
    cd "$ENGINE_DIR"
    
    if [ ! -f "$VENV_PYTHON" ]; then
        echo -e "${RED}❌ 가상환경이 없습니다. 먼저 가상환경을 설정하세요.${NC}"
        update_status "modules" "error"
        return 1
    fi
    
    nohup "$VENV_PYTHON" main_modules.py > "$MODULES_LOG_FILE" 2>&1 &
    local pid=$!
    
    echo $pid > "$MODULES_PID_FILE"
    update_status "modules" "running"
    echo -e "${GREEN}✅ Modules가 백그라운드에서 시작되었습니다. (PID: $pid)${NC}"
    echo -e "${BLUE}   로그: $MODULES_LOG_FILE${NC}"
}

# Services 시작 함수
start_services() {
    local current_status=$(check_process "$SERVICES_PID_FILE")
    if [ "$current_status" = "running" ]; then
        echo -e "${YELLOW}⚠️  Services가 이미 실행 중입니다.${NC}"
        return 1
    fi
    
    echo -e "${CYAN}🚀 Services 시작 중...${NC}"
    update_status "services" "starting"
    
    cd "$ENGINE_DIR"
    
    if [ ! -f "$VENV_PYTHON" ]; then
        echo -e "${RED}❌ 가상환경이 없습니다. 먼저 가상환경을 설정하세요.${NC}"
        update_status "services" "error"
        return 1
    fi
    
    # start_pipelines.py를 사용하여 모든 서비스 시작
    if [ -f "$ENGINE_DIR/start_pipelines.py" ]; then
        # 환경 변수 설정
        local event_bus_host="${EVENT_BUS_HOST:-localhost}"
        local event_bus_port="${EVENT_BUS_PORT:-8000}"
        local event_bus_url="${EVENT_BUS_URL:-http://${event_bus_host}:${event_bus_port}}"
        
        # Python 직접 실행 모드에서는 localhost 사용
        if [ "$USE_DOCKER" != "true" ] && [ "$USE_DOCKER" != "1" ] && [ "$USE_DOCKER" != "yes" ]; then
            event_bus_url="http://${event_bus_host}:${event_bus_port}"
        fi
        
        nohup env EVENT_BUS_URL="$event_bus_url" EVENT_BUS_HOST="$event_bus_host" EVENT_BUS_PORT="$event_bus_port" \
            "$VENV_PYTHON" start_pipelines.py > "$SERVICES_LOG_FILE" 2>&1 &
        local pid=$!
    else
        echo -e "${YELLOW}⚠️  start_pipelines.py를 찾을 수 없습니다. run-services.sh를 사용합니다.${NC}"
        cd "$PROJECT_ROOT"
        # run-services.sh는 인터랙티브이므로, 모든 서비스를 선택하는 방식으로 실행
        # 하지만 백그라운드에서는 자동 선택이 어려우므로 경고만 표시
        echo -e "${YELLOW}⚠️  Services는 인터랙티브 모드로 실행해야 합니다.${NC}"
        echo -e "${YELLOW}   수동으로 실행: ./run-services.sh${NC}"
        update_status "services" "error"
        return 1
    fi
    
    echo $pid > "$SERVICES_PID_FILE"
    update_status "services" "running"
    echo -e "${GREEN}✅ Services가 백그라운드에서 시작되었습니다. (PID: $pid)${NC}"
    echo -e "${BLUE}   로그: $SERVICES_LOG_FILE${NC}"
}

# 중지 함수
stop_component() {
    local component=$1
    local pid_file=""
    local status_file=""
    local log_file=""
    
    case $component in
        core)
            pid_file="$CORE_PID_FILE"
            status_file="$CORE_STATUS_FILE"
            log_file="$CORE_LOG_FILE"
            ;;
        modules)
            pid_file="$MODULES_PID_FILE"
            status_file="$MODULES_STATUS_FILE"
            log_file="$MODULES_LOG_FILE"
            ;;
        services)
            pid_file="$SERVICES_PID_FILE"
            status_file="$SERVICES_STATUS_FILE"
            log_file="$SERVICES_LOG_FILE"
            ;;
    esac
    
    local current_status=$(check_process "$pid_file")
    if [ "$current_status" != "running" ]; then
        echo -e "${YELLOW}⚠️  $component가 실행 중이 아닙니다.${NC}"
        return 1
    fi
    
    # Docker 모드인 경우
    if [ "$component" = "core" ] && ([ "$USE_DOCKER" = "true" ] || [ "$USE_DOCKER" = "1" ] || [ "$USE_DOCKER" = "yes" ]); then
        echo -e "${CYAN}🛑 $component 중지 중... (Docker 모드)${NC}"
        cd "$ENGINE_DIR"
        docker-compose down > /dev/null 2>&1 || true
        rm -f "$pid_file"
        update_status "$component" "stopped"
        echo -e "${GREEN}✅ $component가 중지되었습니다.${NC}"
        return 0
    fi
    
    local pid=$(cat "$pid_file" 2>/dev/null)
    if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
        echo -e "${CYAN}🛑 $component 중지 중... (PID: $pid)${NC}"
        kill "$pid" 2>/dev/null || true
        sleep 2
        
        # 강제 종료가 필요한 경우
        if ps -p "$pid" > /dev/null 2>&1; then
            kill -9 "$pid" 2>/dev/null || true
        fi
        
        rm -f "$pid_file"
        update_status "$component" "stopped"
        echo -e "${GREEN}✅ $component가 중지되었습니다.${NC}"
    else
        rm -f "$pid_file"
        update_status "$component" "stopped"
        echo -e "${YELLOW}⚠️  PID 파일이 있지만 프로세스가 없습니다. 정리했습니다.${NC}"
    fi
}

# 상태 조회 함수
show_status() {
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}SagoHub 실행 상태${NC}"
    echo -e "${BLUE}============================================================${NC}"
    echo ""
    
    # EVENT_BUS_URL 설정
    local event_bus_host="${EVENT_BUS_HOST:-localhost}"
    local event_bus_port="${EVENT_BUS_PORT:-8000}"
    local event_bus_url="${EVENT_BUS_URL:-http://${event_bus_host}:${event_bus_port}}"
    
    # Python 직접 실행 모드에서는 localhost 사용
    if [ "$USE_DOCKER" != "true" ] && [ "$USE_DOCKER" != "1" ] && [ "$USE_DOCKER" != "yes" ]; then
        event_bus_url="http://${event_bus_host}:${event_bus_port}"
    fi
    
    # Core 상태
    local core_status=$(check_process "$CORE_PID_FILE")
    local core_pid=""
    local core_timestamp=""
    if [ -f "$CORE_STATUS_FILE" ]; then
        core_pid=$(grep "^pid=" "$CORE_STATUS_FILE" | cut -d'=' -f2)
        core_timestamp=$(grep "^timestamp=" "$CORE_STATUS_FILE" | cut -d'=' -f2)
    fi
    
    if [ "$core_status" = "running" ]; then
        echo -e "${GREEN}● Core:${NC} 실행 중 (PID: $core_pid)"
        echo -e "  URL: $event_bus_url"
    else
        echo -e "${RED}○ Core:${NC} 중지됨"
    fi
    if [ -n "$core_timestamp" ]; then
        echo -e "  마지막 업데이트: $core_timestamp"
    fi
    echo ""
    
    # Modules 상태
    local modules_status=$(check_process "$MODULES_PID_FILE")
    local modules_pid=""
    local modules_timestamp=""
    if [ -f "$MODULES_STATUS_FILE" ]; then
        modules_pid=$(grep "^pid=" "$MODULES_STATUS_FILE" | cut -d'=' -f2)
        modules_timestamp=$(grep "^timestamp=" "$MODULES_STATUS_FILE" | cut -d'=' -f2)
    fi
    
    if [ "$modules_status" = "running" ]; then
        echo -e "${GREEN}● Modules:${NC} 실행 중 (PID: $modules_pid)"
    else
        echo -e "${RED}○ Modules:${NC} 중지됨"
    fi
    if [ -n "$modules_timestamp" ]; then
        echo -e "  마지막 업데이트: $modules_timestamp"
    fi
    
    # Core가 실행 중이면 등록된 모듈 목록 조회
    if [ "$core_status" = "running" ]; then
        local modules_json=""
        if command -v curl > /dev/null 2>&1; then
            modules_json=$(curl -s --connect-timeout 2 "${event_bus_url}/modules" 2>/dev/null)
        elif command -v python3 > /dev/null 2>&1; then
            modules_json=$(python3 -c "
import urllib.request
import json
try:
    with urllib.request.urlopen('${event_bus_url}/modules', timeout=2) as response:
        data = json.loads(response.read().decode())
        print(json.dumps(data))
except:
    pass
" 2>/dev/null)
        fi
        
        if [ -n "$modules_json" ] && [ "$modules_json" != "[]" ] && [ "$modules_json" != "null" ]; then
            echo -e "${CYAN}  등록된 모듈:${NC}"
            echo "$modules_json" | python3 -c "
import sys, json
try:
    modules = json.load(sys.stdin)
    if isinstance(modules, list) and len(modules) > 0:
        for m in modules:
            module_id = m.get('module_id', 'N/A')
            name = m.get('name', module_id)
            status = m.get('health_status', 'unknown')
            if status == 'healthy':
                print(f'    ✓ {name} ({module_id})')
            else:
                print(f'    ⚠ {name} ({module_id}) - {status}')
    else:
        print('    (등록된 모듈 없음)')
except Exception as e:
    print('    (모듈 목록 조회 실패)')
" 2>/dev/null || echo "    (모듈 목록 조회 실패)"
        else
            echo -e "${YELLOW}  (등록된 모듈 없음 또는 조회 불가)${NC}"
        fi
    fi
    echo ""
    
    # Services 상태
    local services_status=$(check_process "$SERVICES_PID_FILE")
    local services_pid=""
    local services_timestamp=""
    if [ -f "$SERVICES_STATUS_FILE" ]; then
        services_pid=$(grep "^pid=" "$SERVICES_STATUS_FILE" | cut -d'=' -f2)
        services_timestamp=$(grep "^timestamp=" "$SERVICES_STATUS_FILE" | cut -d'=' -f2)
    fi
    
    if [ "$services_status" = "running" ]; then
        echo -e "${GREEN}● Services:${NC} 실행 중 (PID: $services_pid)"
    else
        echo -e "${RED}○ Services:${NC} 중지됨"
    fi
    if [ -n "$services_timestamp" ]; then
        echo -e "  마지막 업데이트: $services_timestamp"
    fi
    
    # Core가 실행 중이면 등록된 서비스 목록 조회
    if [ "$core_status" = "running" ]; then
        local services_json=""
        if command -v curl > /dev/null 2>&1; then
            services_json=$(curl -s --connect-timeout 2 "${event_bus_url}/services" 2>/dev/null)
        elif command -v python3 > /dev/null 2>&1; then
            services_json=$(python3 -c "
import urllib.request
import json
try:
    with urllib.request.urlopen('${event_bus_url}/services', timeout=2) as response:
        data = json.loads(response.read().decode())
        print(json.dumps(data))
except:
    pass
" 2>/dev/null)
        fi
        
        if [ -n "$services_json" ] && [ "$services_json" != "[]" ] && [ "$services_json" != "null" ]; then
            echo -e "${CYAN}  등록된 서비스:${NC}"
            echo "$services_json" | python3 -c "
import sys, json
try:
    services = json.load(sys.stdin)
    if isinstance(services, list) and len(services) > 0:
        for s in services:
            if isinstance(s, dict):
                # ServiceInfo 구조: metadata 안에 id, name, version이 있음
                metadata = s.get('metadata', {})
                if metadata:
                    service_id = metadata.get('id', 'N/A')
                    name = metadata.get('name', service_id)
                    version = metadata.get('version', 'N/A')
                else:
                    # 딕셔너리 형태로 직접 저장된 경우
                    service_id = s.get('service_id', s.get('id', 'N/A'))
                    name = s.get('name', service_id)
                    version = s.get('version', 'N/A')
                
                # 파이프라인 개수
                pipelines = s.get('pipelines', [])
                pipeline_count = len(pipelines) if isinstance(pipelines, list) else 0
                
                print(f'    ✓ {name} ({service_id}) v{version} [{pipeline_count} pipelines]')
    else:
        print('    (등록된 서비스 없음)')
except Exception as e:
    print(f'    (서비스 목록 조회 실패: {str(e)})')
" 2>/dev/null || echo "    (서비스 목록 조회 실패)"
        else
            echo -e "${YELLOW}  (등록된 서비스 없음 또는 조회 불가)${NC}"
        fi
    fi
    echo ""
    
    echo -e "${BLUE}로그 파일 위치:${NC}"
    echo -e "  Core:    $CORE_LOG_FILE"
    echo -e "  Modules: $MODULES_LOG_FILE"
    echo -e "  Services: $SERVICES_LOG_FILE"
    echo ""
}

# 가상환경 설정 함수
setup_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        echo -e "${YELLOW}⚠️  가상환경이 없습니다. 생성합니다...${NC}"
        python3 -m venv "$VENV_DIR"
        echo -e "${GREEN}✅ 가상환경 생성 완료${NC}"
    fi
    
    local VENV_PIP="$VENV_DIR/bin/pip"
    if [ -f "$PROJECT_ROOT/requirements.txt" ]; then
        echo -e "${BLUE}📦 의존성 패키지 설치 중...${NC}"
        "$VENV_PIP" install -q --upgrade pip
        "$VENV_PIP" install -q -r "$PROJECT_ROOT/requirements.txt"
        echo -e "${GREEN}✅ 의존성 설치 완료${NC}"
    fi
}

# 메인 메뉴
show_menu() {
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}SagoHub - Foldering Engine${NC}"
    echo -e "${BLUE}============================================================${NC}"
    echo ""
    echo -e "${CYAN}[1]${NC} Core 시작"
    echo -e "${CYAN}[2]${NC} Modules 시작"
    echo -e "${CYAN}[3]${NC} Services 시작"
    echo -e "${CYAN}[4]${NC} Core 중지"
    echo -e "${CYAN}[5]${NC} Modules 중지"
    echo -e "${CYAN}[6]${NC} Services 중지"
    echo -e "${CYAN}[7]${NC} 상태 조회"
    echo -e "${CYAN}[8]${NC} 가상환경 설정"
    echo -e "${CYAN}[0]${NC} 종료"
    echo ""
}

# 메인 루프
main() {
    # 명령줄 인자 처리
    case "${1:-}" in
        start-core)
            setup_venv
            start_core
            exit 0
            ;;
        start-modules)
            setup_venv
            start_modules
            exit 0
            ;;
        start-services)
            setup_venv
            start_services
            exit 0
            ;;
        stop-core)
            stop_component "core"
            exit 0
            ;;
        stop-modules)
            stop_component "modules"
            exit 0
            ;;
        stop-services)
            stop_component "services"
            exit 0
            ;;
        status)
            show_status
            exit 0
            ;;
        setup)
            setup_venv
            exit 0
            ;;
    esac
    
    # 인터랙티브 모드
    while true; do
        show_menu
        read -p "$(echo -e ${BLUE}선택 [0-8]: ${NC})" choice
        echo ""
        
        case $choice in
            1)
                setup_venv
                start_core
                ;;
            2)
                setup_venv
                start_modules
                ;;
            3)
                setup_venv
                start_services
                ;;
            4)
                stop_component "core"
                ;;
            5)
                stop_component "modules"
                ;;
            6)
                stop_component "services"
                ;;
            7)
                show_status
                ;;
            8)
                setup_venv
                ;;
            0)
                echo -e "${GREEN}종료합니다.${NC}"
                echo -e "${YELLOW}💡 백그라운드로 실행 중인 프로세스는 계속 실행됩니다.${NC}"
                echo -e "${YELLOW}   중지하려면 ./run.sh stop-core, ./run.sh stop-modules, ./run.sh stop-services를 사용하세요.${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}❌ 잘못된 선택입니다.${NC}"
                ;;
        esac
        
        echo ""
        read -p "$(echo -e ${CYAN}계속하려면 Enter를 누르세요...${NC})" dummy
        echo ""
    done
}

# 스크립트 실행
main "$@"
