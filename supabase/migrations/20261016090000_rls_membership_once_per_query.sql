-- Check tenant membership once per query instead of once per row.
--
-- On 2026-10-15 the database went "unhealthy" under ordinary inbox traffic.
-- pg_stat_statements showed two PostgREST reads taking 67% of all database
-- time: every label assignment (269 ms mean) and every conversation (125 ms
-- mean), for a table of ~2,000 rows. The rows were cheap; the policies were
-- not. `is_restaurant_member(restaurant_id, uid)` is a SECURITY DEFINER SQL
-- function, which Postgres cannot inline, and it takes the row's restaurant as
-- an argument, so it ran its three lookups for every row the query touched —
-- and the label policy re-entered `conversations`, whose own policy ran it
-- again. Measured as an agent: 179 ms with the policy, 2 ms without.
--
-- The fix keeps the rules and changes their shape. The caller's restaurants are
-- computed once (an uncorrelated sub-select becomes an InitPlan / hashed
-- SubPlan), and each row is then a hash probe:
--
--   before:  is_restaurant_member(restaurant_id, auth.uid())     -- per row
--   after:   restaurant_id in (select kiara_rls.member_restaurant_ids())
--
-- Who may see or change what is unchanged: owner, active team member or super
-- admin for "member"; owner, active admin team member or super admin for
-- "admin". `supabase/tests/cases/102_rls_membership.sql` pins that, role by
-- role, against the policies this file replaces.
--
-- The functions live in their own schema so PostgREST does not expose them as
-- RPCs. Policies are evaluated as the calling role, so `anon` and
-- `authenticated` need EXECUTE; for them the sets are simply empty or their own.

create schema if not exists kiara_rls;
grant usage on schema kiara_rls to anon, authenticated, service_role;

create or replace function kiara_rls.member_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 2
as $$
  select r.id from public.restaurants r
   where r.owner_id = auth.uid()
  union
  select tm.restaurant_id from public.team_members tm
   where tm.user_id = auth.uid()
     and tm.is_active = true
  union
  select r.id from public.restaurants r
   where exists (
     select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.is_super_admin = true
   );
$$;

create or replace function kiara_rls.admin_restaurant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 2
as $$
  select r.id from public.restaurants r
   where r.owner_id = auth.uid()
  union
  select tm.restaurant_id from public.team_members tm
   where tm.user_id = auth.uid()
     and tm.is_active = true
     and tm.role = 'admin'
  union
  select r.id from public.restaurants r
   where exists (
     select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.is_super_admin = true
   );
$$;

revoke all on function kiara_rls.member_restaurant_ids() from public;
revoke all on function kiara_rls.admin_restaurant_ids() from public;
grant execute on function kiara_rls.member_restaurant_ids() to anon, authenticated, service_role;
grant execute on function kiara_rls.admin_restaurant_ids() to anon, authenticated, service_role;

-- conversations ------------------------------------------------------------
alter policy conversations_select_members on public.conversations
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy conversations_update_members on public.conversations
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()))
  with check (restaurant_id in (select kiara_rls.member_restaurant_ids()));

-- messages: was can_access_conversation(conversation_id, uid), one conversation
-- lookup plus a membership check per message.
alter policy messages_select_members on public.messages
  using (conversation_id in (
    select c.id from public.conversations c
     where c.restaurant_id in (select kiara_rls.member_restaurant_ids())
  ));

-- label assignments: was a correlated EXISTS into conversations per row.
alter policy cla_select on public.conversation_label_assignments
  using (conversation_id in (
    select c.id from public.conversations c
     where c.restaurant_id in (select kiara_rls.member_restaurant_ids())
  ));
alter policy cla_insert on public.conversation_label_assignments
  with check (conversation_id in (
    select c.id from public.conversations c
     where c.restaurant_id in (select kiara_rls.member_restaurant_ids())
  ));
alter policy cla_delete on public.conversation_label_assignments
  using (conversation_id in (
    select c.id from public.conversations c
     where c.restaurant_id in (select kiara_rls.member_restaurant_ids())
  ));

-- labels -------------------------------------------------------------------
alter policy conversation_labels_select on public.conversation_labels
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy conversation_labels_insert on public.conversation_labels
  with check (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy conversation_labels_update on public.conversation_labels
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()))
  with check (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy conversation_labels_delete on public.conversation_labels
  using (restaurant_id in (select kiara_rls.admin_restaurant_ids()));

-- field: orders, drivers, specialists -------------------------------------
alter policy driver_orders_select on public.driver_orders
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy driver_orders_insert on public.driver_orders
  with check (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy driver_orders_update on public.driver_orders
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()))
  with check (restaurant_id in (select kiara_rls.member_restaurant_ids()));

alter policy drivers_select on public.drivers
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy drivers_insert on public.drivers
  with check (restaurant_id in (select kiara_rls.admin_restaurant_ids()));
alter policy drivers_update on public.drivers
  using (restaurant_id in (select kiara_rls.admin_restaurant_ids()))
  with check (restaurant_id in (select kiara_rls.admin_restaurant_ids()));
alter policy drivers_delete on public.drivers
  using (restaurant_id in (select kiara_rls.admin_restaurant_ids()));

alter policy specialists_select on public.specialists
  using (restaurant_id in (select kiara_rls.member_restaurant_ids()));
alter policy specialists_insert on public.specialists
  with check (restaurant_id in (select kiara_rls.admin_restaurant_ids()));
alter policy specialists_update on public.specialists
  using (restaurant_id in (select kiara_rls.admin_restaurant_ids()))
  with check (restaurant_id in (select kiara_rls.admin_restaurant_ids()));
alter policy specialists_delete on public.specialists
  using (restaurant_id in (select kiara_rls.admin_restaurant_ids()));
