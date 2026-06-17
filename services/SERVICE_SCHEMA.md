# SagoHub 파이프라인 스키마 문서 (v2.0)

## 개요

SagoHub 파이프라인은 **브로드캐스트 기반 이벤트 처리 시스템**입니다. 이벤트가 발생하면 해당 이벤트 타입을 구독하는 모든 모듈에 동시에 전달되며, 각 모듈은 독립적으로 처리합니다.

**새로운 v2.0 스키마**는 **[트리거] -> [브로드캐스트(분산)] -> [집계(충돌 해결)]** 3단계 구조를 명확히 따릅니다.

## 파이프라인 구조

### 기본 구조

```yaml
service:
  id: "com.SagoHub.example"
  version: "2.0.0"
  name: "Example Service"
  description: "서비스 설명"
  author: "작성자"
  icon: "icon.png"
  category: "productivity"

config:
  # 사용자 설정 스키마

pipelines:
  - id: "flow_example"  # 파이프라인 고유 ID
    name: "파이프라인 이름"
    
    # 1. 트리거 (Input) - 이벤트 처리 전략 포함
    trigger:
      event: "이벤트 타입"
      filter: "조건식 또는 파일 패턴"
      debounce: 1000  # 밀리초
      aggregation:  # 여러 모듈이 각각 응답 이벤트를 발행할 때, 그 이벤트들 간의 충돌을 해결하는 전략
        strategy: "INDEPENDENT"  # INDEPENDENT, PRIORITY, LATEST, MERGE
        target: null  # null, "event_bus", 또는 module_id
        options:
          timeout_ms: 500  # 전략별 옵션
    
    # 2. 브로드캐스팅 (Fan-out): 이벤트를 받을 모듈들
    broadcast:
      - module: "monitor.console_output"
        id: "action_console"  # 실행 ID (선택사항)
        priority: 10  # 우선순위 (PRIORITY 전략용)
        condition: "${config.enabled} == true"  # 실행 조건식 (선택사항)
        args:
          message: "${event.filename}"
          path: "${event.path}"
```

## 필드 설명

### service (필수)

서비스 메타데이터를 정의합니다.

- `id`: 고유 식별자 (예: "com.SagoHub.file-monitor")
- `version`: 버전 번호 (예: "2.0.0")
- `name`: 서비스 이름
- `description`: 서비스 설명 (선택사항)
- `author`: 작성자 (선택사항)
- `icon`: 아이콘 파일 경로 (선택사항)
- `category`: 카테고리 (선택사항, 기본값: "productivity")

### config (선택사항)

사용자가 설정할 수 있는 값들을 정의합니다.

```yaml
config:
  target_folder:
    type: "path"  # string, path, boolean, select, number
    label: "감시할 폴더"
    default: "./obsidian"
    required: true
    description: "설명"
    options: []  # select 타입일 때만 사용
```

### pipelines (필수)

파이프라인 목록을 정의합니다.

#### id (선택사항)

파이프라인 고유 ID입니다. 지정하지 않으면 자동 생성됩니다.

#### name (필수)

파이프라인 이름입니다.

#### trigger (필수, v2.0)

트리거 이벤트를 정의합니다. (하위 호환성: `on` 키워드도 지원)

- `event`: 이벤트 타입 (예: "FILE_CREATED", "FILE_MODIFIED")
- `filter`: 조건식 또는 파일 패턴 (Glob 형식, 예: "**/*.md" 또는 "${config.target_folder}/${config.watch_pattern}")
- `exclude`: 제외 패턴 (선택사항)
- `debounce`: 디바운스 시간 (밀리초, 선택사항, 기본값: 0)

**예시:**
```yaml
trigger:
  event: "FILE_CREATED"
  filter: "${config.target_folder}/${config.watch_pattern}"
  debounce: 1000
```

#### broadcast (필수, v2.0)

브로드캐스트 모듈 호출 목록입니다. 이벤트가 발생하면 이 목록의 모든 모듈에 **동시에(Async)** 전달됩니다.

각 항목은 `ModuleCall` 객체입니다:

- `module` (필수): 모듈 식별자 (예: "monitor.console_output", "ai.llm.draft_email")
- `id` (선택사항): 실행 ID
- `priority` (선택사항): 우선순위 값 (기본값: 0, PRIORITY 전략 사용 시 중요)
- `condition` (선택사항): 실행 조건식 (예: "${config.log_to_file} == true")
- `args` (선택사항): 모듈 인자 매핑 (동적 변수 사용 가능)

**예시:**
```yaml
broadcast:
  - module: "monitor.console_output"
    id: "action_console"
    priority: 10
    args:
      message: "📄 파일 생성: ${event.filename}"
      path: "${event.path}"
  
  - module: "monitor.log_change"
    id: "action_log"
    condition: "${config.log_to_file} == true"
    args:
      event_type: "created"
      filename: "${event.filename}"
```

#### trigger.aggregation (선택사항, v2.0)

집계 및 충돌 해결 설정입니다. 여러 모듈이 각각 응답 이벤트를 발행할 때, 그 이벤트들 간의 충돌을 어떻게 해결할지 정의합니다. **trigger 내부에 포함**됩니다.

- `strategy` (필수): 충돌 해결 전략
  - `INDEPENDENT`: 독립 실행 (결과를 합치지 않음, 각 모듈이 독립적으로 처리)
  - `PRIORITY`: 우선순위 기반 (높은 우선순위 모듈의 결과 우선)
  - `LATEST`: 최신 우선 (가장 최근에 도착한 이벤트 우선)
  - `MERGE`: 합병 (모든 결과를 합침)
- `target` (선택사항): 최종 결과를 보낼 곳
  - `null`: 결과를 전달하지 않음 (INDEPENDENT 전략과 함께 사용)
  - `"event_bus"`: 결과를 SagoHub로 전달 (Chaining)
  - `module_id`: 특정 모듈 ID로 전달 (예: "M_Monitor_Console", 실제 등록된 모듈 ID만 사용 가능)
- `options` (선택사항): 전략별 상세 옵션
  - `timeout_ms`: 대기 시간 (밀리초)
  - `priority_order`: 우선순위 매핑 (PRIORITY 전략용)
  - `merge_delimiter`: 합병 구분자 (MERGE 전략용)

**예시:**
```yaml
trigger:
  event: "FILE_CREATED"
  aggregation:
    strategy: "PRIORITY"
    target: null  # 또는 "event_bus", 또는 실제 모듈 ID (예: "M_Monitor_Console")
    options:
      timeout_ms: 500
```

**하위 호환성**: 최상위 레벨의 `aggregation` 필드도 여전히 지원됩니다 (자동으로 `trigger.aggregation`으로 변환됨).

#### steps (하위 호환성)

기존 v1.0 스키마의 `steps` 필드입니다. v2.0에서는 `broadcast`로 자동 변환됩니다.

## 이벤트 타입

### 파일 시스템 이벤트

- `FILE_CREATED`: 파일 생성
- `FILE_MODIFIED`: 파일 수정
- `FILE_DELETED`: 파일 삭제

### 모듈 이벤트

- `fs.read.success`: 파일 읽기 완료
- `fs.read.error`: 파일 읽기 실패

### 사용자 정의 이벤트

모듈에서 발행하는 커스텀 이벤트도 사용할 수 있습니다.

## 모듈 ID 매핑

파이프라인 YAML에서 사용하는 모듈 이름은 내부 모듈 ID로 자동 매핑됩니다:

| YAML 모듈 이름 | 내부 모듈 ID |
|--------------|------------|
| `ai.llm.draft_email` | `M_LLM_Drafter` |
| `nudge.create_draft` | `M_Nudge_UI` |
| `nudge.check_approval` | `M_Nudge_UI` |
| `mail.send` | `M_Mailer` |
| `monitor.log_change` | `M_Monitor_Log` |
| `monitor.console_output` | `M_Monitor_Console` |
| `fs.read` | (가상 모듈, 스킵) |

## 동적 변수

파이프라인에서 동적 변수를 사용할 수 있습니다:

- `${config.xxx}`: 설정 값 참조
- `${event.xxx}`: 이벤트 데이터 참조
- `${event.content:0:100}`: 문자열 슬라이싱 (0부터 100자까지)

**예시:**
```yaml
args:
  message: "📄 파일 생성: ${event.filename}"
  path: "${event.path}"
  content_preview: "${event.content:0:100}"
```

## 집계 전략 상세 설명

### INDEPENDENT (독립 실행)

각 모듈이 독립적으로 실행되며, 결과를 합치지 않습니다. UI 업데이트나 로그 저장 같은 부수 효과(side effect)가 있는 작업에 적합합니다.

```yaml
trigger:
  event: "FILE_CREATED"
  aggregation:
    strategy: "INDEPENDENT"
    target: null
```

**사용 사례:**
- 파일 생성 시 콘솔 출력과 로그 저장을 동시에 수행

### PRIORITY (우선순위)

높은 우선순위(`priority` 값이 큰) 모듈이 발행한 응답 이벤트를 우선합니다. 여러 모듈이 각각 응답 이벤트를 발행할 때, 충돌이 발생하면 우선순위가 높은 모듈의 응답만 사용합니다.

```yaml
trigger:
  event: "FILE_CREATED"
  aggregation:
    strategy: "PRIORITY"
    target: "system.ui_manager"
    options:
      timeout_ms: 500

broadcast:
  - module: "monitor.console_output"
    priority: 10  # 높은 우선순위
  
  - module: "monitor.log_change"
    priority: 5  # 낮은 우선순위
```

**사용 사례:**
- 콘솔 출력과 로그 저장 중 콘솔 출력을 우선

### LATEST (최신 우선)

가장 최근에 도착한 이벤트를 우선합니다. 빠른 응답이 중요한 경우에 사용합니다.

```yaml
trigger:
  event: "FILE_MODIFIED"
  aggregation:
    strategy: "LATEST"
    target: "event_bus"
```

**사용 사례:**
- 파일 읽기 완료 후 다음 파이프라인으로 체이닝

### MERGE (합병)

여러 모듈이 각각 응답 이벤트를 발행할 때, 모든 응답 이벤트의 payload와 metadata를 합쳐서 하나의 이벤트로 만듭니다. 여러 모듈의 결과를 모두 필요로 할 때 사용합니다.

```yaml
trigger:
  event: "FILE_CREATED"
  aggregation:
    strategy: "MERGE"
    target: "event_bus"
    options:
      merge_delimiter: "\n"
```

**사용 사례:**
- 여러 모듈의 로그를 하나로 합치기

## 파이프라인 체이닝 (Chaining)

파이프라인을 연결하여 순차적인 처리를 구현할 수 있습니다. `aggregation.target`을 `"event_bus"`로 설정하면 결과가 새로운 이벤트로 발행되어 다음 파이프라인을 트리거합니다.

**예시:**
```yaml
# Step 1: 파일 읽기
- id: "flow_read_content"
  trigger:
    event: "FILE_MODIFIED"
    aggregation:
      strategy: "LATEST"
      target: "event_bus"  # 읽기 완료 이벤트 발행
  broadcast:
    - module: "fs.read"

# Step 2: 읽기 완료 후 처리
- id: "flow_display_content"
  trigger:
    event: "fs.read.success"  # 위 파이프라인에서 발행된 이벤트
    aggregation:
      strategy: "INDEPENDENT"
      target: null
  broadcast:
    - module: "monitor.console_output"
```

## 하위 호환성

기존 v1.0 스키마의 `on`과 `steps` 필드도 여전히 지원됩니다:

```yaml
pipelines:
  - name: "Legacy Pipeline"
    on:  # trigger로 자동 변환
      event: "FILE_CREATED"
    steps:  # broadcast로 자동 변환
      - module: "monitor.console_output"
        args:
          message: "${event.filename}"
```

## 예시: File Monitor v2.0

```yaml
service:
  id: "com.SagoHub.file-monitor"
  version: "2.0.0"
  name: "File Monitor"

config:
  target_folder:
    type: "path"
    default: "./obsidian"
  log_to_file:
    type: "boolean"
    default: true

pipelines:
  # 파일 생성 시: 콘솔 출력과 로그 저장을 독립적으로 수행
  - id: "flow_file_created"
    name: "Handle File Creation"
    
    trigger:
      event: "FILE_CREATED"
      filter: "${config.target_folder}/${config.watch_pattern}"
      debounce: 1000

    broadcast:
      - module: "monitor.console_output"
        id: "action_console"
        args:
          message: "📄 파일 생성: ${event.filename}"
          path: "${event.path}"
      
      - module: "monitor.log_change"
        id: "action_log"
        condition: "${config.log_to_file} == true"
        args:
          event_type: "created"
          filename: "${event.filename}"

    aggregation:
      strategy: "INDEPENDENT"
      target: null

  # 파일 수정 시: 읽기 후 콘솔 출력 및 로그 저장 (우선순위)
  - id: "flow_read_content"
    name: "Read Modified File"
    
    trigger:
      event: "FILE_MODIFIED"
      filter: "${config.target_folder}/${config.watch_pattern}"
    
    broadcast:
      - module: "fs.read"
        id: "action_read"
        args:
          path: "${event.path}"
    
    aggregation:
      strategy: "LATEST"
      target: "event_bus"

  - id: "flow_display_content"
    name: "Display Modified Content"
    
    trigger:
      event: "fs.read.success"
      filter: "payload.origin_event == 'FILE_MODIFIED'"
    
    broadcast:
      - module: "monitor.console_output"
        id: "ui_console"
        priority: 10
        args:
          message: "✏️ 수정됨: ${event.filename}"
          content_preview: "${event.content:0:100}"

      - module: "monitor.log_change"
        id: "ui_log"
        priority: 5
        condition: "${config.log_to_file} == true"
        args:
          event_type: "modified"
          content: "${event.content}"

    aggregation:
      strategy: "PRIORITY"
      target: null
      options:
        timeout_ms: 500
```

## 주요 변경 사항 (v1.0 → v2.0)

1. **`steps` 삭제 → `broadcast` & `trigger.aggregation` 도입**: 순차 실행 목록을 없애고, 동시에 실행될 모듈 목록(`broadcast`)과 여러 모듈이 각각 응답 이벤트를 발행할 때 충돌을 해결할 규칙(`trigger.aggregation`)으로 변경했습니다. `aggregation`은 이벤트 처리 전략이므로 `trigger` 내부에 포함됩니다.

2. **`on` → `trigger`**: 트리거 필드명을 더 명확하게 변경했습니다 (하위 호환성 유지).

3. **`trigger.aggregation.strategy` 필드 추가**: 4가지 충돌 해결 전략(`INDEPENDENT`, `PRIORITY`, `LATEST`, `MERGE`)을 명시합니다.

4. **`args` 매핑의 유연화**: 각 모듈이 이벤트의 어떤 데이터를 가져다 쓸지 명시합니다.

5. **파이프라인 체이닝**: `trigger.aggregation.target: "event_bus"`를 통해 파이프라인을 자연스럽게 연결할 수 있습니다.

## 장점

1. **순환 참조 해결**: 이벤트의 꼬리물기로 자연스럽게 처리됩니다.
2. **명시적인 병렬 처리**: `broadcast` 리스트의 모듈들은 동시에 호출됩니다.
3. **응답 이벤트 충돌 제어**: 여러 모듈이 각각 응답 이벤트를 발행할 때, `aggregation.strategy`를 통해 충돌을 어떻게 해결할지 명확히 정의됩니다.
