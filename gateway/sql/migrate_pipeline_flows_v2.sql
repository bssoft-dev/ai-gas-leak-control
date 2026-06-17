-- 기존 단일 테이블 bs_message_hub.pipelines → pipeline_flows + pipeline_broadcasts 로 전환
-- 이미 v2 스키마만 있는 신규 프로젝트는 이 파일을 건너뛰어도 됩니다.

drop table if exists bs_message_hub.pipelines cascade;

-- 이후 gateway/sql/schema.sql 의 pipeline_flows / pipeline_broadcasts 블록 실행,
-- 또는 schema.sql 전체 재실행 후 seed_dangbae_from_service_yaml.sql
