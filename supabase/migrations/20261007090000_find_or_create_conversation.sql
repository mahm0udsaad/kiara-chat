-- Find a customer's thread, or create it, one caller at a time per number.
--
-- findOrCreateConversation looked for the number and inserted when it found
-- nothing. Two webhooks for the same customer in the same instant — she sends
-- "السلام عليكم" and her question in one second — both found nothing and both
-- inserted, and the team answered her in two threads that never met
-- (+966534522522 on 2026-10-07, with 17 other numbers split the same way).
--
-- A transaction-scoped advisory lock keyed on the number makes the second
-- caller wait for the first to commit, then find its row. Nothing existing is
-- changed: numbers already split stay split until they are merged separately,
-- and the lookup still returns the newest of them, as the app did before.

create or replace function public.find_or_create_conversation(
  p_restaurant_id uuid,
  p_customer_phone text,
  p_customer_name text default null,
  p_started_at timestamptz default null,
  p_metadata jsonb default null
)
returns table (id uuid, is_new boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_at timestamptz := coalesce(p_started_at, now());
begin
  if p_restaurant_id is null or nullif(btrim(p_customer_phone), '') is null then
    raise exception 'missing_arguments';
  end if;

  -- Held until this call's transaction ends, so a concurrent call for the
  -- same number waits here and then sees the row this one inserted.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_restaurant_id::text || ':' || p_customer_phone, 0)
  );

  select c.id into v_id
    from public.conversations c
   where c.restaurant_id = p_restaurant_id
     and c.customer_phone = p_customer_phone
   order by c.started_at desc
   limit 1;

  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  insert into public.conversations (
    restaurant_id, customer_phone, customer_name, status,
    started_at, last_message_at, last_inbound_at, metadata
  )
  values (
    p_restaurant_id, p_customer_phone, p_customer_name, 'active',
    v_at, v_at, null, coalesce(p_metadata, '{}'::jsonb)
  )
  returning conversations.id into v_id;

  return query select v_id, true;
end;
$$;

revoke all on function public.find_or_create_conversation(uuid, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.find_or_create_conversation(uuid, text, text, timestamptz, jsonb)
  to service_role;
