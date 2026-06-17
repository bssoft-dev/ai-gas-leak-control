# 자재 관리 서비스 (Equipment Traceability)

도면-자재-부품-설치위치 추적, 13대 필드 자재 관리, QR코드 연동을 위한 SagoHub 서비스입니다.

## 구성

- **서비스**: `com.SagoHub.equipment-traceability`
- **모듈**
  - `traceability_record.TraceabilityRecordModule`: 13대 필드 저장/조회/목록
  - `qr_traceability.QRTraceabilityModule`: QR 페이로드 생성/파싱

## 13대 필드

| 영문 키 | 한글 |
|--------|------|
| drawing_receipt_date | 도면접수일 |
| ship_no | 호선 |
| block | BLOCK |
| unit | UNIT |
| item | ITEM |
| pcs_no | PC's No |
| installation_location | 설치위치도 |
| paint_code | Paint Code |
| dwg_no | 도면번호(DWG No) |
| quantity | 수량 |
| list_weight | LIST 중량 |
| remarks | 비고 |
| revision_date_reason | 개정일/사유 |

## 기초데이터 (엑셀)

- **업로드 방식**: UI **목록 조회** 탭에서 **엑셀 파일 선택**으로 .xlsx 파일을 고른 뒤 **기초데이터 불러오기**를 누르면 업로드된 엑셀을 읽어 기존 데이터와 PCS No 기준으로 병합합니다.
- **고정 경로 (선택)**: 이벤트에 `excel_base64`가 없으면 `H8265 SKID 중량 check(전체 ).xlsx` 경로를 사용합니다. `records.json`이 없을 때 목록/조회 시 해당 파일이 있으면 자동 로드됩니다.
- 엑셀 1행은 헤더로 인식하며, 한글/영문 헤더를 13대 필드에 매핑합니다.
- API: `TRACEABILITY_IMPORT_EXCEL` 이벤트에 `payload.excel_base64`(base64 문자열), `payload.filename`(선택)을 넣어 임포트할 수 있습니다.

## 데이터 저장

- 자재 레코드는 `data/traceability/records.json`에 저장됩니다.
- `TRACEABILITY_DATA_DIR` 환경 변수로 저장 경로를 변경할 수 있습니다.

## 실행 방법

1. 코어(이벤트 버스) 실행: `./run-core.sh`
2. 모듈 실행 (각 터미널 또는 백그라운드):
   - `./modules/traceability_record/run.sh`
   - `./modules/qr_traceability/run.sh`
3. 서비스 로드: 대시보드에서 "로드" 후 "자재 관리" 서비스 시작
4. UI: 서비스 시작 후 해당 서비스 UI 포트(기본 26020) 또는 대시보드에서 위젯으로 접근

## 이벤트

- **발행**: `TRACEABILITY_RECORD_SAVE`, `TRACEABILITY_RECORD_QUERY`, `TRACEABILITY_RECORD_LIST`, `QR_CODE_GENERATE`, `QR_CODE_PARSE`
- **구독**: `TRACEABILITY_RECORD_SAVED`, `TRACEABILITY_RECORD_RESULT`, `TRACEABILITY_RECORD_LIST_RESULT`, `QR_CODE_PAYLOAD_READY`, `QR_CODE_PARSED`

## QR 페이로드 구조

- 버전 + PCS No + 설치위치 + 자재정보(material_info) + 도면번호 + ERP 링크 (구분자 `|`, URL 인코딩)
- 여기서 도면번호는 `DWG_no` 입니다. (QR 내부에서는 drawing_no로도 제공됩니다.)
- 자재정보(material_info)는 13대 필드를 “그룹 이름 없이” JSON 문자열로 담아서, 도면별로 해당 정보를 함께 전달합니다.
