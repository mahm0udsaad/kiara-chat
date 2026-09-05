\set ON_ERROR_STOP on
begin;
create function pg_temp.service_preview(oid uuid, extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare result uuid;
begin
 insert into public.order_service_previews(restaurant_id,order_id,actor_user_id,expected_version,progress_snapshot,payload)
 select restaurant_id,id,'11111111-1111-1111-1111-111111111111',version,
 '{"started":null,"completed":null,"returned":null}',
 jsonb_build_object('name','مساج','minutes',30,'durationMinutes',duration_minutes+30,'startsAt',arrival_at+make_interval(mins=>duration_minutes),
 'oldEnd',arrival_at+make_interval(mins=>duration_minutes),'newEnd',arrival_at+make_interval(mins=>duration_minutes+30),
 'specialistTitle','تحديث الخدمات','driverTitle','تحديث الانتظار') || extra
 from public.driver_orders where id=oid returning id into result;
 return result;
end $$;
create function pg_temp.approve_service(oid uuid,pid uuid) returns jsonb language sql as $$
 select public.kiara_approve_service_change('2ba8f6c8-aff9-4147-8f13-cdcb732de698',oid,pid,
 '11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','admin','نص الأخصائية المعدّل','نص السائق المعدّل');
$$;
do $$
declare oid uuid; pid uuid; second_preview uuid; result jsonb; service_id uuid;
begin
 insert into public.driver_orders(restaurant_id,conversation_id,specialist_id,driver_id,arrival_at,customer_location,customer_phone,duration_minutes,status)
 values('2ba8f6c8-aff9-4147-8f13-cdcb732de698','d0000000-0000-0000-0000-000000000001',
 'b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','2035-01-01 12:00Z','الرياض','+966555000001',60,'sent') returning id into oid;
 pid:=pg_temp.service_preview(oid);
 second_preview:=pg_temp.service_preview(oid);
 result:=pg_temp.approve_service(oid,pid);
 perform kiara_test.ok(result->>'approved'='true','service approved');
 perform kiara_test.ok((select duration_minutes=90 and version=2 from public.driver_orders where id=oid),'duration and version updated together');
 perform kiara_test.ok((select count(*)=1 from public.order_visit_services where order_id=oid),'service recorded once');
 perform kiara_test.ok((select count(*)=2 from public.order_service_notifications where order_id=oid),'both notifications queued atomically');
 perform kiara_test.ok((select specialist_note='نص الأخصائية المعدّل' and driver_note='نص السائق المعدّل' from public.driver_orders where id=oid),'exact edited content stored in field app');
 result:=pg_temp.approve_service(oid,pid);
 perform kiara_test.ok(result->>'replayed'='true','approval retry replays');
 perform kiara_test.ok((select duration_minutes=90 from public.driver_orders where id=oid),'retry never extends twice');
 perform kiara_test.ok((select count(*)=2 from public.order_service_notifications where order_id=oid),'retry never queues duplicates');
 perform kiara_test.raises(format('select pg_temp.approve_service(%L,%L)',oid,second_preview),'ORDER_VERSION_CONFLICT','stale preview refused');
 pid:=pg_temp.service_preview(oid);
 update public.order_service_previews set expires_at=now()-interval '1 minute' where id=pid;
 perform kiara_test.raises(format('select pg_temp.approve_service(%L,%L)',oid,pid),'ORDER_VERSION_CONFLICT','expired preview refused');
 pid:=pg_temp.service_preview(oid,jsonb_build_object('sourceId','absent','sourceHash','x'));
 perform kiara_test.raises(format('select pg_temp.approve_service(%L,%L)',oid,pid),'REKAZ_CHANGED','missing source rejected');
 perform kiara_test.ok((select count(*)=1 from public.order_visit_services where order_id=oid),'failed approval rolls back');
 select id into service_id from public.order_visit_services where order_id=oid;
 pid:=pg_temp.service_preview(oid,jsonb_build_object('serviceId',service_id,'minutes',45,'durationMinutes',105));
 perform pg_temp.approve_service(oid,pid);
 perform kiara_test.ok((select duration_minutes=105 from public.driver_orders where id=oid),'editing service applies only duration delta');
 perform kiara_test.ok((select count(*)=1 from public.order_visit_services where order_id=oid),'editing does not add second service');
 insert into public.rekaz_reservations(restaurant_id,source_id,payload_hash,arrival_at,customer_phone,status,payload)
 values('2ba8f6c8-aff9-4147-8f13-cdcb732de698','service-new','hash1','2035-01-01 13:00Z','+966555000001','Confirmed',
 '{"service":"مساج","durationMinutes":45}');
 pid:=pg_temp.service_preview(oid,jsonb_build_object('sourceId','service-new','sourceHash','hash1','serviceId',service_id,'minutes',45,'durationMinutes',105));
 perform pg_temp.approve_service(oid,pid);
 perform kiara_test.ok((select duration_minutes=105 from public.driver_orders where id=oid),'reconciliation never adds waiting twice');
 perform kiara_test.ok((select source_id='service-new' from public.order_visit_services where id=service_id),'manual service linked to later Rekaz entry');
 pid:=pg_temp.service_preview(oid,jsonb_build_object('sourceId','service-new','sourceHash','hash1','serviceId',service_id));
 update public.rekaz_reservations set payload_hash='hash2' where source_id='service-new';
 perform kiara_test.raises(format('select pg_temp.approve_service(%L,%L)',oid,pid),'REKAZ_CHANGED','source changing after preview prevents approval');
 perform kiara_test.raises($q$insert into public.driver_orders(restaurant_id,conversation_id,arrival_at,customer_location,customer_phone,duration_minutes,rekaz_source_id)
 values('2ba8f6c8-aff9-4147-8f13-cdcb732de698','d0000000-0000-0000-0000-000000000001','2035-01-01 13:00Z','الرياض','+966555000001',45,'service-new')$q$,
 'RESERVATION_ALREADY_LINKED','linked addition cannot create a second driver order');
 pid:=pg_temp.service_preview(oid);
 insert into public.field_order_progress(order_id,restaurant_id,driver_confirmed_at,specialist_pickup_at,service_started_at,completed_at)
 values(oid,'2ba8f6c8-aff9-4147-8f13-cdcb732de698',now(),now(),now(),now());
 perform kiara_test.raises(format('select pg_temp.approve_service(%L,%L)',oid,pid),'FIELD_VERSION_CONFLICT','completed visit cannot be extended');
 perform kiara_test.ok(not has_table_privilege('authenticated','public.order_service_previews','INSERT'),'clients cannot forge previews');
 perform kiara_test.ok(not has_function_privilege('anon','public.kiara_approve_service_change(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),'anonymous approval denied');
 perform kiara_test.ok(not has_function_privilege('authenticated','public.kiara_approve_service_change(uuid,uuid,uuid,uuid,uuid,text,text,text)','EXECUTE'),'approval requires authorized server');
end $$;
rollback;
