-- Splitting a visit's services between two specialists.
--
-- The column is nullable and null keeps its old meaning ("whoever is on the
-- order"), so the guarantee worth testing is the opposite one: a service can
-- never end up owned by somebody who is not on the visit — neither by writing
-- it, nor by swapping the specialists afterwards. Either would drop the
-- service out of both messages, which is the one outcome a split must not have.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_order uuid := 'e0000000-0000-0000-0000-000000000001';
  v_amal uuid := 'b0000000-0000-0000-0000-000000000001';
  v_sara uuid := 'b0000000-0000-0000-0000-000000000002';
  v_first uuid;
  v_second uuid;
  v_assigned uuid;
  v_other uuid;
begin
  perform kiara_test.ok(
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'order_visit_services'
        and column_name = 'assigned_specialist_id' and is_nullable = 'YES'
    ),
    'order_visit_services carries a nullable assigned_specialist_id'
  );

  update public.driver_orders set second_specialist_id = v_sara where id = v_order;

  -- An unsplit visit: the existing shape, still accepted.
  insert into public.order_visit_services
    (restaurant_id, order_id, name, minutes, starts_at)
  values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', v_order, 'مانيكير', 40, now())
  returning id into v_first;
  select assigned_specialist_id into v_assigned
    from public.order_visit_services where id = v_first;
  perform kiara_test.ok(v_assigned is null, 'a service defaults to no assignee');

  -- Both specialists on the order may own a service.
  update public.order_visit_services set assigned_specialist_id = v_amal where id = v_first;
  insert into public.order_visit_services
    (restaurant_id, order_id, name, minutes, starts_at, assigned_specialist_id)
  values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698', v_order, 'مساج', 60, now(), v_sara)
  returning id into v_second;
  perform kiara_test.ok(
    (select count(*) from public.order_visit_services
      where order_id = v_order and assigned_specialist_id is not null) = 2,
    'each specialist on the visit can own her own services'
  );

  -- Someone who is not on this visit cannot be handed its work. The second
  -- order is Sara's alone, so Amal has no business on any of its services.
  insert into public.order_visit_services
    (restaurant_id, order_id, name, minutes, starts_at)
  values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698',
          'e0000000-0000-0000-0000-000000000002', 'باديكير', 30, now())
  returning id into v_other;
  perform kiara_test.raises(
    format(
      $q$update public.order_visit_services
           set assigned_specialist_id = 'b0000000-0000-0000-0000-000000000001'
         where id = %L$q$, v_other),
    'SERVICE_ASSIGNEE_NOT_ON_ORDER',
    'a specialist who is not on the order cannot be assigned its service'
  );
  perform kiara_test.raises(
    $q$insert into public.order_visit_services
         (restaurant_id, order_id, name, minutes, starts_at, assigned_specialist_id)
       values ('2ba8f6c8-aff9-4147-8f13-cdcb732de698',
               'e0000000-0000-0000-0000-000000000002', 'حنة', 20, now(),
               'b0000000-0000-0000-0000-000000000001')$q$,
    'SERVICE_ASSIGNEE_NOT_ON_ORDER',
    'nor can she be assigned one as the row is created'
  );

  -- Dropping the second specialist returns her services to the whole team
  -- rather than leaving them owned by someone who is no longer coming.
  update public.driver_orders set second_specialist_id = null where id = v_order;
  select assigned_specialist_id into v_assigned
    from public.order_visit_services where id = v_second;
  perform kiara_test.ok(
    v_assigned is null,
    'removing a specialist clears the services that were hers'
  );
  select assigned_specialist_id into v_assigned
    from public.order_visit_services where id = v_first;
  perform kiara_test.ok(
    v_assigned = v_amal,
    'the remaining specialist keeps her own assignments'
  );

  delete from public.order_visit_services where id in (v_first, v_second, v_other);
  update public.driver_orders set second_specialist_id = null where id = v_order;
end $$;
