# SagoHub 시스템 아키텍처

## 개요

SagoHub는 **모듈, 코어(SagoHub), 서비스(파이프라인), UI**가 모두 **별도의 프로세스(도커 또는 쓰레드)**로 동작하는 분산 시스템입니다.

## 아키텍처 구성 요소

### 1. 모듈 (Modules)
**실행 방식**: 별도 프로세스 (Docker 컨테이너 또는 스레드)

- **Docker 모드**: 각 모듈이 독립적인 Docker 컨테이너로 실행
  - `module-filewatcher`
  - `module-llm-drafter`
  - `module-nudge-ui`
  - `module-mailer`
  - `module-monitor-log`
  - `module-monitor-console`

- **직접 실행 모드**: 각 모듈이 별도 스레드로 실행 (`main.py`의 `run_direct()`)
  - `threading.Thread`로 각 모듈 실행
  - 각 모듈은 `ModuleServer`를 통해 FastAPI 서버로 실행

**특징**:
- 각 모듈은 SagoHub에 자체 등록
- HTTP 기반 푸시 방식으로 이벤트 수신
- 독립적인 생명주기 관리

### 2. 코어 - SagoHub (Event Bus)
**실행 방식**: 별도 프로세스 (Docker 컨테이너 또는 스레드)

- **Docker 모드**: `event-bus` 컨테이너로 실행
- **직접 실행 모드**: 별도 스레드로 실행 (`main.py`의 `run_direct()`)

**역할**:
- 이벤트 라우팅 및 브로드캐스팅
- 모듈 및 파이프라인 등록 관리
- 이벤트 구독/발행 관리

### 3. 서비스 - 파이프라인 (Pipelines)
**실행 방식**: ✅ **별도 프로세스 (Docker 컨테이너 또는 프로세스)**

- **Docker 모드**: 각 파이프라인이 독립적인 Docker 컨테이너로 실행
  - `start_pipelines.py`로 동적 생성
  - 각 파이프라인은 `pipeline_runner.py`를 실행하는 별도 컨테이너

- **직접 실행 모드**: 각 파이프라인이 별도 프로세스로 실행
  - `main.py`의 `run_direct()`에서 `subprocess.Popen`으로 실행
  - 또는 `start_pipelines.py`로 직접 실행

**특징**:
- 각 파이프라인은 독립적인 생명주기 관리
- 동적 파이프라인 추가/제거 지원
- `pipeline_runner.py`로 각 파이프라인 실행

### 4. UI 서버
**실행 방식**: 별도 프로세스 (동적 생성 Docker 컨테이너)

- 각 서비스의 `service.yaml`에서 `ui_server` 설정을 읽어서 동적으로 생성
- `start_ui_servers.py`로 실행
- 각 UI 서버는 독립적인 Docker 컨테이너로 실행

**특징**:
- 서비스별로 독립적인 UI 서버
- 동적 생성 및 관리
- `docker-compose.yml`에 포함되지 않음

## 실행 모드

### Docker 모드 (`USE_DOCKER=true`)
```
event-bus (컨테이너)
  ├── SagoHub runner (컨테이너) - 파이프라인 관리
  ├── module-filewatcher (컨테이너)
  ├── module-llm-drafter (컨테이너)
  ├── module-nudge-ui (컨테이너)
  ├── module-mailer (컨테이너)
  ├── module-monitor-log (컨테이너)
  ├── module-monitor-console (컨테이너)
  └── ui-* (동적 생성 컨테이너)
```

### 직접 실행 모드 (`USE_DOCKER=false`)
```
메인 프로세스
  ├── SagoHub (스레드)
  ├── SagoHub runner (메인 프로세스) - 파이프라인 관리
  ├── 모듈들 (각각 별도 스레드)
  └── UI 서버 (별도 프로세스, 필요 시)
```

## 통신 방식

- **모듈 ↔ SagoHub**: HTTP REST API
- **파이프라인 ↔ SagoHub**: HTTP REST API
- **UI ↔ SagoHub**: HTTP REST API
- **모듈 ↔ 모듈**: SagoHub를 통한 간접 통신

## 현재 아키텍처 상태

✅ **완료된 부분**:
- 모듈: 별도 프로세스로 실행
- 코어(SagoHub): 별도 프로세스로 실행
- 서비스(파이프라인): 별도 프로세스로 실행 ✅
- UI: 별도 프로세스로 실행

## 실행 방법

### Docker 모드 (`USE_DOCKER=true`)

1. **핵심 서비스 시작**:
   ```bash
   docker-compose up -d
   ```
   - SagoHub, 모듈들, SagoHub runner 시작

2. **파이프라인 실행**:
   ```bash
   python3 start_pipelines.py
   ```
   - 각 파이프라인을 별도 Docker 컨테이너로 실행

3. **UI 서버 실행**:
   ```bash
   python3 start_ui_servers.py
   ```
   - 각 서비스의 UI를 별도 Docker 컨테이너로 실행

### 직접 실행 모드 (`USE_DOCKER=false`)

1. **핵심 서비스 시작**:
   ```bash
   python3 main.py
   ```
   - SagoHub(스레드), 모듈들(스레드) 시작
   - 파이프라인은 별도 프로세스로 실행됨

2. **파이프라인 실행** (선택사항):
   ```bash
   python3 start_pipelines.py
   ```
   - 또는 `main.py`에서 자동으로 실행됨

## 파일 구조

- `main.py`: SagoHub 및 모듈 실행 (파이프라인은 별도 프로세스로 실행)
- `pipeline_runner.py`: 개별 파이프라인 실행 스크립트
- `start_pipelines.py`: 서비스 동적 실행 스크립트
- `stop_pipelines.py`: 서비스 중지 스크립트
- `start_ui_servers.py`: UI 서버 동적 실행 스크립트
- `stop_ui_servers.py`: UI 서버 중지 스크립트
