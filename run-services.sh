#!/bin/bash
# SagoHub - 서비스 전용 실행 (코어에 서비스 등록 및 이벤트 구독)
# 코어(이벤트 버스+모듈)는 먼저 run-core.sh 로 실행해야 합니다.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
SERVICES_DIR="${SERVICES_DIR:-$PROJECT_ROOT/services}"
PIPELINES_DIR="$SERVICES_DIR"  # 하위 호환성
ENGINE_DIR="$PROJECT_ROOT/src/SagoHub/runner"

# .env 파일 확인
ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}⚠️  .env 파일이 없습니다. env.example을 복사하여 생성합니다...${NC}"
    if [ -f "$PROJECT_ROOT/env.example" ]; then
        cp "$PROJECT_ROOT/env.example" "$ENV_FILE"
        echo -e "${GREEN}✅ .env 파일 생성 완료${NC}"
    else
        echo -e "${RED}❌ env.example 파일을 찾을 수 없습니다.${NC}"
        exit 1
    fi
fi

# .env 파일 로드
export $(grep -v '^#' "$ENV_FILE" | xargs)
EVENT_BUS_HOST="${EVENT_BUS_HOST:-0.0.0.0}"
EVENT_BUS_PORT="${EVENT_BUS_PORT:-8000}"
# 클라이언트 연결: 0.0.0.0 은 listen 전용. .env 에 EVENT_BUS_URL 이 있으면 유지.
if [ -z "${EVENT_BUS_URL:-}" ]; then
    CLIENT_HOST="$EVENT_BUS_HOST"
    if [ "$CLIENT_HOST" = "0.0.0.0" ]; then
        CLIENT_HOST="127.0.0.1"
    fi
    EVENT_BUS_URL="http://${CLIENT_HOST}:${EVENT_BUS_PORT}"
fi
EVENT_BUS_URL="${EVENT_BUS_URL%/}"
export EVENT_BUS_URL
export SERVICES_DIR
export PIPELINES_DIR

# 모듈 자동실행 여부: .env의 RUN_SERVICES_MODE
# all = 모듈 백그라운드 실행 후 서비스 선택/실행, services_only = 서비스(파이프라인)만 실행
RUN_SERVICES_MODE="${RUN_SERVICES_MODE:-services_only}"
RUN_SERVICES_MODE=$(echo "$RUN_SERVICES_MODE" | tr '[:upper:]' '[:lower:]')

# 서비스 목록 가져오기 (service.yaml 의 service.id 반환)
get_services() {
    local list=()
    if [ -d "$SERVICES_DIR" ]; then
        for dir in "$SERVICES_DIR"/*; do
            [ ! -d "$dir" ] && continue
            local yaml="$dir/service.yaml"
            [ ! -f "$yaml" ] && continue
            local id=$(awk '
                /^service:/ { in_service=1; next }
                /^[^ ]/ && in_service { exit }
                in_service && /^[ ]+id:/ {
                    gsub(/^[ ]+id:[ ]*["'\'']?|["'\'']?$/, "")
                    print
                    exit
                }
            ' "$yaml")
            [ -n "$id" ] && list+=("$id")
        done
    fi
    echo "${list[@]}"
}

# 서비스 정보 가져오기 (service_id로 service.yaml 찾기)
get_service_info() {
    local sid="$1"
    local yaml_file=""
    for dir in "$SERVICES_DIR"/*; do
        [ ! -d "$dir" ] && continue
        local y="$dir/service.yaml"
        [ ! -f "$y" ] && continue
        local id=$(awk '/^service:/{s=1;next} /^[^ ]/ && s{exit} s && /^[ ]+id:/{gsub(/^[ ]+id:[ ]*["'\'']?|["'\'']?$/,"");print;exit}' "$y")
        if [ "$id" = "$sid" ]; then
            yaml_file="$y"
            break
        fi
    done
    [ -z "$yaml_file" ] && echo "$sid|" && return
    
    # YAML 파싱: awk를 사용하여 더 안정적으로 파싱
    local name=$(awk '
        /^service:/ { in_service=1; next }
        /^[^ ]/ && in_service { exit }
        in_service && /^[ ]+name:/ {
            gsub(/^[ ]+name:[ ]*/, "")
            gsub(/^["'\'']|["'\'']$/, "")
            print
            exit
        }
    ' "$yaml_file")
    
    local desc=$(awk '
        /^service:/ { in_service=1; next }
        /^[^ ]/ && in_service { exit }
        in_service && /^[ ]+description:/ {
            gsub(/^[ ]+description:[ ]*/, "")
            gsub(/^["'\'']|["'\'']$/, "")
            print
            exit
        }
    ' "$yaml_file")
    
    if [ -z "$name" ]; then
        name="$sid"
    fi
    echo "$name|$desc"
}

# 서비스 선택 메뉴
select_service() {
    local services=($(get_services))
    
    if [ ${#services[@]} -eq 0 ]; then
        echo -e "${RED}❌ 사용 가능한 서비스가 없습니다.${NC}" >&2
        echo "   $SERVICES_DIR 디렉토리에 service.yaml 이 있는 서비스를 추가하세요." >&2
        exit 1
    fi
    
    echo -e "${BLUE}============================================================${NC}" >&2
    echo -e "${BLUE}SagoHub - 서비스 선택 (코어에 등록/구독)${NC}" >&2
    echo -e "${BLUE}============================================================${NC}" >&2
    echo "" >&2
    echo -e "${YELLOW}💡 코어(이벤트 버스)가 먼저 실행 중이어야 합니다: ./run-core.sh${NC}" >&2
    echo -e "${CYAN}이벤트 버스: $EVENT_BUS_URL${NC}" >&2
    echo -e "${CYAN}모드: .env RUN_SERVICES_MODE=${RUN_SERVICES_MODE} (all=모듈 자동실행+서비스, services_only=서비스만)${NC}" >&2
    echo "" >&2
    echo -e "${CYAN}사용 가능한 서비스:${NC}" >&2
    echo "" >&2
    
    local index=1
    declare -A service_map
    
    for sid in "${services[@]}"; do
        local info=$(get_service_info "$sid")
        local name=$(echo "$info" | cut -d'|' -f1)
        local desc=$(echo "$info" | cut -d'|' -f2)
        
        if [ -z "$name" ]; then
            name="$sid"
        fi
        echo -e "${GREEN}[$index]${NC} ${CYAN}$name${NC}" >&2
        if [ -n "$desc" ] && [ "$desc" != "$name" ]; then
            echo -e "     ${YELLOW}$desc${NC}" >&2
        fi
        echo "" >&2
        service_map[$index]="$sid"
        ((index++))
    done
    
    echo -e "${GREEN}[$index]${NC} ${CYAN}모든 서비스 실행${NC}" >&2
    echo "" >&2
    echo -e "${GREEN}[0]${NC} ${CYAN}종료${NC}" >&2
    echo "" >&2
    read -p "$(echo -e ${BLUE}서비스를 선택하세요 [1-$index]: ${NC})" choice
    
    if [ "$choice" = "0" ]; then
        echo "종료합니다." >&2
        exit 0
    fi
    
    # 선택 결과만 stdout으로 출력
    if [ "$choice" = "$index" ]; then
        echo "all"
    elif [ -n "$choice" ] && [ -n "${service_map[$choice]:-}" ]; then
        echo "${service_map[$choice]}"
    else
        echo -e "${RED}❌ 잘못된 선택입니다. (선택: '$choice')${NC}" >&2
        exit 1
    fi
}

# service.yaml에서 ui_server.mode 반환 (publish | dev, 기본 publish)
get_service_ui_mode() {
    local yaml_file="$1"
    [ ! -f "$yaml_file" ] && echo "publish" && return
    local mode=$(awk '
        /^service:/ { in_svc=1; in_ui=0; next }
        in_svc && /^  ui_server:/ { in_ui=1; next }
        in_svc && in_ui && /^    mode:/ {
            sub(/^[^:]*:[[:space:]]*/, "");
            gsub(/^["'\''"]|["'\''"]$/, "");
            if ($0 == "dev") print "dev"; else print "publish";
            exit
        }
        /^[^ ]/ { in_svc=0 }
    ' "$yaml_file")
    echo "${mode:-publish}"
}

# frontend 빌드 (mode=publish인 서비스만 npm run build, mode=dev는 빌드 생략)
build_frontends() {
    local selected="$1"
    local to_build=()
    
    if [ "$selected" = "all" ]; then
        for dir in "$SERVICES_DIR"/*; do
            [ ! -d "$dir" ] && continue
            [ ! -f "$dir/frontend/package.json" ] && continue
            [ "$(get_service_ui_mode "$dir/service.yaml")" = "dev" ] && continue
            to_build+=("$dir")
        done
    else
        local svc_dir=""
        for dir in "$SERVICES_DIR"/*; do
            [ ! -d "$dir" ] && continue
            local y="$dir/service.yaml"
            [ ! -f "$y" ] && continue
            local id=$(awk '/^service:/{s=1;next} /^[^ ]/ && s{exit} s && /^[ ]+id:/{gsub(/^[ ]+id:[ ]*["'\'']?|["'\'']?$/,"");print;exit}' "$y")
            if [ "$id" = "$selected" ]; then
                svc_dir="$dir"
                break
            fi
        done
        if [ -n "$svc_dir" ] && [ -f "$svc_dir/frontend/package.json" ]; then
            [ "$(get_service_ui_mode "$svc_dir/service.yaml")" != "dev" ] && to_build+=("$svc_dir")
        fi
    fi
    
    for dir in "${to_build[@]}"; do
        local name=$(basename "$dir")
        echo -e "${BLUE}📦 frontend 빌드 (publish): $name${NC}"
        (cd "$dir/frontend" && npm install && npm run build) || {
            echo -e "${RED}❌ frontend 빌드 실패: $name${NC}"
            exit 1
        }
        echo -e "${GREEN}✅ frontend 빌드 완료: $name${NC}"
        echo ""
    done
    # mode=dev 서비스는 빌드 생략 (실행 시 npm run dev로 HMR)
    if [ "$selected" != "all" ]; then
        for dir in "$SERVICES_DIR"/*; do
            [ ! -d "$dir" ] && continue
            [ ! -f "$dir/frontend/package.json" ] && continue
            local y="$dir/service.yaml"
            [ ! -f "$y" ] && continue
            local id=$(awk '/^service:/{s=1;next} /^[^ ]/ && s{exit} s && /^[ ]+id:/{gsub(/^[ ]+id:[ ]*["'\'']?|["'\'']?$/,"");print;exit}' "$y")
            [ "$id" != "$selected" ] && continue
            [ "$(get_service_ui_mode "$y")" = "dev" ] && echo -e "${CYAN}📦 frontend 모드: dev (빌드 생략, HMR 사용)${NC}" && echo ""
            break
        done
    fi
}

# 서비스 실행 (코어는 이미 실행 중이어야 함)
run_service() {
    local selected="$1"
    
    if [ "$selected" = "all" ]; then
        echo -e "${GREEN}✅ 모든 서비스 실행${NC}"
    else
        local info=$(get_service_info "$selected")
        local name=$(echo "$info" | cut -d'|' -f1)
        [ -z "$name" ] && name="$selected"
        echo -e "${GREEN}✅ 선택된 서비스: $name${NC}"
    fi
    echo ""
    
    # frontend: 각 서비스 service.yaml의 ui_server.mode에 따라 publish면 빌드, dev면 생략
    build_frontends "$selected"
    
    # 코어(이벤트 버스) 연결 확인
    if command -v curl &> /dev/null; then
        if ! curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "$EVENT_BUS_URL/health" | grep -q 200; then
            echo -e "${YELLOW}⚠️  이벤트 버스에 연결할 수 없습니다: $EVENT_BUS_URL${NC}"
            echo -e "${YELLOW}   먼저 코어를 실행하세요: ./run-core.sh${NC}"
            read -p "$(echo -e ${BLUE}계속하시겠습니까? [y/N]: ${NC})" -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    fi
    
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}SagoHub - 서비스 실행 (코어에 등록)${NC}"
    echo -e "${BLUE}============================================================${NC}"
    echo ""
    
    USE_DOCKER="${USE_DOCKER:-false}"
    USE_DOCKER=$(echo "$USE_DOCKER" | tr '[:upper:]' '[:lower:]')
    
    if [ "$USE_DOCKER" = "true" ] || [ "$USE_DOCKER" = "1" ] || [ "$USE_DOCKER" = "yes" ]; then
        echo -e "${GREEN}🐳 Docker 모드${NC}"
        cd "$ENGINE_DIR"
        export SELECTED_SERVICE
        [ "$selected" != "all" ] && export SELECTED_SERVICE="$selected"
        docker-compose up
        return
    fi
    
    # Python 직접 실행
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}❌ Python3가 필요합니다.${NC}"
        exit 1
    fi
    
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
    
    source "$VENV_DIR/bin/activate"
    
    [ -f "$PROJECT_ROOT/requirements.txt" ] && "$VENV_PIP" install -q -r "$PROJECT_ROOT/requirements.txt"
    
    cd "$ENGINE_DIR"
    export EVENT_BUS_URL SERVICES_DIR PIPELINES_DIR
    if [ "$selected" = "all" ]; then
        unset SELECTED_SERVICE SELECTED_PIPELINE
        "$VENV_PYTHON" start_pipelines.py
    else
        export SELECTED_SERVICE="$selected"
        export SELECTED_PIPELINE="$selected"
        # 단일 서비스: foreground 실행 (로그 확인용)
        "$VENV_PYTHON" service_runner.py "$selected"
    fi
}

# 모듈 백그라운드 실행 (RUN_SERVICES_MODE=all 일 때 사용)
start_modules_background() {
    local VENV_PYTHON="$PROJECT_ROOT/venv/bin/python"
    local MODULES_LOG="$PROJECT_ROOT/logs/run-services-modules.log"
    mkdir -p "$PROJECT_ROOT/logs"
    if [ ! -f "$VENV_PYTHON" ] || [ ! -f "$ENGINE_DIR/main_modules.py" ]; then
        echo -e "${YELLOW}⚠️  모듈 자동실행을 건너뜁니다 (venv 또는 main_modules.py 없음).${NC}" >&2
        return 0
    fi
    echo -e "${CYAN}🚀 모듈을 백그라운드에서 시작합니다... (로그: $MODULES_LOG)${NC}" >&2
    (
        export PYTHONPATH="${PROJECT_ROOT}/src:${PYTHONPATH:-}"
        export EVENT_BUS_URL
        cd "$ENGINE_DIR"
        nohup "$VENV_PYTHON" main_modules.py >> "$MODULES_LOG" 2>&1 &
    )
    sleep 2
    echo -e "${GREEN}✅ 모듈 백그라운드 시작 완료${NC}" >&2
    echo "" >&2
}

# 메인 로직
main() {
    # .env 설정에 따라 모듈 자동실행
    if [ "$RUN_SERVICES_MODE" = "all" ]; then
        start_modules_background
    fi

    # 파이프라인 선택 (표시 및 입력)
    # select_service는 파이프라인 목록을 stderr로 표시하고 선택값을 stdout으로 반환
    local selected
    selected=$(select_service)
    
    # 선택 결과 확인
    if [ -z "$selected" ]; then
        exit 0
    fi
    
    # 파이프라인 실행
    run_service "$selected"
}

# 스크립트 직접 실행 시
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
