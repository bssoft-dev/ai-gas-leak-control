# AI 가스 누출 자동제어 시스템

작업장(가스 공급·용접/절단)에서 미세 가스 누출 및 비정상 상황을 실시간 감지하고, 밸브를 자동 차단하는 지능형 안전 관리 서비스입니다.

## 시스템 개요

- **핵심 기술**: LSTM-Autoencoder(비지도 학습) 기반 시계열 이상 탐지 AI
- **제어 방식**: Edge AI + Rule-base 하이브리드 자동 제어
- **목표**: 이상 탐지 정확도 95% 이상, 반응·제어 2초 이내

## 구성

| 구분 | 설명 |
|------|------|
| 서비스 ID | `com.SagoHub.ai-gas-leak-control` |
| 모듈 | `gas_leak_control.GasLeakControlModule`, `gas_leak_plant.GasLeakPlantModule` |
| 데이터 | `data/ai_gas_leak/` (state, sensors, timeseries, drawings, uploads/, points/) |

---

## UI에서 사용하는 API

프론트엔드(React) 대시보드는 아래 API를 사용합니다. 모두 **서비스 UI 서버**를 통해 제공되며, 이벤트는 **이벤트 버스**로 발행됩니다.

### 1. REST API (GET) — 상태·센서·시계열

UI 서버가 `data/ai_gas_leak/` 파일을 읽어 반환합니다. **코어는 수정하지 않고**, 서비스 전용 라우트만 `ui_server`에 추가되어 있습니다.

| API | 용도 | UI 사용처 |
|-----|------|-----------|
| `GET /api/gas-leak/state` | 구역(Zone 1~3) 상태, 밸브 차단 여부, 비상 차단 시각 | 디지털 트윈 맵, 밸브 상태 표시, Emergency STOP 버튼 활성/비활성 |
| `GET /api/gas-leak/sensors` | 센서 목록 및 현재값(유량·압력 등) | 실시간 센서 카드 그리드 |
| `GET /api/gas-leak/timeseries` | 압력·유량 시계열 `{ pressure: [], flow: [] }` | 실시간 압력/유량 차트 |
| `GET /api/gas-leak/drawings` | 공장 도면 목록 | 도면/센서 탭 목록 |
| `GET /api/gas-leak/drawings/{id}` | 도면 1건 + 센서(설치 위치) 목록 | 도면 선택 시 상세·센서 편집 |
| `GET /api/gas-leak/drawings/{id}/file` | 도면 이미지 파일 | 디지털 트윈 배경·센서 등록 시 맵 배경 |
| `GET /api/gas-leak/ai-history` | AI 판단 이력 목록 (최신순) | AI 판단 이력 탭 |

**MES 연동 (오탐지 방지)**  
| `POST /api/gas-leak/mes-status` | MES 설비 가동 신호 수신 | MES 서버 → `{ equipment_running: true|false, work_order_id?: string }` 전송 시 state 반영 |

- **state**  
  - `valve_closed`: 메인 밸브 차단 여부  
  - `zones`: 구역별 `id`, `name`, `status`(normal/warning/critical), 좌표 등  
  - `emergency_at`: 마지막 비상 차단 시각(ISO 8601)  
  - `alarm_beacon_on`, `alarm_siren_on`: 비상 경광등/사이렌 ON 여부  
  - `mes_equipment_running`: MES 설비 가동 신호 (true=Run, false=Stop, 오탐지 방지용)  
  - `mes_work_order_id`, `mes_updated_at`: MES 작업 지시 ID 및 갱신 시각  

- **sensors**  
  - 배열: `id`, `zone_id`, `label`, `value`, `unit`, `status`, `sensor_type`(pressure/flow/concentration)

- **timeseries**  
  - `pressure`, `flow`: 전역 시계열 `{ t: "ISO8601", v: number }[]`  
  - `sensors`: 센서별 시계열 `{ [sensor_id]: [{ t, v }] }` (압력·유량·**가스 농도** 포함, 최대 120점)

UI는 **2초 주기**로 위 세 API를 폴링하여 디지털 트윈·차트·센서 값을 갱신합니다.

### 2. 이벤트 발행 (POST) — 제어·조회

UI는 `POST /api/events/publish`로 이벤트를 보냅니다. 이벤트 버스가 수신 후 파이프라인에 따라 `GasLeakControlModule`로 전달합니다.

| 이벤트 타입 | 발행 시점 | payload 예시 | 모듈 동작 |
|-------------|-----------|--------------|-----------|
| `GAS_LEAK_EMERGENCY_STOP` | 사용자가 "Emergency STOP" 클릭 | `{ reason: "manual" }` | 밸브 차단, state에 `valve_closed: true`, `emergency_at` 기록 |
| `GAS_LEAK_VALVE_RESET` | 사용자가 "밸브 수동 해제" 클릭 | `{}` | 밸브 해제, state에 `valve_closed: false`, 구역 상태 normal로 복귀 |
| `GAS_LEAK_STATUS_QUERY` | (선택) 상태 조회 요청 | `{}` | 현재 state/sensors/timeseries를 `GAS_LEAK_STATUS_RESULT`로 응답 |
| `GAS_LEAK_DRAWING_UPLOAD` | 이미지 파일 업로드 | `{ name, filename, file_base64 }` | 도면 저장, `GAS_LEAK_DRAWING_UPLOADED` |
| `GAS_LEAK_DRAWING_LIST` | 도면 목록 요청 | `{}` | `GAS_LEAK_DRAWING_LIST_RESULT` |
| `GAS_LEAK_DRAWING_GET` | 도면 상세(센서 포함) | `{ drawing_id }` | `GAS_LEAK_DRAWING_GET_RESULT` |
| `GAS_LEAK_DRAWING_DELETE` | 도면 삭제 | `{ drawing_id }` | 파일·메타·포인트 삭제, `GAS_LEAK_DRAWING_DELETED` |
| `GAS_LEAK_SENSORS_SAVE` | 센서 위치 저장 | `{ drawing_id, sensors: [{ id, label, zone_id, x, y, unit, sensor_type }] }` | points 저장 + sensors.json 병합, `GAS_LEAK_SENSORS_SAVED` |
| `GAS_LEAK_MES_STATUS` | MES 설비 가동/작업 지시 | `{ equipment_running, work_order_id? }` | state에 mes_* 반영, 오탐지 방지 로직 사용 |
| `GAS_LEAK_ALARM_CONTROL` | 경광등/사이렌 제어 | `{ beacon_on?, siren_on? }` | state에 alarm_beacon_on, alarm_siren_on 반영 |
| `GAS_LEAK_CALL_MANAGER` | 관리자 호출 | `{}` | AI 판단 이력에 "관리자 호출" 기록 |

UI에서 **Emergency STOP**은 `onEmergencyStop` → `GAS_LEAK_EMERGENCY_STOP` 발행, **밸브 수동 해제**는 `onValveReset` → `GAS_LEAK_VALVE_RESET` 발행으로 연결됩니다.

### 3. SSE (실시간 결과 수신)

| 엔드포인트 | 용도 |
|------------|------|
| `GET /api/events/stream` | 이벤트 버스 SSE 프록시. UI는 `GAS_LEAK_EMERGENCY_STOP_RESULT`, `GAS_LEAK_VALVE_RESET_RESULT` 등을 구독해 토스트 메시지 표시 및 즉시 `GET /api/gas-leak/state` 재요청으로 화면 갱신 |

---

## 데이터 흐름 요약

1. **Edge/센서** → 1초 주기 데이터가 모듈 시뮬레이터 또는 실제 연동으로 `sensors.json`, `timeseries.json` 갱신  
2. **UI** → 2초마다 `GET /api/gas-leak/state`, `sensors`, `timeseries` 호출 → 디지털 트윈·차트·센서 카드 갱신  
3. **사용자 비상 차단** → `POST /api/events/publish` (`GAS_LEAK_EMERGENCY_STOP`) → 모듈이 state 갱신 → SSE로 결과 수신 → UI 갱신  
4. **사용자 밸브 해제** → `GAS_LEAK_VALVE_RESET` 발행 → 동일하게 모듈·SSE·UI 갱신  
5. **MES** → `POST /api/gas-leak/mes-status`로 설비 Run/Stop·작업지시 전송 → state 반영 → 비가동 중 가스 유입 시 "비가동 중 가스 유입 감지" 이력 기록 (오탐지 방지)  
6. **가스 농도 3% 이상** → Rule 기준 자동 비상 차단 + 경광등/사이렌 ON + 관리자 호출 이력  
7. **관리자 호출** → UI "Call Manager" 버튼 또는 누출 확정 시 자동으로 이력 기록  

---

### MES 연동 (오탐지 방지)

- MES 서버에서 설비 가동 신호(Run/Stop) 및 작업 지시 정보를 **POST /api/gas-leak/mes-status** 로 전달합니다.  
- payload: `{ "equipment_running": true|false, "work_order_id": "W001" }` (work_order_id 선택)  
- state에 `mes_equipment_running`, `mes_work_order_id`, `mes_updated_at`이 반영됩니다.  
- **오탐지 방지**: 비가동(`equipment_running: false`) 중에 유량·압력·가스 농도가 유의미하게 감지되면 "비가동 중 가스 유입 감지"로 AI 이력에 기록됩니다.  

### 경광등/사이렌

- 이상 감지·비상 차단 시 `alarm_beacon_on`, `alarm_siren_on`이 true로 설정됩니다.  
- 밸브 수동 해제 시 경광등/사이렌은 자동 해제됩니다.  
- UI "경광등/사이렌 해제" 버튼 또는 이벤트 `GAS_LEAK_ALARM_CONTROL` (payload: `{ beacon_on: false, siren_on: false }`)로 수동 해제 가능합니다.  

### 가스 농도 (Rule 3%)

- 센서 유형에 **가스 농도(concentration)** 가 있으며, 단위는 **%** 로 자동 설정됩니다.  
- **Rule-base**: 가스 농도가 **3% 이상**이면 즉시 비상 차단(밸브·경광등·사이렌) 및 관리자 호출 이력이 기록됩니다.  
- 시계열·센서 데이터에 압력(pressure), 유량(flow), **가스 농도(concentration)** 가 포함됩니다.  

### 관리자 호출 (Call Manager)

- 누출 감지·비상 차단 시 자동으로 "관리자 호출 요청됨"이 AI 판단 이력에 기록됩니다.  
- UI **"관리자 호출 (Call Manager)"** 버튼으로 수동 호출 시에도 이력에 "관리자 호출"이 기록됩니다.  

---

## 실행 방법

1. **코어(이벤트 버스)** 실행: `./run-core.sh`
2. **모듈** 실행:  
   `./modules/gas_leak_control/run.sh`  
   `./modules/gas_leak_plant/run.sh` (도면 업로드·센서 등록 시)
3. 대시보드에서 서비스 로드 후 **"AI 가스 누출 자동제어"** 서비스 시작
4. UI: 서비스 포트(기본 **26025**) 또는 대시보드 위젯으로 접속

---

## 설정 (service.yaml config)

- `rule_threshold_percent`: Rule 기준 가스 농도 임계값(%) — 이 값 이상 시 즉시 밸브 차단
- `ai_error_threshold_sec`: AI 오차율 임계 초과가 이 시간(초) 이상 지속 시 누출 확정(Critical)

---

## 파일 구조

```
services/ai-gas-leak-control/
├── service.yaml          # 서비스·인터페이스·파이프라인 정의
├── README.md             # 본 구현 설명서
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   └── components/
    │       └── GasLeakControlDashboard.jsx  # 디지털 트윈·차트·Emergency STOP
    └── vite.config.js

modules/gas_leak_control/
├── gas_leak_control.py    # 비상 차단/밸브 리셋/상태 조회, 시계열 시뮬레이터
└── run.sh

modules/gas_leak_plant/
├── gas_leak_plant.py      # 공장 도면 업로드·목록·조회·삭제, 센서 설치 위치 저장
└── run.sh

data/ai_gas_leak/
├── state.json             # 밸브·구역 상태
├── sensors.json           # 센서 현재값 (도면에서 등록한 센서와 병합)
├── timeseries.json        # 압력/유량 시계열
├── drawings.json          # 도면 메타 (id, name, file_path, file_type 등)
├── uploads/               # 도면 이미지 파일
└── points/                # { drawing_id }.json — 해당 도면의 센서 위치 (id, label, zone_id, x, y, unit, sensor_type)
```

### 도면·센서 등록 (디지털 트윈 2D 맵)

- **이미지 업로드**: 도면/센서 등록 탭에서 "이미지 파일 업로드"로 공장 배치도/도면 이미지(PNG, JPG 등) 업로드. `GAS_LEAK_DRAWING_UPLOAD` 이벤트로 전달되며 `GasLeakPlantModule`이 `data/ai_gas_leak/uploads/`에 저장하고 `drawings.json`에 등록.
- **도면 선택**: 목록에서 "선택" 시 해당 도면이 관제 맵 배경으로 사용되며, 같은 도면에서 센서 위치 등록 가능.
- **센서 등록**: 선택한 도면 위를 클릭하면 해당 위치(x, y 비율 0~1)에 센서 추가. 라벨·구역(Zone 1~3)·단위·유형(압력/유량) 입력 후 "추가" → "센서 위치 저장"으로 `GAS_LEAK_SENSORS_SAVE` 발행. `points/{drawing_id}.json`에 저장되고 `sensors.json`과 병합되어 실시간 값 갱신 대상이 됨.
- **관제 맵**: 관제 탭에서 선택된 도면이 있으면 해당 이미지를 배경으로 하고, 등록된 센서를 맵 위에 마커로 표시하며 현재값은 `GET /api/gas-leak/sensors`로 표시.
