# AI 가스 누출 자동제어 — 데이터 스키마 (데이터포털 등록용)

기상대 환경데이터 예시와 동일하게 **8열**: 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고.

**소스 근거:** `modules/gas_leak_control/gas_leak_control.py`, `modules/gas_leak_plant/gas_leak_plant.py`, `src/SagoHub/service/ui_server.py` (가스 누출 서비스), `data/ai_gas_leak/` 샘플.

**항목명 규칙:** `state.json` 등 **파일 루트 기준** 점 표기. 배열은 `[]` 로 요소 필드를 표기.

---

## 1. 기본정보 (포털 단일 레코드 래퍼용, 예시 `base_informations` 대응)

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 기본정보 | `base_informations.description` | 데이터셋 구분 | string | - | `ai-gas-leak-prod` | 필수 | 테스트/운영 구분 |
| 기본정보 | `base_informations.base_id` | 레코드 고유 ID | string | - | `550e8400-e29b-41d4-a716-446655440000` | 선택 | 미전달 시 포털/수집기에서 발급 가능 |
| 기본정보 | `base_informations.service_id` | SagoHub 서비스 ID | string | - | `com.SagoHub.ai-gas-leak-control` | 선택 | `service.yaml` `service.id` |

---

## 2. 설비·제어 상태 (`state.json` 최상위 키)

`ui_server.get_gas_leak_state` 기본값과 파일 병합 필드. (`ui_server.py` 785~804행, `gas_leak_control` state 읽기/쓰기)

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 설비상태 | `valve_closed` | 메인 밸브 차단 여부 | boolean | - | `false` | 필수 | `true`면 시뮬레이터는 데이터 생성 스킵 |
| 설비상태 | `emergency_at` | 마지막 비상 차단 시각 | string | ISO8601 | `2026-04-29T00:58:38.723842Z` | 선택 | 없으면 `null` |
| 설비상태 | `last_control` | 최근 제어 코드 | string | - | `valve_reset` | 선택 | `emergency_stop`, `valve_reset`, `rule_concentration` 등 |
| 설비상태 | `zones` | 구역 객체 배열 | array | - | `[{...}]` | 선택 | 구조는 아래 `zones[]` |
| 설비상태 | `zones[].id` | 구역 ID | string | - | `zone1` | 선택 | |
| 설비상태 | `zones[].name` | 구역명 | string | - | `Zone 1` | 선택 | |
| 설비상태 | `zones[].status` | 구역 상태 | string | - | `normal` | 선택 | `normal` / `critical` 등 모듈이 갱신 |
| 설비상태 | `zones[].sensors` | 구역 소속 센서 ID | array | - | `["S1","S2"]` | 선택 | 문자열 배열 |
| 설비상태 | `zones[].x` | 맵 표시 X | number | - | `20` | 선택 | |
| 설비상태 | `zones[].y` | 맵 표시 Y | number | - | `30` | 선택 | |
| 설비상태 | `alarm_beacon_on` | 경광등 ON | boolean | - | `false` | 선택 | `_handle_alarm_control`·비상 시 갱신 |
| 설비상태 | `alarm_siren_on` | 사이렌 ON | boolean | - | `false` | 선택 | |
| 설비상태 | `mes_equipment_running` | MES 설비 가동 | boolean | - | `true` | 선택 | `_handle_mes_status`, 기본 `true` |
| 설비상태 | `mes_work_order_id` | 작업 지시 ID | string | - | `W001` | 선택 | `null` 가능 |
| 설비상태 | `mes_updated_at` | MES 반영 시각 | string | ISO8601 | `2026-04-26T20:12:48.772036Z` | 선택 | |

**확장 필드(파일에 존재할 수 있으나 본 브랜치 모듈이 필수로 채우지 않음):** `policy`, `risk_level`, `auto_shutdown_deadline` 등 — 배포본·수동 편집 시 문서화 후 포털 매핑.

---

## 3. MES 수신 API (`POST /api/gas-leak/mes-status` 요청 본문)

`ui_server.post_gas_leak_mes_status` → 이벤트 `GAS_LEAK_MES_STATUS` payload (`gas_leak_control._handle_mes_status`)

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| MES요청 | `equipment_running` | 설비 가동 여부 | boolean | - | `true` | 필수 | API JSON 키 |
| MES요청 | `work_order_id` | 작업 지시 ID | string | - | `W001` | 선택 | 키 `work_order`도 코드에서 허용 |

---

## 4. 센서 스냅샷 (`sensors.json` 배열 요소)

`gas_leak_plant._handle_sensors_save` 병합 결과·시뮬레이터 갱신. 신규 등록 시 `sensor_type`은 포인트에서 오며 `sensors.json` 신규 행에는 기본 필드 위주.

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 센서 | `sensors[].id` | 센서 ID | string | - | `S1` | 필수 | |
| 센서 | `sensors[].zone_id` | 구역 ID | string | - | `zone1` | 선택 | |
| 센서 | `sensors[].label` | 표시명 | string | - | `유량-1` | 선택 | |
| 센서 | `sensors[].value` | 현재값 | float | - | `12.41` | 선택 | 없으면 `null` 처리 가능 |
| 센서 | `sensors[].unit` | 단위 | string | - | `L/min` | 선택 | `pressure`→MPa, `concentration`→%, 그 외 L/min (`_unit_from_sensor_type`) |
| 센서 | `sensors[].status` | 상태 | string | - | `normal` | 선택 | |
| 센서 | `sensors[].sensor_type` | 유형 | string | - | `flow` | 선택 | `pressure`, `flow`, `concentration` 등 |

---

## 5. 시계열 (`timeseries.json`)

`MAX_SERIES_POINTS = 120` (`gas_leak_control.py`). 기본 키 `pressure`, `flow`, `sensors` (`_append_timeseries`, `_append_sensors_timeseries`).

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 시계열 | `pressure[].t` | 압력 시각 | string | ISO8601 | `2026-05-04T01:44:54.272369Z` | 선택 | |
| 시계열 | `pressure[].v` | 압력 값 | float | MPa | `0.3974` | 선택 | 값 없으면 `null` |
| 시계열 | `flow[].t` | 유량 시각 | string | ISO8601 | `2026-05-04T01:44:54.272369Z` | 선택 | |
| 시계열 | `flow[].v` | 유량 값 | float | L/min | `12.5` | 선택 | |
| 시계열 | `sensors.{sensor_id}[].t` | 센서별 시각 | string | ISO8601 | `2026-05-04T01:44:54.272369Z` | 선택 | 동적 키 `sensor_id` |
| 시계열 | `sensors.{sensor_id}[].v` | 센서별 값 | float | (센서 단위) | `1.2` | 선택 | 시리즈당 최대 120점 |

---

## 6. AI 판단 이력 (`ai_history.json` 배열 요소)

`_append_ai_history`, `MAX_AI_HISTORY = 500`. 유형은 모듈 로직에 따라 가변.

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 이력 | `ai_history[].at` | 시각 | string | ISO8601 | `2026-04-29T00:58:23.291984Z` | 필수 | |
| 이력 | `ai_history[].type` | 유형 | string | - | `call_manager` | 필수 | `emergency_stop`, `valve_reset`, `call_manager`, `anomaly_detected` 등 |
| 이력 | `ai_history[].message` | 메시지 | string | - | `관리자 호출` | 선택 | |
| 이력 | `ai_history[].reason` | 사유 | string | - | `manual` | 선택 | 비상 시 |
| 이력 | `ai_history[].zone_id` | 구역 | string | - | `zone1` | 선택 | `null` 가능 |
| 이력 | `ai_history[].sensor_id` | 관련 센서 ID | string | - | `S2` | 선택 | `anomaly_detected` 등 시뮬레이터 기록 |
| 이력 | `ai_history[].sensor_label` | 센서 라벨 | string | - | `압력-1` | 선택 | |
| 이력 | `ai_history[].value` | 측정값 | float | - | `0.46` | 선택 | |
| 이력 | `ai_history[].unit` | 단위 | string | - | `MPa` | 선택 | |

---

## 7. 도면 메타 (`drawings.json` 배열 요소)

`gas_leak_plant._handle_upload` 등.

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 도면 | `drawings[].id` | 도면 UUID | string | - | `17652c84-33e4-4e6c-9d84-292250488962` | 필수 | |
| 도면 | `drawings[].name` | 표시명 | string | - | `1층 배치도` | 선택 | |
| 도면 | `drawings[].filename` | 파일명 | string | - | `plan.png` | 선택 | |
| 도면 | `drawings[].file_type` | 유형 문자열 | string | - | `image` | 선택 | `_file_type_from_filename` |
| 도면 | `drawings[].file_path` | 상대 경로 | string | - | `uploads/uuid.png` | 선택 | `..` 포함 금지(삭제 로직) |
| 도면 | `drawings[].created_at` | 등록 시각 | string | ISO8601 | `2026-04-30T05:05:58.900258Z` | 선택 | |
| 도면 | `drawings[].updated_at` | 수정 시각 | string | ISO8601 | `2026-04-30T14:00:57.889473Z` | 선택 | |

---

## 8. 도면 포인트 (`points/{drawing_id}.json`)

**현재 `gas_leak_plant`:** `_save_points`는 **센서 객체의 JSON 배열**을 그대로 저장 (`_handle_sensors_save`의 `normalized` 리스트).

| 구분 | 항목명 | 항목설명 | 타입 | 단위 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|------|----------|------|
| 포인트 | `[].id` | 센서 ID | string | - | `S1777525583325` | 필수 | 배열 루트 |
| 포인트 | `[].label` | 라벨 | string | - | `유량-A` | 선택 | |
| 포인트 | `[].zone_id` | 구역 | string | - | `zone1` | 선택 | 기본값 저장 시 `zone1` |
| 포인트 | `[].x` | 도면 정규화 X | float | 0~1 | `0.923306` | 선택 | 0~1 클램프 |
| 포인트 | `[].y` | 도면 정규화 Y | float | 0~1 | `0.182471` | 선택 | |
| 포인트 | `[].unit` | 단위 | string | - | `L/min` | 선택 | |
| 포인트 | `[].sensor_type` | 유형 | string | - | `flow` | 선택 | 기본 `pressure` |

**`ui_server.get_gas_leak_drawing`:** `points` 파일이 **배열이 아니면** `sensors` 응답은 빈 배열(`[]`)로 처리됨 — 포털 수집 시 **배열 형식** 권장.

---

## 9. 제어 이력·일일 사용량 (선택 파일)

본 워크스페이스 **`gas_leak_control.py`에서 직접 쓰지 않음**이면, 파일이 있어도 선택 스키마로 등록.

| 구분 | 항목명 | 항목설명 | 타입 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|----------|------|
| 제어이력 | `control_history[].at` | 시각 | string | `2026-05-02T21:34:14.098634Z` | 선택 | 확장 배포 |
| 제어이력 | `control_history[].action` | 액션 코드 | string | `risk_level` | 선택 | |
| 제어이력 | `control_history[].detail` | 설명 | string | `가스 농도 단계 1` | 선택 | |
| 제어이력 | `control_history[].level` | 단계 | int | `1` | 선택 | |
| 일일사용량 | `daily_usage.date` | 일자 | string | `2026-05-04` | 선택 | |
| 일일사용량 | `daily_usage.cumulative_liters` | 누적 L | float | `1193.92` | 선택 | |

---

## 10. 이벤트 버스 연동 (제어·도면·MES)

`POST /api/events/publish` 본문은 이벤트 서버 `EventRequest`: **`type`**, **`payload`** (필수). 가스 누출 관련 타입 예는 `service.yaml` `interface.events`·`pipelines` 및 `README.md` 표 참고.

| 구분 | 항목명 | 항목설명 | 타입 | 예시 | 필수여부 | 비고 |
|------|--------|----------|------|------|----------|------|
| 이벤트 | `type` | 이벤트 타입 | string | `GAS_LEAK_EMERGENCY_STOP` | 필수 | |
| 이벤트 | `payload` | 페이로드 객체 | object | `{"reason":"manual"}` | 필수 | 빈 객체 `{}` 허용 |

---

## 관련 문서

- `docs/데이터포털_등록신청_데이터주요정보_AI가스누출.md`
- `services/ai-gas-leak-control/README.md`

---

*항목명·필수 여부는 포털 검증 규칙에 맞게 조정 가능합니다.*
