# 서비스 동적 실행 가이드

## 개요

서비스는 `docker-compose.yml`에 포함되지 않고, 필요할 때마다 동적으로 생성됩니다. 각 서비스의 `service.yaml` 파일에서 서비스 설정을 읽어서 Docker 컨테이너 또는 프로세스로 실행합니다.

## 사용 방법

### 1. 핵심 서비스 시작

#### Docker 모드 (`USE_DOCKER=true`)

```bash
cd src/SagoHub/runner
docker-compose up -d
```

이 명령은 SagoHub, 모듈들, SagoHub runner만 시작합니다. 파이프라인은 포함되지 않습니다.

#### 직접 실행 모드 (`USE_DOCKER=false`)

```bash
cd src/SagoHub/runner
python3 main.py
```

이 명령은 SagoHub(스레드), 모듈들(스레드)을 시작합니다. 파이프라인은 별도 프로세스로 실행됩니다.

### 2. 서비스 동적 실행

#### Docker 모드

```bash
# 방법 1: Python 스크립트 사용 (권장)
python3 start_pipelines.py

# 방법 2: 개별 서비스 실행
docker run -d \
  --name SagoHub-service-file_monitor \
  --network foldering-network \
  -v $(pwd)/../services:/services:ro \
  -e PIPELINES_DIR=/services \
  -e EVENT_BUS_URL=http://event-bus:8000 \
  SagoHub-runner \
  python pipeline_runner.py com.SagoHub.file-monitor
```

#### 직접 실행 모드

```bash
# 방법 1: Python 스크립트 사용 (권장)
python3 start_pipelines.py

# 방법 2: 개별 서비스 실행
python3 pipeline_runner.py com.SagoHub.file-monitor
```

### 3. 서비스 중지

#### Docker 모드

```bash
python3 stop_pipelines.py

# 또는 개별 중지
docker stop SagoHub-service-file_monitor
docker rm SagoHub-service-file_monitor
```

#### 직접 실행 모드

```bash
# 프로세스를 수동으로 종료하거나 Ctrl+C 사용
# 또는 start_pipelines.py로 실행한 경우 프로세스 ID로 종료
```

## 환경 변수

### `SELECTED_PIPELINE`
특정 서비스만 실행하려면:

```bash
export SELECTED_PIPELINE=file-monitor
python3 start_pipelines.py
```

### `USE_DOCKER`
실행 모드 선택:

```bash
export USE_DOCKER=true   # Docker 모드
export USE_DOCKER=false  # 직접 실행 모드
```

## 예시

### 새로운 서비스 추가하기

1. `services/my-new-service/service.yaml` 생성

2. 서비스 실행:

```bash
# Docker 모드
USE_DOCKER=true python3 start_pipelines.py

# 직접 실행 모드
USE_DOCKER=false python3 start_pipelines.py
```

3. 결과 확인:

```bash
# Docker 모드
docker ps --filter "name=SagoHub-service-"

# 직접 실행 모드
ps aux | grep pipeline_runner
```

## 장점

1. **유연성**: 필요한 서비스만 선택적으로 실행 가능
2. **확장성**: 새 서비스 추가 시 docker-compose.yml 수정 불필요
3. **독립성**: 각 서비스가 독립적으로 관리됨
4. **간소화**: docker-compose.yml이 핵심 서비스만 포함하여 더 간단함

## 주의사항

- 서비스는 `foldering-network` 네트워크에 연결되어야 SagoHub에 접근할 수 있습니다
- Docker 이미지가 먼저 빌드되어 있어야 합니다: `docker-compose build`
- 서비스 실행 전에 SagoHub와 필요한 모듈들이 실행되어 있어야 합니다
