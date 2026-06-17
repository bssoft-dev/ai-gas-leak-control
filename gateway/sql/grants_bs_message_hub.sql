-- bs_message_hub 스키마에 대한 Supabase 역할 권한
-- SQL Editor에서 postgres 권한으로 실행하세요.
-- (스키마/테이블 생성 후 실행 권장)

-- 스키마 사용
grant usage on schema bs_message_hub to service_role;
grant usage on schema bs_message_hub to authenticated;
grant usage on schema bs_message_hub to anon;

-- 기존 객체
grant all on all tables in schema bs_message_hub to service_role;
grant all on all sequences in schema bs_message_hub to service_role;
grant all on all functions in schema bs_message_hub to service_role;

-- 이후 생성되는 객체(기본 권한)
alter default privileges in schema bs_message_hub
  grant all on tables to service_role;
alter default privileges in schema bs_message_hub
  grant all on sequences to service_role;
alter default privileges in schema bs_message_hub
  grant all on functions to service_role;

-- anon/authenticated 는 RLS 정책에 맞게 조정 (필요 시만)
-- 예: 읽기만 허용
-- grant select on all tables in schema bs_message_hub to authenticated;
-- grant select on all tables in schema bs_message_hub to anon;
