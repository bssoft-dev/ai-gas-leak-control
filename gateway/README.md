## gateway: Supabase 기반 이벤트 메시지 허브

이 폴더는 SagoHub의 **이벤트 기반 마이크로서비스 오케스트레이터(허브)** 를 제공합니다.

### 핵심 목표

- **비동기 처리**: 프론트 요청을 즉시 응답하고, 모듈 호출/다음 스텝 진행은 백그라운드로 처리
- **데이터 무결성**: 단계 전이를 DB에서 검증(현재 스텝/상태 조건부 업데이트)
- **멱등성**: 동일 `task_id`/동일 스텝 콜백 중복 수신 시 안전하게 무시/재진행

### 구성

- `sql/schema.sql`: Supabase(SQL Editor)에서 실행할 테이블/인덱스 스키마
- `sql/seed_dangbae_from_service_yaml.sql`: `services/dangbae/service.yaml` 을 `modules` + `pipeline_flows` + `pipeline_broadcasts` 에 반영하는 시드(선택)
- `sql/migrate_pipeline_flows_v2.sql`: 예전 단일 `pipelines` 테이블 제거 후 v2 적용 시 사용
- `hub/app.py`: FastAPI 허브 서버
- `hub/settings.py`: 환경 변수 로딩/검증

### 실행

프로젝트 루트에서:

```bash
source venv/bin/activate
export $(grep -v '^#' .env | xargs)
uvicorn gateway.hub.app:app --host 0.0.0.0 --port 26100 --reload
```

필수 환경 변수:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (권장) 또는 `SUPABASE_ANON_KEY`
- `HUB_SUPABASE_SCHEMA` (기본값: `bs_message_hub`)

### Supabase 스키마 노출 (필수)

PostgREST는 **API에 노출된 스키마**만 접근할 수 있습니다. `HUB_SUPABASE_SCHEMA`(예: `bs_message_hub`)를 쓰려면 Supabase 프로젝트에서 해당 스키마를 **Exposed schemas**에 추가해야 합니다.

1. Supabase Dashboard → **Project Settings** → **Data API** (또는 **API**)  
2. **Exposed schemas** / **Additional schemas** 등에 `bs_message_hub` 추가 후 저장  
3. 허브 프로세스 재시작

그렇지 않으면 `PGRST106` / `The schema must be one of the following: ...` 오류가 납니다.

**임시 우회:** 이미 노출된 스키마(예: 목록에 있는 `public`, `bsm` 등)로 `HUB_SUPABASE_SCHEMA`를 바꾸고, 그 스키마 안에 `gateway/sql/schema.sql`에 맞춰 테이블을 생성하세요. (테이블/이름 충돌에 주의)

### `permission denied for schema bs_message_hub` (42501)

스키마는 있지만 **API가 쓰는 DB 역할**(`service_role` 등)에 스키마/테이블 권한이 없을 때 납니다.  
`gateway/sql/grants_bs_message_hub.sql` 을 SQL Editor에서 실행한 뒤 허브를 재시작하세요.

