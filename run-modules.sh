#!/bin/bash
# SagoHub - 모듈 선택 실행
# modules/ 아래 모듈 목록에서 선택하여 해당 모듈의 run.sh 실행
# 코어(이벤트 버스)는 먼저 run-core.sh 로 실행해야 합니다.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
MODULES_DIR="$PROJECT_ROOT/modules"

# 모듈 디렉터리 목록 (run.sh가 있는 하위 폴더만, 그때그때 스캔하여 알파벳 순 표시)
get_module_dirs() {
    local list=()
    [[ -d "$MODULES_DIR" ]] || return 0
    for dir in "$MODULES_DIR"/*; do
        [[ -d "$dir" && -f "$dir/run.sh" ]] || continue
        list+=("$(basename "$dir")")
    done
    printf '%s\n' "${list[@]}" | sort
}

# 모듈 표시 이름
module_display_name() {
    case "$1" in
        file_watcher)   echo "File Watcher (파일 감시)" ;;
        file_writer)    echo "File Writer (파일 쓰기)" ;;
        llm_drafter)    echo "LLM Drafter (메일 초안)" ;;
        llm_prompt)     echo "LLM Prompt (LLM 질의)" ;;
        mailer)         echo "Mailer (메일 발송)" ;;
        nudge_ui)       echo "Nudge UI" ;;
        monitor_log)    echo "Monitor Log (로그 기록)" ;;
        monitor_console) echo "Monitor Console (콘솔 출력)" ;;
        *)              echo "$1" ;;
    esac
}

select_module() {
    local dirs=()
    while IFS= read -r line; do
        [[ -n "$line" ]] && dirs+=("$line")
    done < <(get_module_dirs)
    if [ ${#dirs[@]} -eq 0 ]; then
        echo -e "${RED}❌ 실행 가능한 모듈이 없습니다. (각 모듈 폴더에 run.sh 필요)${NC}" >&2
        exit 1
    fi

    echo -e "${BLUE}============================================================${NC}" >&2
    echo -e "${BLUE}SagoHub - 모듈 선택 실행${NC}" >&2
    echo -e "${BLUE}============================================================${NC}" >&2
    echo "" >&2
    echo -e "${YELLOW}💡 코어(이벤트 버스)가 먼저 실행 중이어야 합니다: ./run-core.sh${NC}" >&2
    echo -e "${CYAN}이벤트 버스: \${EVENT_BUS_URL:-http://localhost:8000}${NC}" >&2
    echo "" >&2
    echo -e "${CYAN}실행할 모듈을 선택하세요:${NC}" >&2
    echo "" >&2

    local i=1
    declare -A idx_to_dir
    for d in "${dirs[@]}"; do
        echo -e "${GREEN}[$i]${NC} $(module_display_name "$d")" >&2
        idx_to_dir[$i]="$d"
        ((i++)) || true
    done
    echo "" >&2
    echo -e "${GREEN}[0]${NC} ${CYAN}종료${NC}" >&2
    echo "" >&2
    read -p "$(echo -e ${BLUE}모듈 번호 [1-$((i-1))]: ${NC})" choice

    if [ "$choice" = "0" ]; then
        echo "종료합니다." >&2
        exit 0
    fi
    if [ -z "${idx_to_dir[$choice]:-}" ]; then
        echo -e "${RED}❌ 잘못된 선택입니다.${NC}" >&2
        exit 1
    fi
    echo "${idx_to_dir[$choice]}"
}

# 선택한 모듈 디렉터리명으로 전체 모듈 키 반환 (예: llm_prompt -> llm_prompt.LLMPromptModule)
get_module_key() {
    local dir_name="$1"
    export PYTHONPATH="${PROJECT_ROOT}/src:${PYTHONPATH:-}"
    python3 - "$PROJECT_ROOT" "$dir_name" << 'PY'
import sys
from pathlib import Path
project_root = sys.argv[1]
dir_name = sys.argv[2]
sys.path.insert(0, str(Path(project_root) / "src"))
from SagoHub.core.module_loader import get_module_map
m = get_module_map(Path(project_root))
for k in m:
    if k.split(".", 1)[0] == dir_name:
        print(k)
        break
PY
}

# 메인
main() {
    local selected
    selected=$(select_module)
    [ -z "$selected" ] && exit 0

    echo -e "${GREEN}✅ 모듈 실행: $(module_display_name "$selected")${NC}"
    echo ""

    local module_key
    module_key=$(get_module_key "$selected")
    if [ -z "$module_key" ]; then
        local run_sh="$MODULES_DIR/$selected/run.sh"
        if [ ! -f "$run_sh" ]; then
            echo -e "${RED}❌ run.sh 없음: $run_sh${NC}" >&2
            exit 1
        fi
        export PYTHONPATH="${PROJECT_ROOT}/src:${PYTHONPATH:-}"
        exec bash "$run_sh"
    fi

    [ -f "$PROJECT_ROOT/.env" ] && export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
    export EVENT_BUS_URL="${EVENT_BUS_URL:-http://localhost:8000}"
    export POLL_INTERVAL="${POLL_INTERVAL:-5}"
    export PYTHONPATH="${PROJECT_ROOT}/src:${PYTHONPATH:-}"
    cd "$PROJECT_ROOT"
    exec python3 src/SagoHub/runner/module_runner.py "$module_key"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
