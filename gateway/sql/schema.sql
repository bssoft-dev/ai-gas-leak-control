-- BS Message Hub (Supabase)
-- 서비스별 테이블 분리 전략: <service_name>_tasks
-- 예) code_gen_service_tasks, service_a_tasks 등
--
-- 주의:
-- - Supabase 프로젝트에서 uuid 확장/함수가 이미 활성화되어 있는 경우가 많습니다.
-- - 없다면: `create extension if not exists "uuid-ossp";`

create extension if not exists "uuid-ossp";
create schema if not exists bs_message_hub;

create or replace function bs_message_hub.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 이벤트 추적 테이블 (허브/모듈 이벤트 로그)
create table if not exists bs_message_hub.events (
  id uuid primary key default uuid_generate_v4(),
  event_id text unique not null,                    -- 외부 참조용 이벤트 ID
  service_id text not null,                         -- 서비스 식별자 (예: code_gen_service)
  source_id text not null,                          -- 이벤트 발행 주체 (hub, llm, git 등)
  session_id text,                                  -- 사용자/작업 세션 식별자
  task_id text,                                     -- 허브 task_id 연동 (선택)
  event_type text,                                  -- 이벤트 타입 (선택)
  payload jsonb not null default '{}'::jsonb,       -- 이벤트 본문
  metadata jsonb not null default '{}'::jsonb,      -- 부가 메타데이터
  timestamp timestamptz not null default now(),     -- 이벤트 발생 시각
  created_at timestamptz not null default now()     -- DB 적재 시각
);

create index if not exists idx_events_service_id on bs_message_hub.events(service_id);
create index if not exists idx_events_source_id on bs_message_hub.events(source_id);
create index if not exists idx_events_session_id on bs_message_hub.events(session_id);
create index if not exists idx_events_task_id on bs_message_hub.events(task_id);
create index if not exists idx_events_event_type on bs_message_hub.events(event_type);
create index if not exists idx_events_timestamp_desc on bs_message_hub.events(timestamp desc);

-- ---------------------------------------------------------------------------
-- 모듈 레지스트리 및 상태 (허브가 모듈로 전달할 대상 정의 + runtime state)
-- ---------------------------------------------------------------------------
create table if not exists bs_message_hub.modules (
  id uuid primary key default uuid_generate_v4(),
  module_key text not null unique,              -- 안정 식별자: map_service, order_manager, …
  display_name text,
  event_endpoint text,                           -- POST 대상 URL (예: http://llm_module:8000/event)
  state jsonb not null default '{}'::jsonb,      -- 모듈별 상태 스냅샷(버전, 큐 길이 등)
  status text not null default 'unknown',       -- active | disabled | error | unknown
  last_error jsonb,
  last_heartbeat_at timestamptz,
  version text,
  config jsonb not null default '{}'::jsonb,     -- 모듈 설정(타임아웃 등)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_modules_key on bs_message_hub.modules(module_key);
create index if not exists idx_modules_status on bs_message_hub.modules(status);

drop trigger if exists trg_modules_updated_at on bs_message_hub.modules;
create trigger trg_modules_updated_at
before update on bs_message_hub.modules
for each row
execute function bs_message_hub.set_updated_at();

-- ---------------------------------------------------------------------------
-- 파이프라인 (service.yaml 기준 2단 구조)
--
-- 1) pipeline_flows = pipelines[] 항목 하나 (id, trigger, aggregation, debounce)
-- 2) pipeline_broadcasts = broadcast[] 항목마다 한 행 (모듈 호출 · action_id · condition)
--
-- 기존 단일 `pipelines` 테이블은 제거됨 → migrate_pipeline_flows_v2.sql 참고
-- ---------------------------------------------------------------------------

create table if not exists bs_message_hub.pipeline_flows (
  id uuid primary key default uuid_generate_v4(),
  service_ref text not null,                     -- service.service.id (예: com.SagoHub.dangbae)
  flow_id text not null,                         -- pipelines[].id (예: flow_location_search)
  display_name text,
  trigger_event text not null,                   -- pipelines[].trigger.event
  debounce_ms int,                               -- pipelines[].debounce (밀리초, 없으면 null)
  aggregation jsonb not null default '{}'::jsonb, -- trigger.aggregation (strategy, target 등)
  enabled boolean not null default true,
  meta jsonb not null default '{}'::jsonb,       -- 소스 파일, 버전, 비고
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_ref, flow_id)
);

create index if not exists idx_pipeline_flows_service on bs_message_hub.pipeline_flows(service_ref);
create index if not exists idx_pipeline_flows_trigger on bs_message_hub.pipeline_flows(trigger_event);
create index if not exists idx_pipeline_flows_enabled on bs_message_hub.pipeline_flows(enabled);

drop trigger if exists trg_pipeline_flows_updated_at on bs_message_hub.pipeline_flows;
create trigger trg_pipeline_flows_updated_at
before update on bs_message_hub.pipeline_flows
for each row
execute function bs_message_hub.set_updated_at();

create table if not exists bs_message_hub.pipeline_broadcasts (
  id uuid primary key default uuid_generate_v4(),
  pipeline_flow_id uuid not null references bs_message_hub.pipeline_flows(id) on delete cascade,
  broadcast_order int not null check (broadcast_order >= 0),  -- broadcast[] 배열 순서
  module_id uuid not null references bs_message_hub.modules(id) on delete restrict,
  action_id text not null,                       -- broadcast[].id (예: action_search_location)
  module_class text,                             -- broadcast[].module (예: map_service.MapServiceModule)
  condition_expr text,                           -- broadcast[].condition (문자열 그대로, 선택)
  args_mapping jsonb not null default '{}'::jsonb, -- args 키 스냅샷(선택, 문서화용)
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_flow_id, broadcast_order)
);

create index if not exists idx_pipeline_broadcasts_flow on bs_message_hub.pipeline_broadcasts(pipeline_flow_id);
create index if not exists idx_pipeline_broadcasts_module on bs_message_hub.pipeline_broadcasts(module_id);

drop trigger if exists trg_pipeline_broadcasts_updated_at on bs_message_hub.pipeline_broadcasts;
create trigger trg_pipeline_broadcasts_updated_at
before update on bs_message_hub.pipeline_broadcasts
for each row
execute function bs_message_hub.set_updated_at();

-- 서비스별 작업 테이블 템플릿 (필요한 서비스마다 테이블명을 바꿔 생성)
-- 예: 아래 bs_message_hub.service_a_tasks를 복사해서 bs_message_hub.code_gen_service_tasks로 생성
create table if not exists bs_message_hub.service_a_tasks (
  id uuid primary key default uuid_generate_v4(),
  task_id text unique not null,             -- 외부 참조 ID
  current_step text not null,               -- 현재 실행 스텝(모듈명)
  status text not null,                     -- pending|processing|success|failed
  payload jsonb,                            -- 최초 입력
  last_input jsonb,                         -- 현재 스텝에 전달된 입력(스텝별 입력 추적)
  result_data jsonb,                        -- 최종 결과 (완료 시)
  error jsonb,                              -- 실패 시 에러 정보
  history jsonb not null default '[]'::jsonb, -- 스텝 이력 [{step,status,at,result,error}] (간단 추적)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_service_a_task_id on bs_message_hub.service_a_tasks(task_id);
create index if not exists idx_service_a_status on bs_message_hub.service_a_tasks(status);
create index if not exists idx_service_a_updated_at on bs_message_hub.service_a_tasks(updated_at desc);

drop trigger if exists trg_service_a_tasks_updated_at on bs_message_hub.service_a_tasks;
create trigger trg_service_a_tasks_updated_at
before update on bs_message_hub.service_a_tasks
for each row
execute function bs_message_hub.set_updated_at();
