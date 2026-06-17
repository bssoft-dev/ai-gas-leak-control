# SagoHub Foldering Engine

서비스 지향 아키텍처를 기반으로 한 파일 조직화 엔진입니다.

## 아키텍처

### HTTP 기반 SagoHub

SagoHub와 모듈 간 통신은 HTTP를 통해 이루어집니다:

- **SagoHub 서버**: FastAPI 기반 REST API 서버
- **모듈**: HTTP 클라이언트를 통해 이벤트 발행 및 수신
- **서비스**: 모듈이 생성한 이벤트를 HTTP로 발행

### 실행 모드

1. **직접 모드** (`EVENT_BUS_URL`이 비어있음)
   - SagoHub와 모듈이 같은 프로세스에서 실행
   - 개발 및 테스트에 적합

2. **HTTP 모드** (`EVENT_BUS_URL` 설정)
   - SagoHub가 별도 서버로 실행
   - 모듈이 HTTP를 통해 이벤트 발행
   - 프로덕션 및 Docker 배포에 적합

## 실행 방법

### 직접 실행 (개발 모드)

```bash
# SagoHub 서버 실행 (터미널 1)
python main_core.py
# 또는 이벤트 버스만: python -m SagoHub.core.event_bus_server

# 엔진 실행 (터미널 2)
EVENT_BUS_URL=http://localhost:8000 python main.py
```

### Docker Compose 실행

```bash
# .env 파일 설정
EVENT_BUS_URL=http://event-bus:8000
USE_DOCKER=true

# 실행
docker-compose up
```

## API 엔드포인트

### 이벤트 발행

```bash
POST /publish
Content-Type: application/json

{
  "type": "E_FileCreated",
  "payload": {
    "path": "/path/to/file.md",
    "content": "..."
  },
  "source_module": "M_FileWatcher"
}
```

### 모듈 관리

- `GET /modules` - 모듈 목록 조회
- `POST /modules` - 모듈 등록
- `GET /modules/{module_id}` - 모듈 정보 조회
- `PUT /modules/{module_id}` - 모듈 정보 수정
- `DELETE /modules/{module_id}` - 모듈 삭제

### 서비스 관리 (API는 하위 호환성을 위해 `/pipelines` 엔드포인트 사용)

- `GET /pipelines` - 서비스 목록 조회
- `POST /pipelines` - 서비스 등록
- `GET /pipelines/{pipeline_id}` - 서비스 정보 조회
- `PUT /pipelines/{pipeline_id}` - 서비스 정보 수정
- `DELETE /pipelines/{pipeline_id}` - 서비스 삭제

### 헬스 체크

```bash
GET /health
```

## 환경 변수

- `EVENT_BUS_URL`: SagoHub 서버 URL (HTTP 모드)
- `EVENT_BUS_HOST`: SagoHub 서버 호스트 (기본값: 0.0.0.0)
- `EVENT_BUS_PORT`: SagoHub 서버 포트 (기본값: 8000)
- `PIPELINES_DIR`: 서비스 디렉토리 경로 (기본값: `services/`, 하위 호환성을 위해 PIPELINES_DIR 유지)
- `SERVICES_DIR`: 하위 호환성을 위한 별칭 (deprecated)
- `LOCAL_MOUNT_POINT`: 감시할 폴더 경로
- `POLL_INTERVAL`: 파일 감시 폴링 간격 (초)

## 서비스 개발

서비스는 `services/` 디렉토리에 `service.yaml` 파일로 정의됩니다.

서비스에 사용되는 모든 모듈은 SagoHub에 사전 등록되어야 합니다.

```yaml
# service.yaml 예시
service:
  id: "com.SagoHub.example"
  name: "Example Service"
  pipelines:
    - name: "Example Pipeline"
      on:
        event: "FILE_CREATED"
      steps:
        - module: "monitor.console_output"
          args:
            show_content: true
```
