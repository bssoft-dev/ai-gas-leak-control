-- 당배 서비스 파이프라인 시드 (pipeline_flows + pipeline_broadcasts)
-- 원본: services/dangbae/service.yaml
--
-- 선행: gateway/sql/schema.sql, grants_bs_message_hub.sql

insert into bs_message_hub.modules (module_key, display_name)
values
  ('map_service', 'map_service.MapServiceModule'),
  ('vlm_package_image_estimator', 'vlm_package_image_estimator.VLMPackageImageEstimatorModule'),
  ('llm_item_estimator', 'llm_item_estimator.LLMItemEstimatorModule'),
  ('web_scraper', 'web_scraper.WebScraperModule'),
  ('alttul_fare', 'alttul_fare.AlttulFareModule'),
  ('order_manager', 'order_manager.OrderManagerModule'),
  ('supabase', 'supabase.SupabaseModule'),
  ('kakao_alarm', 'kakao_alarm.KakaoAlarmModule'),
  ('dangbae_admin', 'dangbae_admin.DangbaeAdminModule'),
  ('driver_assignment', 'driver_assignment.DriverAssignmentModule'),
  ('mailer', 'mailer.MailerModule')
on conflict (module_key) do update
  set display_name = excluded.display_name;

insert into bs_message_hub.pipeline_flows (
  service_ref,
  flow_id,
  display_name,
  trigger_event,
  debounce_ms,
  aggregation,
  meta
)
values
  ('com.SagoHub.dangbae', 'flow_location_search', '위치 검색', 'LOCATION_SEARCH', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_get_my_location', '현재 위치 조회', 'GET_MY_LOCATION', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_route_calculate', '경로 및 거리 계산', 'ROUTE_CALCULATE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_image_analyze', '이미지 분석 및 물품 추론 (VLM)', 'IMAGE_ANALYZE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_item_estimate', '물품 설명 기반 크기·무게 추정', 'ITEM_DESCRIPTION_ESTIMATE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_web_scrape', '웹 크롤링', 'WEB_SCRAPE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_fare_calculate', '알뜰 배송비 견적', 'FARE_CALCULATE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_delivery_request', '배송 요청 접수 및 주문 생성', 'ORDER_CREATE', 300, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_order_save_supabase', '주문 Supabase 저장', 'DANGBAE_ORDER_CREATED', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_kakao_order_created', '카카오 알림 - 신규 배송 등록', 'DANGBAE_ORDER_CREATED', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_my_orders_query', '내 배송 현황 조회', 'ORDER_QUERY', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_admin_auth', '관리자 인증', 'ADMIN_AUTH', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_admin_driver_list', '관리자 배송원 목록', 'ADMIN_DRIVER_LIST', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_admin_driver_save', '관리자 배송원 저장', 'ADMIN_DRIVER_SAVE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_admin_driver_delete', '관리자 배송원 삭제', 'ADMIN_DRIVER_DELETE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_admin_save_kakao_code', '카카오 인증 코드 저장', 'ADMIN_SAVE_KAKAO_CODE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_order_update', '주문 업데이트', 'ORDER_UPDATE', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_kakao_driver_assigned', '카카오 알림 - 배송 할당', 'DANGBAE_DRIVER_ASSIGNED', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_order_accepted', '배송원 수락 및 배정', 'DANGBAE_ORDER_ACCEPTED', 300, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_kakao_delivery_confirmed', '카카오 알림 - 배송 완료', 'DANGBAE_DELIVERY_CONFIRMED', null, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_pickup_done', '픽업 완료 처리', 'DANGBAE_PICKUP_DONE', 300, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb),
  ('com.SagoHub.dangbae', 'flow_delivery_done', '배송 완료 처리', 'DANGBAE_DELIVERY_DONE', 300, '{"strategy":"INDEPENDENT","target":null}'::jsonb, '{"source":"services/dangbae/service.yaml"}'::jsonb)
on conflict (service_ref, flow_id) do update
  set
    display_name = excluded.display_name,
    trigger_event = excluded.trigger_event,
    debounce_ms = excluded.debounce_ms,
    aggregation = excluded.aggregation,
    meta = excluded.meta,
    updated_at = now();

-- broadcast[] 한 줄씩 → pipeline_broadcasts
insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_search_location', 'map_service.MapServiceModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'map_service'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_location_search'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_get_location', 'map_service.MapServiceModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'map_service'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_get_my_location'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_route_calculate', 'map_service.MapServiceModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'map_service'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_route_calculate'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_vlm_analyze_image', 'vlm_package_image_estimator.VLMPackageImageEstimatorModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'vlm_package_image_estimator'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_image_analyze'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_estimate_item', 'llm_item_estimator.LLMItemEstimatorModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'llm_item_estimator'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_item_estimate'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_scrape', 'web_scraper.WebScraperModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'web_scraper'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_web_scrape'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_alttul_fare', 'alttul_fare.AlttulFareModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'alttul_fare'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_fare_calculate'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_create_order', 'order_manager.OrderManagerModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'order_manager'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_delivery_request'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_save_order', 'supabase.SupabaseModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'supabase'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_order_save_supabase'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_kakao_new_order', 'kakao_alarm.KakaoAlarmModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'kakao_alarm'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_kakao_order_created'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_query_my_orders', 'order_manager.OrderManagerModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'order_manager'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_my_orders_query'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_admin_auth', 'dangbae_admin.DangbaeAdminModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'dangbae_admin'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_admin_auth'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_driver_list', 'dangbae_admin.DangbaeAdminModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'dangbae_admin'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_admin_driver_list'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_driver_save', 'dangbae_admin.DangbaeAdminModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'dangbae_admin'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_admin_driver_save'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_driver_delete', 'dangbae_admin.DangbaeAdminModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'dangbae_admin'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_admin_driver_delete'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_save_kakao_code', 'dangbae_admin.DangbaeAdminModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'dangbae_admin'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_admin_save_kakao_code'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_order_update', 'order_manager.OrderManagerModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'order_manager'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_order_update'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_kakao_driver_assigned', 'kakao_alarm.KakaoAlarmModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'kakao_alarm'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_kakao_driver_assigned'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_assign_driver', 'driver_assignment.DriverAssignmentModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'driver_assignment'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_order_accepted'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_kakao_delivery_confirmed', 'kakao_alarm.KakaoAlarmModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'kakao_alarm'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_kakao_delivery_confirmed'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_update_pickup', 'order_manager.OrderManagerModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'order_manager'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_pickup_done'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 0, m.id, 'action_update_delivery', 'order_manager.OrderManagerModule', null
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'order_manager'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_delivery_done'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();

insert into bs_message_hub.pipeline_broadcasts (pipeline_flow_id, broadcast_order, module_id, action_id, module_class, condition_expr)
select f.id, 1, m.id, 'action_send_delivery_notification', 'mailer.MailerModule', $c$${event.user_email} != ''$c$
from bs_message_hub.pipeline_flows f join bs_message_hub.modules m on m.module_key = 'mailer'
where f.service_ref = 'com.SagoHub.dangbae' and f.flow_id = 'flow_delivery_done'
on conflict (pipeline_flow_id, broadcast_order) do update
  set module_id = excluded.module_id, action_id = excluded.action_id, module_class = excluded.module_class, condition_expr = excluded.condition_expr, updated_at = now();
