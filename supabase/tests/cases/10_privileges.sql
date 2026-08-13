-- Matrix 15: `anon` and a normal `authenticated` user must not be able to read
-- or mutate the command, audit, outbox, location or Rekaz workflow tables, and
-- must not be able to execute any kiara_* command function.
--
-- These tables carry no RLS policies at all, so a surviving GRANT would be a
-- silent full-table leak through PostgREST rather than an empty result.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  v_table text;
  v_role text;
begin
  foreach v_table in array array[
    'command_receipts', 'operation_events', 'outbox_events',
    'field_location_checkpoints', 'rekaz_sync_runs', 'rekaz_reservations',
    'rekaz_changes', 'field_staff_accounts', 'field_order_progress',
    'field_staff_push_tokens'
  ] loop
    perform kiara_test.ok(
      (select relrowsecurity from pg_class
        where oid = ('public.' || v_table)::regclass),
      format('RLS enabled on public.%s', v_table)
    );

    foreach v_role in array array['anon', 'authenticated'] loop
      perform kiara_test.ok(
        not has_table_privilege(v_role, 'public.' || v_table, 'select')
          and not has_table_privilege(v_role, 'public.' || v_table, 'insert')
          and not has_table_privilege(v_role, 'public.' || v_table, 'update')
          and not has_table_privilege(v_role, 'public.' || v_table, 'delete'),
        format('%s has no table privilege on public.%s', v_role, v_table)
      );
    end loop;

    perform kiara_test.ok(
      has_table_privilege('service_role', 'public.' || v_table, 'select'),
      format('service_role can read public.%s', v_table)
    );
  end loop;
end
$$;

-- Command functions: execute must belong to service_role alone. PUBLIC holds
-- EXECUTE on new functions by default, so a missing REVOKE is the likely bug.
do $$
declare
  v_fn record;
  v_role text;
begin
  for v_fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'kiara_command_%'
        or p.proname in ('kiara_claim_outbox_event', 'kiara_apply_rekaz_snapshot'))
  loop
    foreach v_role in array array['anon', 'authenticated', 'public'] loop
      perform kiara_test.ok(
        not has_function_privilege(v_role, v_fn.sig, 'execute'),
        format('%s cannot execute %s', v_role, v_fn.proname)
      );
    end loop;
    perform kiara_test.ok(
      has_function_privilege('service_role', v_fn.sig, 'execute'),
      format('service_role can execute %s', v_fn.proname)
    );
  end loop;

  perform kiara_test.ok(
    (select count(*) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (p.proname like 'kiara_command_%'
          or p.proname in ('kiara_claim_outbox_event', 'kiara_apply_rekaz_snapshot'))
    ) = 6,
    'all six command functions exist'
  );
end
$$;

-- The private schema must not be reachable at all.
do $$
begin
  perform kiara_test.ok(
    not has_schema_privilege('anon', 'kiara_private', 'usage')
      and not has_schema_privilege('authenticated', 'kiara_private', 'usage'),
    'kiara_private is not usable by the API roles'
  );
end
$$;

-- An actual session acting as the API role, not just a catalogue lookup.
-- `set local` only takes effect inside a transaction block; at top level it is
-- silently a no-op and every assertion below would run as the superuser.
begin;
set local role authenticated;
do $$
begin
  perform kiara_test.raises(
    'select count(*) from public.operation_events',
    'permission denied',
    'authenticated session is refused operation_events'
  );
  perform kiara_test.raises(
    'select public.kiara_claim_outbox_event(
       ''2ba8f6c8-aff9-4147-8f13-cdcb732de698''::uuid,
       gen_random_uuid(), gen_random_uuid())',
    'permission denied',
    'authenticated session is refused the outbox claim command'
  );
end
$$;
commit;
