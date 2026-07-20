# AI 가스 누출 — MinIO 데이터 업로드 저장 형식

> **근거:** `docs/데이터스키마_AI가스누출_데이터포털형.md`, `docs/데이터포털_등록신청_데이터주요정보_AI가스누출.md`  
> **매뉴얼:** 데이터 업로드 매뉴얼(MinIO)_기업용 v2.0 (UTF-8, manifest, JSON/CSV/NDJSON)

## 1. 업로드 데이터 구분 (학습/검증 아님)

| 구분 | 매뉴얼 폴더명 | 내용 |
|------|---------------|------|
| **수집 데이터** | `원천데이터` | 센서 스냅샷, 시계열, 상태, 일일 사용량, raw tick, 도면·이미지, 엣지 등록 |
| **이벤트 로그** | `이벤트로그` | AI 판단 이력, 제어 이력, 경보 이력, 통합 `event_logs.csv/ndjson` |

Training/Validation 분할·라벨링데이터 폴더는 **사용하지 않습니다**.

## 2. 디렉터리 구조

### 2.1 평문 배치 (`minio_upload/latest/`)

```
data/ai_gas_leak/minio_upload/
├── latest/
│   ├── manifest.json
│   ├── metadata/dataset_info.json
│   ├── schemas/
│   ├── collected/              # 수집 데이터 (원천)
│   │   ├── csv/   sensors_snapshot, timeseries, daily_usage
│   │   ├── json/  state, sensors, timeseries, daily_usage, data_mart, drawings, edge_registry
│   │   ├── ndjson/ timeseries, raw_ticks
│   │   └── assets/ 도면 이미지 (jpg/png 등)
│   └── event_logs/             # 이벤트 로그
│       ├── csv/   ai_history, control_history, alarm_history, event_logs (통합)
│       ├── json/  ai_history, control_history, alarm_history, ai_feedback
│       └── ndjson/ event_logs (통합)
└── zip_packages/
    └── Example_bluesp/{dataset_id}/
        ├── upload_data.zip       # 단일 업로드 파일
        └── zip_manifest.json
```

### 2.2 압축 패키지 (포털 업로드용 — **zip 1개**)

```
zip_packages/latest/
├── upload_data.zip          # ★ 업로드 파일 (단일)
└── zip_manifest.json        # 메타 (zip 밖 참조용, zip 내부에도 포함)

upload_data.zip 내부:
├── zip_manifest.json
├── 원천데이터/
│   ├── sensors_snapshot.csv
│   ├── timeseries.csv
│   └── ...
└── 이벤트로그/
    ├── ai_history.csv
    ├── event_logs.csv
    └── ...
```

## 3. 파일별 형식

### 3.1 수집 데이터 (`collected/` → zip 내 `원천데이터/`)

| 파일 | 설명 |
|------|------|
| `sensors_snapshot.csv` | 센서 현재값 스냅샷 |
| `timeseries.csv` / `.ndjson` | 압력·유량·센서별 시계열 (평탄화) |
| `raw_ticks.ndjson` | raw 수집 tick (jsonl 원본) |
| `daily_usage.csv` | 일일 가스 사용량 |
| `state.json` | 밸브·경광·MES·정책 상태 |
| `sensors.json` | 센서 목록 |
| `timeseries.json` | 시계열 원본 JSON |
| `timeseries/daily/YYYY-MM-DD.json` | **일별 누적 시계열** (truncate 없음, 과거 데이터 보존) |
| `timeseries_realtime.json` | 실시간 차트용 버퍼 (최근 120포인트) |
| `drawings.json` + `assets/*` | 도면 메타·이미지 |
| `edge_registry.json` | 엣지 등록 정보 (있을 때) |

### 3.2 이벤트 로그 (`event_logs/` → zip 내 `이벤트로그/`)

| 파일 | 설명 |
|------|------|
| `ai_history.csv/json` | AI 판단·비상 이벤트 |
| `control_history.csv/json` | 제어 실행 이력 |
| `alarm_history.csv/json` | 경보·SMS·앱 알림 이력 |
| `event_logs.csv/ndjson` | 위 3종 통합 (`log_category`: ai/control/alarm) |
| `ai_feedback.json` | 오탐 피드백 (있을 때) |

## 4. 압축 규칙

| 규칙 | 구현 |
|------|------|
| **업로드 zip 1개** | `upload_data.zip` 단일 파일 |
| zip 내부 폴더 | `원천데이터/`, `이벤트로그/` |
| 인코딩 | UTF-8 |
| dataset_id | `dataset_registry.json` 자동 증가 |

## 5. 자동 생성

| 트리거 | 설명 |
|--------|------|
| `build_data_mart_snapshot()` | Mart 생성 시 (약 30초 주기) |
| `POST /api/gas-leak/upload/export?force=1` | 수동 즉시 생성 |
| CLI | `GAS_LEAK_UPLOAD_COMPANY_FOLDER=Example_bluesp python modules/gas_leak_control/minio_upload_export.py` |

## 6. MinIO 업로드

```bash
mc cp data/ai_gas_leak/minio_upload/zip_packages/latest/upload_data.zip \
  myminio/sagohub-data/Example_bluesp/
```

## 7. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AI_GAS_LEAK_DATA_DIR` | `data/ai_gas_leak` | 데이터 루트 |
| `GAS_LEAK_UPLOAD_COMPANY_FOLDER` | `Example_bluesp` | 기업 폴더명 |
