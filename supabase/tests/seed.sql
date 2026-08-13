-- Deterministic fixtures for the operational test matrix. Fixed UUIDs so each
-- case file can address a row without a lookup, and so a failure names a
-- recognisable actor rather than a random id.

-- Kiara's real tenant id, matching `KIARA_RESTAURANT_ID` in src/lib/tenant.ts.
\set tenant '2ba8f6c8-aff9-4147-8f13-cdcb732de698'

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@kiara.test'),
  ('22222222-2222-2222-2222-222222222222', 'huda@kiara.test'),
  ('33333333-3333-3333-3333-333333333333', 'nora@kiara.test'),
  ('44444444-4444-4444-4444-444444444444', 'driver@kiara.test'),
  ('55555555-5555-5555-5555-555555555555', 'specialist@kiara.test'),
  ('66666666-6666-6666-6666-666666666666', 'outsider@kiara.test');

insert into public.profiles (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@kiara.test');

insert into public.restaurants (id, owner_id, name, name_ar)
values (:'tenant', '11111111-1111-1111-1111-111111111111', 'Kiara', 'كيارا');

-- A second tenant. Every isolation assertion is meaningless without one.
insert into public.profiles (id, email) values
  ('99999999-9999-9999-9999-999999999999', 'other@example.test');
insert into public.restaurants (id, owner_id, name)
values ('aaaaaaaa-0000-0000-0000-00000000000a',
        '99999999-9999-9999-9999-999999999999', 'Other Salon');

insert into public.team_members (id, restaurant_id, user_id, role, full_name) values
  ('a0000000-0000-0000-0000-000000000001', :'tenant',
   '11111111-1111-1111-1111-111111111111', 'admin', 'Hanan'),
  ('a0000000-0000-0000-0000-000000000002', :'tenant',
   '22222222-2222-2222-2222-222222222222', 'agent', 'Huda'),
  ('a0000000-0000-0000-0000-000000000003', :'tenant',
   '33333333-3333-3333-3333-333333333333', 'agent', 'Nora');

insert into public.specialists (id, restaurant_id, full_name, phone, nationality) values
  ('b0000000-0000-0000-0000-000000000001', :'tenant', 'Amal', '+966500000001', 'Philippines'),
  ('b0000000-0000-0000-0000-000000000002', :'tenant', 'Sara', '+966500000002', 'India');

insert into public.drivers (id, restaurant_id, full_name, phone) values
  ('c0000000-0000-0000-0000-000000000001', :'tenant', 'Khaled', '+966500000011'),
  ('c0000000-0000-0000-0000-000000000002', :'tenant', 'Majed', '+966500000012');

insert into public.conversations (id, restaurant_id, customer_phone, customer_name) values
  ('d0000000-0000-0000-0000-000000000001', :'tenant', '+966555000001', 'عميلة أولى'),
  ('d0000000-0000-0000-0000-000000000002', :'tenant', '+966555000002', 'عميلة ثانية');

insert into public.driver_orders (
  id, restaurant_id, conversation_id, specialist_id, driver_id,
  arrival_at, customer_location, customer_phone, duration_minutes, trip_type
) values
  ('e0000000-0000-0000-0000-000000000001', :'tenant',
   'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   now() + interval '3 hours', 'حي النرجس، الرياض', '+966555000001', 90, 'one_way'),
  ('e0000000-0000-0000-0000-000000000002', :'tenant',
   'd0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   now() + interval '5 hours', 'حي الملقا، الرياض', '+966555000002', 60, 'round_trip');

insert into public.field_staff_accounts (
  id, restaurant_id, auth_user_id, role, driver_id, specialist_id
) values
  ('f0000000-0000-0000-0000-000000000001', :'tenant',
   '44444444-4444-4444-4444-444444444444', 'driver',
   'c0000000-0000-0000-0000-000000000001', null),
  ('f0000000-0000-0000-0000-000000000002', :'tenant',
   '55555555-5555-5555-5555-555555555555', 'specialist',
   null, 'b0000000-0000-0000-0000-000000000001');
