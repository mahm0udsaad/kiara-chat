-- Tenant-membership RLS after 20261016090000_rls_membership_once_per_query.
--
-- That migration changes how the policies on the inbox and field tables check
-- membership (once per query instead of once per row). It must not change who
-- sees what. So for every kind of caller this compares what the caller can now
-- read against what the *old* helpers — `is_restaurant_member`,
-- `can_access_conversation`, still installed — say they were allowed to read,
-- table by table, and then checks the write paths that differ by role.
--
-- Everything runs in one transaction and is rolled back: the grants below are
-- what production gives `anon`/`authenticated`, and later cases (10_privileges)
-- must not inherit them.

\set ON_ERROR_STOP on
set client_min_messages = notice;

\set tenant '2ba8f6c8-aff9-4147-8f13-cdcb732de698'
\set other  'aaaaaaaa-0000-0000-0000-00000000000a'

begin;

grant select, insert, update, delete on
  public.conversations, public.messages, public.conversation_labels,
  public.conversation_label_assignments, public.driver_orders,
  public.drivers, public.specialists
to anon, authenticated;

-- A super admin, and a second tenant with something in every table, so that
-- "sees nothing of the other salon" is a claim about real rows.
insert into auth.users (id, email)
values ('88888888-8888-4888-8888-888888888888', 'super@kiara.test');
insert into public.profiles (id, email, is_super_admin)
values ('88888888-8888-4888-8888-888888888888', 'super@kiara.test', true);

insert into public.conversations (id, restaurant_id, customer_phone) values
  ('d0000000-0000-0000-0000-0000000000f1', :'other', '+966555999001');
insert into public.messages (conversation_id, role, content) values
  ('d0000000-0000-0000-0000-000000000001', 'customer', 'مرحبا'),
  ('d0000000-0000-0000-0000-000000000001', 'agent', 'أهلاً'),
  ('d0000000-0000-0000-0000-000000000002', 'customer', 'سؤال'),
  ('d0000000-0000-0000-0000-0000000000f1', 'customer', 'other salon');
insert into public.conversation_labels (id, restaurant_id, name) values
  ('f1000000-0000-0000-0000-000000000001', :'tenant', 'VIP'),
  ('f1000000-0000-0000-0000-000000000002', :'tenant', 'متابعة'),
  ('f1000000-0000-0000-0000-0000000000f1', :'other', 'Other');
insert into public.conversation_label_assignments (conversation_id, label_id) values
  ('d0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002'),
  ('d0000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-0000000000f1');
insert into public.drivers (id, restaurant_id, full_name, phone) values
  ('c0000000-0000-0000-0000-0000000000f1', :'other', 'Other driver', '+966500000099');
insert into public.specialists (id, restaurant_id, full_name) values
  ('b0000000-0000-0000-0000-0000000000f1', :'other', 'Other specialist');

-- A deactivated employee keeps her row but must lose access.
update public.team_members set is_active = false
 where id = 'a0000000-0000-0000-0000-000000000003';

-- What the calling role can read now (RLS applies: called after SET ROLE).
create function kiara_test.rls_visible() returns jsonb language sql as $$
  select jsonb_build_object(
    'conversations', (select count(*) from public.conversations),
    'messages',      (select count(*) from public.messages),
    'labels',        (select count(*) from public.conversation_labels),
    'assignments',   (select count(*) from public.conversation_label_assignments),
    'driver_orders', (select count(*) from public.driver_orders),
    'drivers',       (select count(*) from public.drivers),
    'specialists',   (select count(*) from public.specialists)
  );
$$;

-- What the pre-migration policies allowed `p_user`, evaluated with the old
-- helpers as the superuser (which bypasses RLS and so sees every row).
create function kiara_test.rls_expected(p_user uuid) returns jsonb language sql as $$
  with owned as (select r.id from public.restaurants r where r.owner_id = p_user)
  select jsonb_build_object(
    'conversations', (select count(*) from public.conversations c
                       where public.is_restaurant_member(c.restaurant_id, p_user)
                          or c.restaurant_id in (select id from owned)),
    'messages',      (select count(*) from public.messages m
                       where public.can_access_conversation(m.conversation_id, p_user)
                          or m.conversation_id in (
                               select c.id from public.conversations c
                                where c.restaurant_id in (select id from owned))),
    'labels',        (select count(*) from public.conversation_labels l
                       where public.is_restaurant_member(l.restaurant_id, p_user)),
    'assignments',   (select count(*) from public.conversation_label_assignments a
                       where exists (select 1 from public.conversations c
                                      where c.id = a.conversation_id
                                        and public.is_restaurant_member(c.restaurant_id, p_user))),
    'driver_orders', (select count(*) from public.driver_orders o
                       where public.is_restaurant_member(o.restaurant_id, p_user)),
    'drivers',       (select count(*) from public.drivers d
                       where public.is_restaurant_member(d.restaurant_id, p_user)),
    'specialists',   (select count(*) from public.specialists s
                       where public.is_restaurant_member(s.restaurant_id, p_user))
  );
$$;

grant execute on function kiara_test.rls_visible() to anon, authenticated;

-- Runs the comparison for one caller. Role switching is done by the caller of
-- this function; it only reads the claim it was given.
create function kiara_test.rls_same_as_before(p_user uuid, p_role text, p_label text)
returns jsonb language plpgsql as $$
declare
  v_expected jsonb := kiara_test.rls_expected(p_user);
  v_visible jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute format('set local role %I', p_role);
  v_visible := kiara_test.rls_visible();
  reset role;
  perform kiara_test.ok(
    v_visible = v_expected,
    format('%s reads exactly what the old policies allowed (%s)', p_label, v_visible)
  );
  return v_visible;
end;
$$;

-- Each kind of caller, old rules vs new.
select kiara_test.rls_same_as_before('11111111-1111-1111-1111-111111111111', 'authenticated', 'owner/admin');
select kiara_test.rls_same_as_before('22222222-2222-2222-2222-222222222222', 'authenticated', 'agent');
select kiara_test.rls_same_as_before('33333333-3333-3333-3333-333333333333', 'authenticated', 'deactivated agent');
select kiara_test.rls_same_as_before('66666666-6666-6666-6666-666666666666', 'authenticated', 'outsider');
select kiara_test.rls_same_as_before('99999999-9999-9999-9999-999999999999', 'authenticated', 'other salon owner');
select kiara_test.rls_same_as_before('88888888-8888-4888-8888-888888888888', 'authenticated', 'super admin');
select kiara_test.rls_same_as_before(null, 'authenticated', 'signed-in role without a user');
select kiara_test.rls_same_as_before(null, 'anon', 'anon');

-- And the comparison is not vacuous: an agent really sees Kiara's rows and
-- none of the other salon's, and the deactivated agent sees nothing.
create function kiara_test.rls_tenant_rows(p_tenant uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'conversations', (select count(*) from public.conversations where restaurant_id = p_tenant),
    'messages',      (select count(*) from public.messages m join public.conversations c
                       on c.id = m.conversation_id where c.restaurant_id = p_tenant),
    'labels',        (select count(*) from public.conversation_labels where restaurant_id = p_tenant),
    'assignments',   (select count(*) from public.conversation_label_assignments a
                       join public.conversations c on c.id = a.conversation_id
                      where c.restaurant_id = p_tenant),
    'driver_orders', (select count(*) from public.driver_orders where restaurant_id = p_tenant),
    'drivers',       (select count(*) from public.drivers where restaurant_id = p_tenant),
    'specialists',   (select count(*) from public.specialists where restaurant_id = p_tenant)
  );
$$;
select kiara_test.ok(
  kiara_test.rls_same_as_before('22222222-2222-2222-2222-222222222222', 'authenticated', 'agent (again)')
    = kiara_test.rls_tenant_rows(:'tenant'),
  'agent sees every Kiara row and none of the other salon''s'
);
select kiara_test.ok(
  (select bool_and(value::int > 0) from jsonb_each_text(kiara_test.rls_tenant_rows(:'tenant'))),
  'Kiara has rows in every table checked, so the comparison is not over empty sets'
);
select kiara_test.ok(
  kiara_test.rls_same_as_before('33333333-3333-3333-3333-333333333333', 'authenticated', 'deactivated (again)')
    = '{"conversations":0,"messages":0,"labels":0,"assignments":0,"driver_orders":0,"drivers":0,"specialists":0}'::jsonb,
  'deactivated agent sees nothing'
);

-- Writes ---------------------------------------------------------------------

-- An agent may label a Kiara conversation.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
insert into public.conversation_label_assignments (conversation_id, label_id)
values ('d0000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001');
-- ...but not delete a label or edit a driver: both are admin-only.
with gone as (delete from public.conversation_labels
               where id = 'f1000000-0000-0000-0000-000000000002' returning 1),
     moved as (update public.drivers set full_name = 'x'
               where id = 'c0000000-0000-0000-0000-000000000001' returning 1)
select kiara_test.ok(
  (select count(*) from gone) = 0 and (select count(*) from moved) = 0,
  'agent cannot delete a label or edit a driver'
);
reset role;

select kiara_test.ok(
  exists (select 1 from public.conversation_label_assignments
           where conversation_id = 'd0000000-0000-0000-0000-000000000002'
             and label_id = 'f1000000-0000-0000-0000-000000000001'),
  'agent can label a Kiara conversation'
);

-- An outsider may not label anyone's conversation.
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
set local role authenticated;
select kiara_test.raises(
  $$insert into public.conversation_label_assignments (conversation_id, label_id)
    values ('d0000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002')$$,
  'row-level security',
  'outsider cannot label a Kiara conversation'
);
-- Nor move a Kiara driver order into view by rewriting its tenant.
with moved as (update public.driver_orders set restaurant_id = '66666666-6666-6666-6666-666666666666'
                returning 1)
select kiara_test.ok((select count(*) from moved) = 0, 'outsider cannot update driver orders');
reset role;

-- The admin may do both admin-only writes.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
set local role authenticated;
with gone as (delete from public.conversation_labels
               where id = 'f1000000-0000-0000-0000-000000000002' returning 1),
     moved as (update public.drivers set full_name = 'Khaled A.'
               where id = 'c0000000-0000-0000-0000-000000000001' returning 1)
select kiara_test.ok(
  (select count(*) from gone) = 1 and (select count(*) from moved) = 1,
  'admin can delete a label and edit a driver'
);
-- An agent cannot move a conversation to another salon (WITH CHECK).
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select kiara_test.raises(
  $$update public.conversations set restaurant_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
     where id = 'd0000000-0000-0000-0000-000000000001'$$,
  'row-level security',
  'agent cannot move a conversation to another salon'
);
reset role;

-- The policies really are evaluated once per query: no per-row helper left.
select kiara_test.ok(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('conversations', 'messages', 'conversation_labels',
                         'conversation_label_assignments', 'driver_orders',
                         'drivers', 'specialists')
       and coalesce(qual, '') || coalesce(with_check, '')
           ~ '(is_restaurant_member|is_restaurant_admin|can_access_conversation)'
  ),
  'no inbox or field policy calls a per-row membership helper'
);

rollback;
