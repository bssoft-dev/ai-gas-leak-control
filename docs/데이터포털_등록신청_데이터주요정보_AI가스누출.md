# 데이터포털 데이터 등록 신청 — 데이터 주요 정보 (소스 기준)

데이터포털 예시 양식의 **「2) 데이터 주요 정보」**·**「데이터 등록 정보」**·**산업/유형/키워드」** 블록에 맞춰 작성했습니다.  
**근거 소스:** `modules/gas_leak_control/gas_leak_control.py`, `modules/gas_leak_plant/gas_leak_plant.py`, `src/SagoHub/service/ui_server.py` (`com.SagoHub.ai-gas-leak-control`), `services/ai-gas-leak-control/service.yaml`, `services/ai-gas-leak-control/README.md`, 저장 경로 `data/ai_gas_leak/` (환경변수 `AI_GAS_LEAK_DATA_DIR` 시 해당 경로).

> 제출 전 **구축 기간·구축량·수집장소·라이선스**는 과제·운영 실적에 맞게 수정하세요.

---

## 2) 데이터명 · 데이터셋 개요

### 데이터명*

| 구분 | 내용 |
|------|------|
| **국문명** | AI 가스 누출 자동제어 제조·안전 관제 데이터 |
| **영문명** | AI Gas Leak Detection and Control — Manufacturing Safety Telemetry and State Data |

### 데이터셋 개요*

| 구분 | 내용 (2~3줄) |
|------|----------------|
| **소개*** | SagoHub 서비스 `com.SagoHub.ai-gas-leak-control`에서 **압력·유량·가스 농도(%)** 등 센서 시계열(`timeseries.json`), 센서 스냅샷(`sensors.json`), 설비·밸브·경광/사이렌·구역 상태(`state.json`), AI·비상 이력(`ai_history.json`), 공장 **도면 메타·이미지**(`drawings.json`, `uploads/`), 도면별 **센서 좌표**(`points/{drawing_id}.json`)를 생성·갱신합니다. MES는 `POST /api/gas-leak/mes-status`로 **설비 가동 여부·작업지시 ID**를 받아 `state.json`에 반영합니다. |
| **구축 목적*** | 가스 누출·이상 징후 **실시간 감지**, Rule 기준(농도 3% 이상 등) **자동 비상 차단**, 관제 UI 및 **데이터 포털·분석**을 위한 **구조화 제조·안전 데이터** 확보. |

---

## 데이터 등록 정보

| 항목 | 소스 기준 작성 내용 |
|------|---------------------|
| **데이터 구축 기간*** | 과제 계약 기간으로 기입 (예: 2025/04 ~ 2026/03). 코드상 수집 시각은 `datetime.utcnow().isoformat() + "Z"` 형식. |
| **데이터 형식*** | **json** (상태·센서·시계열·이력·도면 메타·포인트). 도면 바이너리: **`gas_leak_plant.ALLOWED_EXTENSIONS`** — `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`. API: **application/json** (`ui_server` 가스 누출 라우트). |
| **데이터 출처*** | **시스템 직접 수집**: `GasLeakControlModule` 시뮬레이터 루프(약 **1초** 주기, `time.sleep(1)`)가 `sensors.json`·`timeseries.json`·`ai_history.json`·`state.json` 갱신. 도면·포인트는 `GasLeakPlantModule` 이벤트(`GAS_LEAK_DRAWING_*`, `GAS_LEAK_SENSORS_SAVE`) 처리. MES는 외부 서버 → **`POST /api/gas-leak/mes-status`** → 이벤트 버스 `GAS_LEAK_MES_STATUS` → 동일 모듈이 `state.json`의 `mes_*` 갱신. |
| **데이터 구축량*** | 시계열: `gas_leak_control.MAX_SERIES_POINTS` = **120** (압력·유량 각 시리즈 및 센서별 시리즈당 유지 포인트 상한). `ai_history` 최대 **500**건(`MAX_AI_HISTORY`). 도면·이미지 건수는 `drawings.json` 배열 길이 및 `uploads/` 파일 수. 용량은 운영 일수·센서 수에 비례 — **「약 N일치 / M MB」** 형태로 산정해 기재. |
| **라이선스*** | 포털·기관 규정에 따름. 외부 공개 없으면 **기타** + 내부 이용·재배포 제한 문구. |
| **이용정책*** | 라이선스에 이용조건이 모두 명시된 경우 **해당 없음** 가능. 도면(`uploads/`)은 시설 배치 정보 포함 가능 — **접근 등급·목적 외 이용 금지** 명시 권장. |
| **파일 구조** | 아래 디렉터리 구조 참조. 루트는 `AI_GAS_LEAK_DATA_DIR` 또는 프로젝트 루트 기준 `data/ai_gas_leak/` (`gas_leak_control._data_dir()` / `gas_leak_plant._data_dir()`). |
| **수집장소** | 코드에 고정 주소 없음 — **실제 공장/사업장 주소** 기입. |
| **데이터 구분*** | **기타** — *「제조 설비 시계열·상태·이벤트 로그 (대화형 LLM 학습 데이터 아님)」*. 시뮬레이터 비중이 크면 **합성데이터** 병기 검토. |
| **데이터 분야*** | **재난안전환경** (산업 가스·누출 안전). 도면 이미지 비중 강조 시 **영상이미지** 병기. |

### 파일 구조 (소스: `_data_dir()` 하위)

```
data/ai_gas_leak/
├── state.json           # valve_closed, zones[], emergency_at, alarm_*, mes_*, last_control 등
├── sensors.json         # 센서별 id, zone_id, label, value, unit, status (sensor_type은 데이터에 있을 수 있음)
├── timeseries.json      # pressure[], flow[], sensors{ sensorId: [{t,v}, ...] }
├── ai_history.json      # 시뮬레이터·비상·MES 로직이 append하는 이벤트 목록
├── drawings.json        # 도면 메타 (id, name, filename, file_type, file_path, created_at, updated_at)
├── uploads/             # 도면 이미지 (파일명 규칙: {uuid}{원본확장자})
├── points/
│   └── {drawing_id}.json   # 현재 모듈: 센서 객체의 JSON 배열 (gas_leak_plant._save_points)
└── minio_upload/        # ★ MinIO·데이터포털 업로드용 (자동 생성, docs/데이터업로드_MinIO_저장형식.md)
    ├── latest/          # mc cp 업로드 대상
    ├── batches/         # 배치별 스냅샷
    └── batches_index.json
```

**참고:** `control_history.json`, `daily_usage.json`, `state.json` 내 `policy`·`risk_level` 등은 **본 워크스페이스 `gas_leak_control.py` 시뮬레이터가 직접 쓰지 않는 필드**일 수 있습니다. 배포·확장 브랜치에서 사용 시 별도 기술.

---

## 산업·데이터 유형·키워드 등 (체크·기입란)

| 항목 | 내용 |
|------|------|
| **산업/도메인** | **제조** |
| **데이터 유형** | **센서**, **이미지** (도면). 구조화 로그·상태는 필요 시 **기타**: *JSON(이력/상태)* |
| **주요 키워드** | **제조**, **안전**, **환경**(가스·누출 관리) |
| **라벨링 유형** | **해당 없음** (별도 크라우드 라벨링 없음). 이력의 `type`·`message`는 **애플리케이션 로그 분류**에 해당. |
| **라벨링 형식** | **해당 없음** |
| **데이터 활용 서비스** | 가스 누출 **관제 대시보드**(React, `GasLeakControlDashboard`), **실시간 차트**, **비상 밸브·경광/사이렌 제어**, **MES 연동 오탐 완화**, **AI 판단 이력** 조회, **디지털 트윈**(도면·센서 좌표), 이벤트 버스 파이프라인(`service.yaml` `pipelines`) 기반 모듈 연동 |
| **데이터 특이사항** | 시계열 버퍼 **최대 120포인트/시리즈**(`MAX_SERIES_POINTS`). 가스 농도 **3% 이상** 시 Rule 기반 비상 처리(`CONCENTRATION_RULE_PERCENT`). 비가동(`mes_equipment_running == false`) 중 유량·압력·농도 감지 시 **오탐 방지용** `ai_history` 기록. **개인식별정보 필드 없음**. REST: `GET /api/gas-leak/*`, `POST /api/gas-leak/mes-status`; 제어·도면 등은 **`POST /api/events/publish`**; 실시간 알림 **`GET /api/events/stream`**. |

---

## 서비스·모듈·설정 (부록, 소스 식별)

| 항목 | 값·설명 |
|------|---------|
| 서비스 ID | `com.SagoHub.ai-gas-leak-control` (`service.yaml`) |
| 모듈 | `gas_leak_control.GasLeakControlModule`, `gas_leak_plant.GasLeakPlantModule` |
| UI 서버 가스 누출 라우트 | `ui_server.py` 내 `if self.service_id == "com.SagoHub.ai-gas-leak-control"` 블록 |
| 서비스 설정 스키마 | `rule_threshold_percent`(기본 3.0), `ai_error_threshold_sec`(기본 3) — `service.yaml` `config` |

---

## 관련 문서

- **MinIO 업로드 저장 형식·자동 생성:** `docs/데이터업로드_MinIO_저장형식.md`
- **필드 정의표(기상대 예시와 동일 8열):** `docs/데이터스키마_AI가스누출_데이터포털형.md`
- **API·이벤트 상세:** `services/ai-gas-leak-control/README.md`

---

*본 문서는 위 근거 파일의 현재 내용에 맞추었으며, 브랜치·배포본에 따라 API·필드가 추가될 수 있습니다.*
