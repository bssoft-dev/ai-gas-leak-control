# AI 엣지 컨트롤러 연동 명세서 (Edge API Specification)

이 문서는 서버(관제 환경)와 통신하기 위해 AI 엣지 컨트롤러(현장 단말) 측에서 구현해야 하는 양방향 통신 API 및 이벤트 발행 규격을 정의합니다.

## 1. 개요
* **서버 역할**: 엣지로부터 데이터(상태, 로그) 수집, UI 렌더링, 엣지로 제어 명령 하달
* **엣지 역할**: 현장 데이터 수집, AI 추론 및 즉시 밸브 제어, 상태/로그 서버로 전송, 서버의 제어 명령 수신

---

## 2. 엣지 -> 서버 (업스트림 이벤트 전송)

엣지 컨트롤러는 기동 시점 및 운영 중 특정 이벤트 발생 시, 메인 서버의 이벤트 버스(`POST {SERVER_EVENT_BUS_URL}/api/events/publish`)로 HTTP 요청을 보내야 합니다.

### 2.1. 엣지 IP 등록 (`GAS_LEAK_EDGE_REGISTER`)
엣지 프로그램이 켜질 때, 자신이 구동 중인 내부 API 서버의 IP와 Port를 서버에 등록합니다.
* **Method**: `POST /api/events/publish`
* **Body**:
```json
{
  "type": "GAS_LEAK_EDGE_REGISTER",
  "payload": {
    "edge_id": "edge-01",
    "ip": "192.168.0.100",
    "port": 26030
  }
}
```

### 2.2. 상태 동기화 (`GAS_LEAK_SYNC_STATE`)
엣지에서 수집한 최신 센서 값과 밸브 상태를 서버로 주기적(예: 1~2초)으로 동기화합니다.
* **Method**: `POST /api/events/publish`
* **Body**:
```json
{
  "type": "GAS_LEAK_SYNC_STATE",
  "payload": {
    "state": {
      "valve_closed": false,
      "alarm_beacon_on": false,
      "alarm_siren_on": false
    },
    "sensors": [
      { "id": "S1", "sensor_type": "pressure", "value": 0.40, "unit": "MPa" }
    ],
    "timeseries": {
      "pressure": [{"t": "2026-05-15T00:00:00Z", "v": 0.40}]
    }
  }
}
```

### 2.3. 로그(판단 이력) 동기화 (`GAS_LEAK_SYNC_LOG`)
AI 모델이 이상을 감지하거나 비상 차단이 발생할 경우, 해당 이력을 서버로 보냅니다.
* **Method**: `POST /api/events/publish`
* **Body**:
```json
{
  "type": "GAS_LEAK_SYNC_LOG",
  "payload": {
    "log": {
      "at": "2026-05-15T00:00:00Z",
      "type": "emergency_stop",
      "message": "AI 재구성 오차 증가 — 누출 확정 비상 차단"
    }
  }
}
```

---

## 3. 서버 -> 엣지 (다운스트림 API 수신)

서버(관제 UI)에서 사용자가 제어 버튼을 누르면, 서버는 앞서 등록된 엣지의 IP로 직접 HTTP POST 요청을 보냅니다. 
엣지 컨트롤러는 내부에 FastAPI(또는 Flask 등)를 띄워 **아래의 Endpoint를 구현**해야 합니다.

### 3.1. 비상 밸브 차단 (`POST /api/control/emergency-stop`)
* **요청**: `POST http://{EDGE_IP}:{EDGE_PORT}/api/control/emergency-stop`
* **동작**: 수신 즉시 하드웨어 밸브를 차단(Close)하고 경광등/사이렌을 켭니다.
* **응답**: `200 OK`

### 3.2. 밸브 수동 해제 (`POST /api/control/valve-reset`)
* **요청**: `POST http://{EDGE_IP}:{EDGE_PORT}/api/control/valve-reset`
* **동작**: 차단된 밸브를 개방(Open)하고 경광등/사이렌을 끕니다.
* **응답**: `200 OK`

### 3.3. 경광등/사이렌 수동 제어 (`POST /api/control/alarm`)
* **요청**: `POST http://{EDGE_IP}:{EDGE_PORT}/api/control/alarm`
* **Payload**: `{"beacon_on": true, "siren_on": false}`
* **동작**: 지정된 상태로 경광등/사이렌 릴레이를 제어합니다.

### 3.4. 정책/설정 변경 (`POST /api/control/policy-save`)
* **요청**: `POST http://{EDGE_IP}:{EDGE_PORT}/api/control/policy-save`
* **Payload**: `{"rule_threshold_percent": 3.0, "ai_error_threshold_sec": 5}`
* **동작**: 수신한 설정값으로 엣지 내부의 AI 판단 임계치를 런타임에 즉시 변경합니다.
