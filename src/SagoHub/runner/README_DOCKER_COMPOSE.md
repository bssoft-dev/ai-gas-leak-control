# UI 서버 동적 실행 가이드

## 개요

UI 서버는 `docker-compose.yml`에 포함되지 않고, 필요할 때마다 동적으로 생성됩니다. 각 서비스의 `service.yaml` 파일에서 UI 서버 설정을 읽어서 Docker 컨테이너로 실행합니다.

## 사용 방법

### 1. 서비스 YAML에 UI 서버 설정 추가

각 서비스의 `service.yaml` 파일에 `ui_server` 섹션을 추가하세요:

```yaml
service:
  id: "com.SagoHub.your-service"
  # ... 기타 설정 ...
  
  # UI 서버 설정
  ui_server:
    port: 8080  # 내부 포트 (모든 서비스 통일)
    external_port: 8082  # 외부 포트 (호스트에서 접근, 서비스별로 다름)
    event_bus_url: "http://event-bus:8000"  # Docker 내부 네트워크용
```

### 2. 핵심 서비스 시작 (docker-compose)

```bash
cd src/SagoHub/runner
docker-compose up -d
```

이 명령은 SagoHub, 모듈들, 파이프라인 엔진만 시작합니다. UI 서버는 포함되지 않습니다.

### 3. UI 서버 동적 실행

```bash
# 방법 1: Python 스크립트 사용 (권장)
python3 start_ui_servers.py

# 방법 2: Shell 스크립트 사용
./start_ui_servers.sh
```

이 스크립트는:
- `services/` 디렉토리의 모든 `service.yaml` 파일을 스캔
- `ui_server` 설정이 있는 서비스를 찾아서
- 각각을 독립적인 Docker 컨테이너로 실행

### 4. UI 서버 중지

```bash
# 방법 1: Python 스크립트
python3 stop_ui_servers.py

# 방법 2: Shell 스크립트
./stop_ui_servers.sh

# 또는 개별 중지
docker stop SagoHub-ui-file_monitor
docker rm SagoHub-ui-file_monitor
```

## 설정 필드 설명

### `ui_server.port` (필수)
- **내부 포트**: Docker 컨테이너 내부에서 사용하는 포트
- **기본값**: 8080
- **권장**: 모든 서비스에서 통일 (8080)

### `ui_server.external_port` (필수)
- **외부 포트**: 호스트에서 접근할 수 있는 포트
- **기본값**: 없음 (반드시 지정 필요)
- **주의**: 각 서비스마다 고유한 포트 번호 사용

### `ui_server.event_bus_url` (선택)
- **SagoHub URL**: Docker 내부 네트워크에서 접근 가능한 URL
- **기본값**: `http://event-bus:8000`
- **변경 필요 시**: Docker 네트워크 설정에 맞게 수정

## 예시

### 새로운 서비스 추가하기

1. `services/my-new-service/service.yaml` 생성:

```yaml
service:
  id: "com.SagoHub.my-new-service"
  name: "My New Service"
  # ...
  ui_server:
    port: 8080
    external_port: 8082  # 사용 가능한 포트
    event_bus_url: "http://event-bus:8000"
```

2. UI 서버 실행:

```bash
python3 start_ui_servers.py
```

3. 결과 확인:

```bash
docker ps --filter "name=SagoHub-ui-"
```

## 장점

1. **유연성**: 필요한 UI 서버만 선택적으로 실행 가능
2. **확장성**: 새 서비스 추가 시 docker-compose.yml 수정 불필요
3. **독립성**: 각 UI 서버가 독립적으로 관리됨
4. **간소화**: docker-compose.yml이 핵심 서비스만 포함하여 더 간단함

## 주의사항

- `external_port`가 설정되지 않은 서비스는 UI 서버가 실행되지 않습니다
- 포트 충돌을 방지하기 위해 각 서비스마다 고유한 `external_port`를 지정하세요
- UI 서버는 `foldering-network` 네트워크에 연결되어야 SagoHub에 접근할 수 있습니다
- Docker 이미지가 먼저 빌드되어 있어야 합니다: `docker-compose build`
