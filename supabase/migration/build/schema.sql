--
-- PostgreSQL database dump
--

\restrict 4cOa3fMr0LWSwDpqIii7NOpVUTo6zIaWfrhIyfQzg1mGWYth70tkkYyag0pBDVo

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: kiara_private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS kiara_private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: call_kiara_endpoint(text, text); Type: FUNCTION; Schema: kiara_private; Owner: -
--

CREATE FUNCTION kiara_private.call_kiara_endpoint(path text, method text DEFAULT 'GET'::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  base_url text := kiara_private.get_secret('kiara_cron_base_url');
  secret   text := kiara_private.get_secret('kiara_cron_secret');
  req_id   bigint;
  hdrs     jsonb;
begin
  if base_url is null or secret is null then
    raise warning '[kiara_cron] kiara_cron_base_url or kiara_cron_secret not set in vault — skipping %', path;
    return null;
  end if;

  hdrs := jsonb_build_object(
    'Authorization', 'Bearer ' || secret,
    'x-cron-secret', secret,
    'Content-Type',  'application/json'
  );

  if upper(method) = 'GET' then
    select net.http_get(
      url := base_url || path,
      headers := hdrs,
      timeout_milliseconds := 30000
    ) into req_id;
  else
    select net.http_post(
      url := base_url || path,
      body := '{}'::jsonb,
      headers := hdrs,
      timeout_milliseconds := 30000
    ) into req_id;
  end if;

  return req_id;
end;
$$;


--
-- Name: enqueue_field_reminders(); Type: FUNCTION; Schema: kiara_private; Owner: -
--

CREATE FUNCTION kiara_private.enqueue_field_reminders() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
declare
  push_messages jsonb;
  reminded_order_ids uuid[];
  message_count integer := 0;
begin
  with due_orders as (
    select
      progress.order_id,
      progress.restaurant_id,
      progress.last_activity_at,
      orders.specialist_id,
      orders.driver_id,
      case
        when progress.driver_confirmed_at is null then 'driver'
        when progress.completed_at is null then 'specialist'
        else 'driver'
      end as target_role,
      case
        when progress.driver_confirmed_at is null then 'تأكيد الرحلة والانطلاق'
        when progress.specialist_pickup_at is null then 'ركوب الأخصائية مع السائق'
        when progress.service_started_at is null then 'بدء الخدمة عند العميلة'
        when progress.completed_at is null then 'إنهاء الخدمة والمغادرة'
        else 'إنهاء الرحلة والعودة'
      end as action_label
    from public.field_order_progress as progress
    inner join public.driver_orders as orders
      on orders.id = progress.order_id
     and orders.restaurant_id = progress.restaurant_id
    where progress.driver_returned_at is null
      and progress.last_activity_at <= now() - interval '30 minutes'
      and (
        progress.last_reminder_at is null
        or progress.last_reminder_at <= now() - interval '30 minutes'
      )
    order by progress.last_activity_at
    limit 100
  ),
  recipient_accounts as (
    select
      due.order_id,
      due.last_activity_at,
      due.action_label,
      accounts.id as account_id
    from due_orders as due
    inner join public.field_staff_accounts as accounts
      on accounts.restaurant_id = due.restaurant_id
     and accounts.role = due.target_role
     and accounts.is_active = true
     and (
       (due.target_role = 'driver' and accounts.driver_id = due.driver_id)
       or
       (due.target_role = 'specialist' and accounts.specialist_id = due.specialist_id)
     )
    where
      (
        due.target_role = 'driver'
        and exists (
          select 1
          from public.drivers as drivers
          where drivers.id = due.driver_id
            and drivers.restaurant_id = due.restaurant_id
            and drivers.is_active = true
        )
      )
      or
      (
        due.target_role = 'specialist'
        and exists (
          select 1
          from public.specialists as specialists
          where specialists.id = due.specialist_id
            and specialists.restaurant_id = due.restaurant_id
            and specialists.is_active = true
        )
      )
  ),
  message_rows as (
    select
      recipients.order_id,
      recipients.last_activity_at,
      tokens.expo_token,
      recipients.action_label
    from recipient_accounts as recipients
    inner join public.field_staff_push_tokens as tokens
      on tokens.field_staff_account_id = recipients.account_id
     and tokens.disabled = false
    order by recipients.last_activity_at
    limit 100
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'to', messages.expo_token,
        'title', 'تذكير بالخطوة المطلوبة',
        'body', messages.action_label,
        'sound', 'default',
        'priority', 'high',
        'data', jsonb_build_object(
          'type', 'field_order',
          'orderId', messages.order_id::text,
          'url', '/field/orders/' || messages.order_id::text
        )
      )
    ),
    array_agg(distinct messages.order_id),
    count(*)::integer
  into push_messages, reminded_order_ids, message_count
  from message_rows as messages;

  if message_count = 0 then
    return 0;
  end if;

  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object(
      'Accept', 'application/json',
      'Content-Type', 'application/json'
    ),
    body := push_messages,
    timeout_milliseconds := 10000
  );

  update public.field_order_progress
  set last_reminder_at = now()
  where order_id = any(reminded_order_ids);

  return message_count;
end;
$$;


--
-- Name: get_secret(text); Type: FUNCTION; Schema: kiara_private; Owner: -
--

CREATE FUNCTION kiara_private.get_secret(name text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'vault', 'public'
    AS $_$
  select decrypted_secret
  from vault.decrypted_secrets
  where vault.decrypted_secrets.name = $1
    and $1 like 'kiara\_%'
  limit 1;
$_$;


--
-- Name: tg_touch_field_workflow_updated_at(); Type: FUNCTION; Schema: kiara_private; Owner: -
--

CREATE FUNCTION kiara_private.tg_touch_field_workflow_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: tg_touch_operational_updated_at(); Type: FUNCTION; Schema: kiara_private; Owner: -
--

CREATE FUNCTION kiara_private.tg_touch_operational_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: agent_performance_detail(uuid, uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.agent_performance_detail(p_restaurant_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_daily   jsonb;
  v_heatmap jsonb;
begin
  if not public.is_restaurant_admin(p_restaurant_id, auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with agent_msgs as (
    select m.conversation_id, m.created_at
      from messages m
      join conversations c on c.id = m.conversation_id
     where c.restaurant_id = p_restaurant_id
       and m.sender_team_member_id = p_team_member_id
       and m.role = 'agent'
       and m.created_at >= p_from
       and m.created_at <  p_to
  ),
  reply_latencies as (
    select extract(epoch from (m.created_at - prev.created_at))::int as latency_sec,
           date_trunc('day', m.created_at) as day
      from messages m
      join conversations c on c.id = m.conversation_id
      join lateral (
        select p.role, p.created_at
          from messages p
         where p.conversation_id = m.conversation_id
           and p.created_at < m.created_at
         order by p.created_at desc
         limit 1
      ) prev on true
     where c.restaurant_id = p_restaurant_id
       and m.sender_team_member_id = p_team_member_id
       and m.role = 'agent'
       and m.created_at >= p_from
       and m.created_at <  p_to
       and prev.role = 'customer'
  )
  select jsonb_agg(r)
    into v_daily
    from (
      select
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
        count(*)::int as messages,
        count(distinct conversation_id)::int as conversations,
        coalesce((
          select percentile_cont(0.5) within group (order by latency_sec)
            from reply_latencies
           where day = date_trunc('day', am.created_at)
        )::int, 0) as p50_reply_sec
      from agent_msgs am
      group by date_trunc('day', am.created_at)
      order by 1
    ) r;

  with agent_msgs as (
    select m.created_at
      from messages m
      join conversations c on c.id = m.conversation_id
     where c.restaurant_id = p_restaurant_id
       and m.sender_team_member_id = p_team_member_id
       and m.role = 'agent'
       and m.created_at >= p_from
       and m.created_at <  p_to
  )
  select jsonb_agg(r)
    into v_heatmap
    from (
      select extract(dow  from created_at)::int as weekday,
             extract(hour from created_at)::int as hour,
             count(*)::int as messages
        from agent_msgs
       group by 1, 2
       order by 1, 2
    ) r;

  return jsonb_build_object(
    'daily',   coalesce(v_daily,   '[]'::jsonb),
    'heatmap', coalesce(v_heatmap, '[]'::jsonb)
  );
end;
$$;


--
-- Name: assign_agent_instruction_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_agent_instruction_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_next integer;
begin
  if new.restaurant_id is null then
    raise exception 'agent_instructions.restaurant_id cannot be null';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('agent_instructions_version', 0),
    hashtextextended(new.restaurant_id::text, 0)
  );
  select coalesce(max(version), 0) + 1 into v_next
    from public.agent_instructions where restaurant_id = new.restaurant_id;
  new.version := v_next;
  return new;
end;
$$;


--
-- Name: auto_resolve_stale_conversations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_resolve_stale_conversations() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  resolved_count integer;
begin
  update public.conversations
  set status = 'resolved'
  where status = 'active'
    and last_message_at < now() - interval '48 hours';

  get diagnostics resolved_count = row_count;
  return resolved_count;
end;
$$;


--
-- Name: can_access_conversation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_conversation(p_conversation_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and public.is_restaurant_member(c.restaurant_id, p_user_id)
  );
$$;


--
-- Name: claim_campaign_send_jobs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_campaign_send_jobs(p_limit integer) RETURNS TABLE(id uuid, campaign_id uuid, recipient_id uuid, attempt integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with picked as (
    select j.id
    from public.campaign_send_jobs j
    where j.status in ('pending','failed_retryable')
      and j.next_run_at <= now()
    order by j.next_run_at, j.created_at
    for update skip locked
    limit p_limit
  )
  update public.campaign_send_jobs cs
     set status     = 'sending',
         locked_at  = now(),
         locked_by  = 'worker',
         updated_at = now()
    from picked
   where cs.id = picked.id
   returning cs.id, cs.campaign_id, cs.recipient_id, cs.attempt;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    customer_phone text NOT NULL,
    customer_name text,
    status text DEFAULT 'active'::text,
    started_at timestamp with time zone DEFAULT now(),
    last_message_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    last_inbound_at timestamp with time zone,
    bot_paused boolean DEFAULT false NOT NULL,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    handler_mode text DEFAULT 'unassigned'::text,
    assigned_by_user_id uuid,
    unread_count integer DEFAULT 0 NOT NULL,
    last_read_at timestamp with time zone,
    archived_at timestamp with time zone,
    CONSTRAINT conversations_handler_mode_check CHECK ((handler_mode = ANY (ARRAY['unassigned'::text, 'human'::text, 'bot'::text]))),
    CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text, 'escalated'::text])))
);


--
-- Name: claim_conversation(uuid, text, uuid, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_conversation(p_conversation_id uuid, p_mode text, p_team_member_id uuid, p_force boolean DEFAULT false, p_assign_to_team_member_id uuid DEFAULT NULL::uuid) RETURNS public.conversations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user       uuid := auth.uid();
  v_conv       public.conversations%rowtype;
  v_is_admin   boolean;
  v_actor_tm   uuid;
  v_event      text;
  v_audit_tm   uuid;
begin
  if p_conversation_id is null then
    raise exception 'missing_arguments';
  end if;

  select * into v_conv
    from public.conversations
   where id = p_conversation_id
   for update;
  if not found then
    raise exception 'conversation_not_found';
  end if;

  v_is_admin := public.is_restaurant_admin(v_conv.restaurant_id, v_user);

  if p_force = true then
    if not v_is_admin then
      raise exception 'forbidden_not_admin';
    end if;

    select id into v_actor_tm
      from public.team_members
     where restaurant_id = v_conv.restaurant_id
       and user_id = v_user
       and is_active = true
     order by (role = 'admin') desc
     limit 1;

    if p_assign_to_team_member_id is not null then
      if not exists (
        select 1 from public.team_members
         where id = p_assign_to_team_member_id
           and restaurant_id = v_conv.restaurant_id
           and is_active = true
      ) then
        raise exception 'target_member_not_in_restaurant';
      end if;

      update public.conversations set
        handler_mode        = 'human',
        assigned_to         = p_assign_to_team_member_id,
        assigned_at         = now(),
        assigned_by_user_id = v_user,
        bot_paused          = true
       where id = p_conversation_id
       returning * into v_conv;

      v_event    := 'reassign';
      v_audit_tm := p_assign_to_team_member_id;

    elsif p_mode = 'bot' then
      update public.conversations set
        handler_mode        = 'bot',
        assigned_to         = null,
        assigned_at         = null,
        assigned_by_user_id = v_user,
        bot_paused          = false
       where id = p_conversation_id
       returning * into v_conv;

      v_event    := 'force_bot';
      v_audit_tm := coalesce(v_actor_tm, v_conv.assigned_to);

    else
      update public.conversations set
        handler_mode        = 'unassigned',
        assigned_to         = null,
        assigned_at         = null,
        assigned_by_user_id = v_user
       where id = p_conversation_id
       returning * into v_conv;

      v_event    := 'unassign';
      v_audit_tm := coalesce(v_actor_tm, v_conv.assigned_to);
    end if;

    if v_audit_tm is not null then
      insert into public.conversation_claim_events
        (conversation_id, restaurant_id, team_member_id, mode, event_type, claimed_by_user_id)
        values (v_conv.id, v_conv.restaurant_id, v_audit_tm, coalesce(p_mode, v_conv.handler_mode), v_event, v_user);
    end if;

    return v_conv;
  end if;

  if p_team_member_id is null then
    raise exception 'missing_arguments';
  end if;

  if p_mode not in ('human','bot') then
    raise exception 'invalid_mode';
  end if;

  if not exists (
    select 1 from public.team_members
     where id = p_team_member_id
       and user_id = v_user
       and is_active = true
       and restaurant_id = v_conv.restaurant_id
  ) then
    raise exception 'not_a_team_member';
  end if;

  -- Allow takeover from 'unassigned' (first-claim) AND from 'bot'
  -- (human agent stepping in for the bot). Do NOT steal from another
  -- human agent — they keep the claim unless an admin uses p_force.
  update public.conversations set
    handler_mode        = p_mode,
    assigned_to         = case when p_mode = 'human' then p_team_member_id else null end,
    assigned_at         = case when p_mode = 'human' then now() else null end,
    assigned_by_user_id = v_user,
    bot_paused          = (p_mode = 'human')
   where id = p_conversation_id
     and handler_mode in ('unassigned', 'bot')
   returning * into v_conv;

  if not found then
    select * into v_conv
      from public.conversations
     where id = p_conversation_id;
    if not found then
      raise exception 'conversation_not_found';
    end if;
    return v_conv;
  end if;

  insert into public.conversation_claim_events
    (conversation_id, restaurant_id, team_member_id, mode, event_type, claimed_by_user_id)
    values (
      v_conv.id,
      v_conv.restaurant_id,
      p_team_member_id,
      p_mode,
      'claim',
      v_user
    );

  return v_conv;
end
$$;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    customer_phone text NOT NULL,
    customer_name text,
    type text NOT NULL,
    details text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_note text,
    admin_reply text,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    escalation_reason text,
    assigned_to uuid,
    claimed_at timestamp with time zone,
    ai_draft_reply text,
    ai_draft_generated_at timestamp with time zone,
    hanan_escalated_at timestamp with time zone,
    rekaz_booking_url text,
    extracted_intent jsonb,
    CONSTRAINT orders_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'urgent'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text, 'replied'::text]))),
    CONSTRAINT orders_type_check CHECK ((type = ANY (ARRAY['reservation'::text, 'escalation'::text, 'complaint'::text])))
);


--
-- Name: claim_escalation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_escalation(p_order_id uuid, p_team_member_id uuid) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order         public.orders;
  v_restaurant    uuid;
  v_member_user   uuid;
  v_member_active boolean;
  v_member_tenant uuid;
begin
  if p_order_id is null or p_team_member_id is null then
    return null;
  end if;
  select restaurant_id into v_restaurant from public.orders where id = p_order_id;
  if v_restaurant is null then return null; end if;

  select user_id, is_active, restaurant_id
    into v_member_user, v_member_active, v_member_tenant
    from public.team_members where id = p_team_member_id;
  if v_member_user is null then return null; end if;
  if v_member_tenant <> v_restaurant then return null; end if;
  if v_member_active = false then return null; end if;

  if auth.uid() is not null
     and auth.uid() <> v_member_user
     and not public.is_restaurant_owner(v_restaurant, auth.uid()) then
    return null;
  end if;

  update public.orders
     set assigned_to = p_team_member_id,
         claimed_at  = timezone('utc', now()),
         updated_at  = timezone('utc', now())
   where id = p_order_id
     and type = 'escalation'
     and assigned_to is null
  returning * into v_order;

  return v_order;
end;
$$;


--
-- Name: current_on_duty_agents(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_on_duty_agents(p_restaurant_id uuid) RETURNS TABLE(team_member_id uuid, user_id uuid, full_name text, role text, is_available boolean, shift_starts_at timestamp with time zone, shift_ends_at timestamp with time zone, note text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select tm.id, tm.user_id, tm.full_name, tm.role, tm.is_available,
    s.starts_at, s.ends_at, s.note
  from public.agent_shifts s
  join public.team_members tm
    on tm.id = s.team_member_id and tm.is_active = true
  where s.restaurant_id = p_restaurant_id
    and s.starts_at <= timezone('utc', now())
    and s.ends_at   >  timezone('utc', now());
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')
  );
  RETURN NEW;
END;
$$;


--
-- Name: is_restaurant_admin(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    p_user_id is not null
    and p_restaurant_id is not null
    and (
      exists (
        select 1 from public.restaurants r
         where r.id = p_restaurant_id
           and r.owner_id = p_user_id
      )
      or exists (
        select 1 from public.team_members tm
         where tm.restaurant_id = p_restaurant_id
           and tm.user_id = p_user_id
           and tm.is_active = true
           and tm.role = 'admin'
      )
      or exists (
        select 1 from public.profiles pr
         where pr.id = p_user_id
           and pr.is_super_admin = true
      )
    );
$$;


--
-- Name: is_restaurant_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_restaurant_member(p_restaurant_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    p_user_id is not null
    and p_restaurant_id is not null
    and (
      exists (
        select 1 from public.restaurants r
        where r.id = p_restaurant_id and r.owner_id = p_user_id
      )
      or exists (
        select 1 from public.team_members tm
        where tm.restaurant_id = p_restaurant_id
          and tm.user_id = p_user_id
          and tm.is_active = true
      )
      or exists (
        select 1 from public.profiles pr
        where pr.id = p_user_id and pr.is_super_admin = true
      )
    );
$$;


--
-- Name: is_restaurant_owner(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    p_user_id is not null
    and p_restaurant_id is not null
    and (
      exists (
        select 1 from public.restaurants r
        where r.id = p_restaurant_id and r.owner_id = p_user_id
      )
      or exists (
        select 1 from public.profiles pr
        where pr.id = p_user_id and pr.is_super_admin = true
      )
    );
$$;


--
-- Name: kiara_apply_rekaz_snapshot(uuid, uuid, uuid, uuid, jsonb, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kiara_apply_rekaz_snapshot(p_restaurant_id uuid, p_sync_run_id uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_rows jsonb, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_actor_role text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_run public.rekaz_sync_runs%rowtype;
  v_incoming integer;
  v_added integer;
  v_updated integer;
  v_removed integer;
  v_unchanged integer;
  v_actor_type text;
  v_response jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'REKAZ_SNAPSHOT_INVALID';
  end if;
  if p_window_start is null or p_window_end is null
    or p_window_end <= p_window_start then
    raise exception using errcode = 'P0001', message = 'REKAZ_WINDOW_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming("arrivalAt" timestamptz)
    where incoming."arrivalAt" < p_window_start
       or incoming."arrivalAt" > p_window_end
  ) then
    raise exception using errcode = 'P0001', message = 'REKAZ_ROW_OUTSIDE_WINDOW';
  end if;

  -- One apply per tenant. The lock is transaction-scoped and automatically
  -- released on success or rollback.
  perform pg_advisory_xact_lock(hashtextextended('kiara:rekaz:' || p_restaurant_id::text, 0));

  select * into v_run
  from public.rekaz_sync_runs
  where id = p_sync_run_id and restaurant_id = p_restaurant_id;
  if found then
    if v_run.status = 'completed' then
      return jsonb_build_object(
        'syncRunId', v_run.id,
        'incoming', v_run.incoming_count,
        'added', v_run.added_count,
        'updated', v_run.updated_count,
        'removed', v_run.removed_count,
        'unchanged', v_run.unchanged_count,
        'replayed', true
      );
    end if;
    raise exception using errcode = 'P0001', message = 'REKAZ_SYNC_IN_PROGRESS';
  end if;

  select count(*) into v_incoming
  from jsonb_to_recordset(p_rows) as incoming(
    "sourceId" text,
    "sourceOrderId" text,
    "payloadHash" text,
    "arrivalAt" timestamptz,
    "customerPhone" text,
    "customerName" text,
    status text,
    payload jsonb
  );

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "sourceId" text,
      "sourceOrderId" text,
      "payloadHash" text,
      "arrivalAt" timestamptz,
      "customerPhone" text,
      "customerName" text,
      status text,
      payload jsonb
    )
    group by incoming."sourceId"
    having incoming."sourceId" is null or count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'REKAZ_SOURCE_ID_DUPLICATE';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "sourceId" text,
      "sourceOrderId" text,
      "payloadHash" text,
      "arrivalAt" timestamptz,
      "customerPhone" text,
      "customerName" text,
      status text,
      payload jsonb
    )
    where nullif(btrim(incoming."sourceId"), '') is null
      or nullif(btrim(incoming."payloadHash"), '') is null
      or incoming."arrivalAt" is null
      or incoming.payload is null
  ) then
    raise exception using errcode = 'P0001', message = 'REKAZ_ROW_INVALID';
  end if;

  insert into public.rekaz_sync_runs (
    id, restaurant_id, actor_user_id, actor_team_member_id, incoming_count
  ) values (
    p_sync_run_id, p_restaurant_id, p_actor_user_id, p_actor_team_member_id, v_incoming
  );

  insert into public.rekaz_changes (
    restaurant_id, sync_run_id, source_id, change_type,
    previous_payload, next_payload
  )
  select
    p_restaurant_id,
    p_sync_run_id,
    incoming."sourceId",
    case
      when existing.source_id is null then 'added'
      when existing.removed_at is not null then 'restored'
      else 'updated'
    end,
    existing.payload,
    incoming.payload
  from jsonb_to_recordset(p_rows) as incoming(
    "sourceId" text,
    "sourceOrderId" text,
    "payloadHash" text,
    "arrivalAt" timestamptz,
    "customerPhone" text,
    "customerName" text,
    status text,
    payload jsonb
  )
  left join public.rekaz_reservations existing
    on existing.restaurant_id = p_restaurant_id
   and existing.source_id = incoming."sourceId"
  where existing.source_id is null
     or existing.removed_at is not null
     or existing.payload_hash is distinct from incoming."payloadHash";

  insert into public.rekaz_changes (
    restaurant_id, sync_run_id, source_id, change_type,
    previous_payload, next_payload
  )
  select
    p_restaurant_id,
    p_sync_run_id,
    existing.source_id,
    'removed',
    existing.payload,
    null
  from public.rekaz_reservations existing
  where existing.restaurant_id = p_restaurant_id
    and existing.removed_at is null
    and existing.arrival_at between p_window_start and p_window_end
    and not exists (
      select 1
      from jsonb_to_recordset(p_rows) as incoming(
        "sourceId" text,
        "sourceOrderId" text,
        "payloadHash" text,
        "arrivalAt" timestamptz,
        "customerPhone" text,
        "customerName" text,
        status text,
        payload jsonb
      )
      where incoming."sourceId" = existing.source_id
    );

  insert into public.rekaz_reservations (
    restaurant_id, source_id, source_order_id, payload_hash, arrival_at,
    customer_phone, customer_name, status, payload, last_seen_at,
    removed_at, last_sync_run_id
  )
  select
    p_restaurant_id,
    incoming."sourceId",
    nullif(incoming."sourceOrderId", ''),
    incoming."payloadHash",
    incoming."arrivalAt",
    coalesce(incoming."customerPhone", ''),
    coalesce(incoming."customerName", ''),
    coalesce(incoming.status, ''),
    incoming.payload,
    now(),
    null,
    p_sync_run_id
  from jsonb_to_recordset(p_rows) as incoming(
    "sourceId" text,
    "sourceOrderId" text,
    "payloadHash" text,
    "arrivalAt" timestamptz,
    "customerPhone" text,
    "customerName" text,
    status text,
    payload jsonb
  )
  on conflict (restaurant_id, source_id) do update
  set source_order_id = excluded.source_order_id,
      payload_hash = excluded.payload_hash,
      arrival_at = excluded.arrival_at,
      customer_phone = excluded.customer_phone,
      customer_name = excluded.customer_name,
      status = excluded.status,
      payload = excluded.payload,
      last_seen_at = now(),
      removed_at = null,
      last_sync_run_id = p_sync_run_id;

  update public.rekaz_reservations existing
  set removed_at = now(),
      last_sync_run_id = p_sync_run_id
  where existing.restaurant_id = p_restaurant_id
    and existing.removed_at is null
    and existing.arrival_at between p_window_start and p_window_end
    and not exists (
      select 1
      from jsonb_to_recordset(p_rows) as incoming(
        "sourceId" text,
        "sourceOrderId" text,
        "payloadHash" text,
        "arrivalAt" timestamptz,
        "customerPhone" text,
        "customerName" text,
        status text,
        payload jsonb
      )
      where incoming."sourceId" = existing.source_id
    );

  select
    count(*) filter (where change_type = 'added'),
    count(*) filter (where change_type in ('updated', 'restored')),
    count(*) filter (where change_type = 'removed')
  into v_added, v_updated, v_removed
  from public.rekaz_changes
  where sync_run_id = p_sync_run_id;

  v_unchanged := greatest(v_incoming - v_added - v_updated, 0);
  update public.rekaz_sync_runs
  set status = 'completed',
      added_count = v_added,
      updated_count = v_updated,
      removed_count = v_removed,
      unchanged_count = v_unchanged,
      completed_at = now()
  where id = p_sync_run_id
  returning * into v_run;

  v_actor_type := case when p_actor_team_member_id is null then 'owner' else 'team_member' end;
  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_team_member_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'rekaz_sync', p_sync_run_id, 'rekaz.sync_completed',
    v_actor_type, p_actor_role, p_actor_user_id, p_actor_team_member_id, p_sync_run_id,
    jsonb_build_object(
      'incoming', v_incoming,
      'added', v_added,
      'updated', v_updated,
      'removed', v_removed,
      'unchanged', v_unchanged
    )
  );

  v_response := jsonb_build_object(
    'syncRunId', p_sync_run_id,
    'incoming', v_incoming,
    'added', v_added,
    'updated', v_updated,
    'removed', v_removed,
    'unchanged', v_unchanged,
    'replayed', false
  );
  return v_response;
end;
$$;


--
-- Name: kiara_claim_outbox_event(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kiara_claim_outbox_event(p_restaurant_id uuid, p_command_id uuid, p_event_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_event public.outbox_events%rowtype;
begin
  select * into v_event
  from public.outbox_events
  where id = p_event_id
    and restaurant_id = p_restaurant_id
    and command_id = p_command_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'OUTBOX_EVENT_NOT_FOUND';
  end if;

  if v_event.status <> 'pending' then
    return jsonb_build_object(
      'claimed', false,
      'status', v_event.status,
      'event', to_jsonb(v_event)
    );
  end if;

  update public.outbox_events
  set status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now()
  where id = p_event_id
  returning * into v_event;

  return jsonb_build_object('claimed', true, 'event', to_jsonb(v_event));
end;
$$;


--
-- Name: kiara_command_field_order_step(uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kiara_command_field_order_step(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_field_staff_account_id uuid, p_role text, p_roster_id uuid, p_action text, p_location jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_order public.driver_orders%rowtype;
  v_progress public.field_order_progress%rowtype;
  v_existing public.command_receipts%rowtype;
  v_response jsonb;
  v_expected_action text;
begin
  if p_role not in ('driver', 'specialist') then
    raise exception using errcode = 'P0001', message = 'FIELD_ROLE_INVALID';
  end if;
  if p_action not in (
    'confirm_ride', 'confirm_pickup', 'start_service', 'complete_order',
    'driver_arrived', 'driver_return'
  ) then
    raise exception using errcode = 'P0001', message = 'FIELD_ACTION_INVALID';
  end if;
  if not exists (
    select 1
    from public.field_staff_accounts a
    where a.id = p_field_staff_account_id
      and a.auth_user_id = p_actor_user_id
      and a.restaurant_id = p_restaurant_id
      and a.role = p_role
      and a.is_active = true
      and (
        (p_role = 'driver' and a.driver_id = p_roster_id)
        or (p_role = 'specialist' and a.specialist_id = p_roster_id)
      )
  ) then
    raise exception using errcode = 'P0001', message = 'FIELD_ACCOUNT_FORBIDDEN';
  end if;

  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;
  if (p_role = 'driver' and v_order.driver_id is distinct from p_roster_id)
    or (p_role = 'specialist' and v_order.specialist_id is distinct from p_roster_id) then
    raise exception using errcode = 'P0001', message = 'FIELD_ORDER_FORBIDDEN';
  end if;

  insert into public.field_order_progress (order_id, restaurant_id)
  values (p_order_id, p_restaurant_id)
  on conflict (order_id) do nothing;

  select * into v_progress
  from public.field_order_progress
  where order_id = p_order_id and restaurant_id = p_restaurant_id
  for update;

  select * into v_existing
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_type <> 'field.order_step'
      or v_existing.aggregate_id <> p_order_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing.status = 'completed' then
      return v_existing.response || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'COMMAND_IN_PROGRESS';
  end if;

  if v_progress.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'FIELD_VERSION_CONFLICT',
      detail = jsonb_build_object('currentVersion', v_progress.version)::text;
  end if;

  v_expected_action := case
    when v_progress.driver_confirmed_at is null then 'confirm_ride'
    when v_progress.specialist_pickup_at is null then 'confirm_pickup'
    when v_progress.service_started_at is null then 'start_service'
    when v_progress.completed_at is null then 'complete_order'
    when v_progress.driver_returned_at is null then 'driver_return'
    else null
  end;

  if p_action = 'driver_arrived' then
    if p_role <> 'driver' then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_FORBIDDEN';
    end if;
    if v_progress.driver_confirmed_at is null
      or v_progress.specialist_pickup_at is not null then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_OUT_OF_SEQUENCE';
    end if;
  else
    if v_expected_action is distinct from p_action then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_OUT_OF_SEQUENCE';
    end if;
    if (p_action in ('confirm_ride', 'driver_return') and p_role <> 'driver')
      or (p_action in ('confirm_pickup', 'start_service', 'complete_order')
          and p_role <> 'specialist') then
      raise exception using errcode = 'P0001', message = 'FIELD_ACTION_FORBIDDEN';
    end if;
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_field_staff_account_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'field.order_step', 'driver_order',
    p_order_id, p_actor_user_id, p_field_staff_account_id
  );

  if p_action = 'confirm_ride' then
    update public.field_order_progress
    set driver_confirmed_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'driver_arrived' then
    update public.field_order_progress
    set driver_arrived_at = coalesce(driver_arrived_at, now()), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'confirm_pickup' then
    update public.field_order_progress
    set specialist_pickup_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'start_service' then
    update public.field_order_progress
    set service_started_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  elsif p_action = 'complete_order' then
    update public.field_order_progress
    set completed_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  else
    update public.field_order_progress
    set driver_returned_at = now(), last_activity_at = now(),
        last_reminder_at = null, version = version + 1
    where order_id = p_order_id returning * into v_progress;
  end if;

  if p_location is not null then
    insert into public.field_location_checkpoints (
      restaurant_id, order_id, field_staff_account_id, action,
      latitude, longitude, accuracy_meters, captured_at, source,
      permission_state, exception_reason
    ) values (
      p_restaurant_id, p_order_id, p_field_staff_account_id, p_action,
      case when p_location ? 'latitude' then (p_location->>'latitude')::double precision end,
      case when p_location ? 'longitude' then (p_location->>'longitude')::double precision end,
      case when p_location ? 'accuracyMeters' then (p_location->>'accuracyMeters')::double precision end,
      case when p_location ? 'capturedAt' then (p_location->>'capturedAt')::timestamptz end,
      coalesce(nullif(p_location->>'source', ''), 'device'),
      nullif(p_location->>'permissionState', ''),
      nullif(p_location->>'exceptionReason', '')
    );
  end if;

  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_field_staff_account_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'field.' || p_action,
    'field_staff', p_role, p_actor_user_id, p_field_staff_account_id, p_idempotency_key,
    jsonb_build_object(
      'role', p_role,
      'rosterId', p_roster_id,
      'version', v_progress.version,
      'hasLocationEvidence', p_location is not null
    )
  );

  v_response := jsonb_build_object(
    'progress', to_jsonb(v_progress),
    'replayed', false
  );
  update public.command_receipts
  set status = 'completed', response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;


--
-- Name: kiara_command_finish_order_dispatch(uuid, uuid, uuid, boolean, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kiara_command_finish_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_command_id uuid, p_driver_sent boolean, p_specialist_sent boolean, p_driver_error text, p_specialist_error text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_order public.driver_orders%rowtype;
  v_receipt public.command_receipts%rowtype;
  v_response jsonb;
begin
  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  select * into v_receipt
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_command_id
    and command_type = 'order.dispatch'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'DISPATCH_COMMAND_NOT_FOUND';
  end if;
  if v_receipt.status = 'completed' then
    return v_receipt.response || jsonb_build_object('replayed', true);
  end if;
  if v_order.active_dispatch_command_id is distinct from p_command_id then
    raise exception using errcode = 'P0001', message = 'DISPATCH_COMMAND_MISMATCH';
  end if;

  update public.outbox_events
  set status = case
        when payload->>'recipientRole' = 'driver' and p_driver_sent then 'sent'
        when payload->>'recipientRole' = 'specialist' and p_specialist_sent then 'sent'
        else 'failed'
      end,
      completed_at = now(),
      last_error = case
        when payload->>'recipientRole' = 'driver' then nullif(p_driver_error, '')
        else nullif(p_specialist_error, '')
      end
  where restaurant_id = p_restaurant_id
    and command_id = p_command_id
    and status in ('pending', 'processing');

  update public.driver_orders
  set status = case when p_driver_sent then 'sent' else 'failed' end,
      sent_at = case when p_driver_sent then now() else sent_at end,
      dispatch_state = case when p_driver_sent then 'sent' else 'failed' end,
      active_dispatch_command_id = null,
      dispatch_started_at = null,
      updated_at = now(),
      version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'order.dispatch_completed', 'system',
    'system', p_command_id,
    jsonb_build_object(
      'driverSent', p_driver_sent,
      'specialistSent', p_specialist_sent,
      'driverError', nullif(p_driver_error, ''),
      'specialistError', nullif(p_specialist_error, ''),
      'version', v_order.version
    )
  );

  v_response := jsonb_build_object(
    'order', to_jsonb(v_order),
    'commandId', p_command_id,
    'driverSent', p_driver_sent,
    'specialistSent', p_specialist_sent,
    'replayed', false
  );
  update public.command_receipts
  set status = 'completed', response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_command_id;

  return v_response;
end;
$$;


--
-- Name: kiara_command_prepare_order_dispatch(uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, uuid, text, numeric, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kiara_command_prepare_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_specialist_id uuid, p_driver_id uuid, p_trip_type text, p_price numeric, p_driver_phone text, p_driver_message text, p_specialist_phone text, p_specialist_message text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_order public.driver_orders%rowtype;
  v_existing public.command_receipts%rowtype;
  v_driver_outbox_id uuid;
  v_specialist_outbox_id uuid;
  v_response jsonb;
  v_actor_type text;
begin
  if p_actor_role not in ('admin', 'agent') then
    raise exception using errcode = 'P0001', message = 'ORDER_FORBIDDEN';
  end if;
  if p_trip_type not in ('one_way', 'round_trip') then
    raise exception using errcode = 'P0001', message = 'ORDER_TRIP_TYPE_INVALID';
  end if;
  if char_length(btrim(coalesce(p_driver_phone, ''))) < 8
    or char_length(btrim(coalesce(p_driver_message, ''))) < 2 then
    raise exception using errcode = 'P0001', message = 'DRIVER_MESSAGE_INVALID';
  end if;
  if char_length(p_driver_message) > 3000
    or char_length(coalesce(p_specialist_message, '')) > 3000 then
    raise exception using errcode = 'P0001', message = 'DISPATCH_MESSAGE_TOO_LONG';
  end if;

  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  select * into v_existing
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_type <> 'order.dispatch'
      or v_existing.aggregate_id <> p_order_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing.status = 'completed' then
      return v_existing.response || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'COMMAND_IN_PROGRESS';
  end if;

  if v_order.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'ORDER_VERSION_CONFLICT',
      detail = jsonb_build_object(
        'currentVersion', v_order.version,
        'updatedAt', v_order.updated_at,
        'updatedBy', v_order.updated_by
      )::text;
  end if;
  if v_order.status = 'sent' or v_order.dispatch_state = 'sent' then
    raise exception using errcode = 'P0001', message = 'ORDER_ALREADY_DISPATCHED';
  end if;
  if v_order.active_dispatch_command_id is not null then
    raise exception using errcode = 'P0001', message = 'ORDER_DISPATCH_IN_PROGRESS';
  end if;
  if not exists (
    select 1 from public.specialists
    where id = p_specialist_id and restaurant_id = p_restaurant_id and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'SPECIALIST_NOT_AVAILABLE';
  end if;
  if not exists (
    select 1 from public.drivers
    where id = p_driver_id and restaurant_id = p_restaurant_id and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'DRIVER_NOT_AVAILABLE';
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_team_member_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'order.dispatch', 'driver_order',
    p_order_id, p_actor_user_id, p_actor_team_member_id
  );

  update public.driver_orders
  set specialist_id = p_specialist_id,
      driver_id = p_driver_id,
      trip_type = p_trip_type,
      price = p_price,
      dispatch_state = 'processing',
      active_dispatch_command_id = p_idempotency_key,
      dispatch_started_at = now(),
      updated_by = p_actor_team_member_id,
      updated_at = now(),
      version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  insert into public.outbox_events (
    restaurant_id, command_id, aggregate_type, aggregate_id, event_type,
    idempotency_key, payload
  ) values (
    p_restaurant_id, p_idempotency_key, 'driver_order', p_order_id,
    'whatsapp.driver.dispatch', p_idempotency_key::text || ':driver',
    jsonb_build_object(
      'channel', 'whatsapp', 'recipientRole', 'driver',
      'recipient', btrim(p_driver_phone), 'body', p_driver_message
    )
  ) returning id into v_driver_outbox_id;

  if char_length(btrim(coalesce(p_specialist_phone, ''))) >= 8
    and char_length(btrim(coalesce(p_specialist_message, ''))) >= 2 then
    insert into public.outbox_events (
      restaurant_id, command_id, aggregate_type, aggregate_id, event_type,
      idempotency_key, payload
    ) values (
      p_restaurant_id, p_idempotency_key, 'driver_order', p_order_id,
      'whatsapp.specialist.dispatch', p_idempotency_key::text || ':specialist',
      jsonb_build_object(
        'channel', 'whatsapp', 'recipientRole', 'specialist',
        'recipient', btrim(p_specialist_phone), 'body', p_specialist_message
      )
    ) returning id into v_specialist_outbox_id;
  end if;

  v_actor_type := case when p_actor_team_member_id is null then 'owner' else 'team_member' end;
  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_team_member_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'order.dispatch_prepared', v_actor_type,
    p_actor_role, p_actor_user_id, p_actor_team_member_id, p_idempotency_key,
    jsonb_build_object(
      'specialistId', p_specialist_id,
      'driverId', p_driver_id,
      'version', v_order.version,
      'driverOutboxId', v_driver_outbox_id,
      'specialistOutboxId', v_specialist_outbox_id
    )
  );

  v_response := jsonb_build_object(
    'order', to_jsonb(v_order),
    'commandId', p_idempotency_key,
    'driverOutboxId', v_driver_outbox_id,
    'specialistOutboxId', v_specialist_outbox_id,
    'replayed', false
  );
  update public.command_receipts
  set response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;


--
-- Name: kiara_command_update_driver_order(uuid, uuid, bigint, uuid, uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kiara_command_update_driver_order(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_patch jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_order public.driver_orders%rowtype;
  v_existing public.command_receipts%rowtype;
  v_response jsonb;
  v_actor_type text;
begin
  if p_actor_role not in ('admin', 'agent') then
    raise exception using errcode = 'P0001', message = 'ORDER_FORBIDDEN';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'ORDER_PATCH_INVALID';
  end if;
  if (p_patch - array[
    'arrivalAt', 'customerLocation', 'durationMinutes', 'tripType',
    'specialistId', 'driverId', 'price'
  ]) <> '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'ORDER_PATCH_INVALID';
  end if;
  if p_patch ? 'price' and p_actor_role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'ORDER_PRICE_FORBIDDEN';
  end if;

  select * into v_order
  from public.driver_orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  select * into v_existing
  from public.command_receipts
  where restaurant_id = p_restaurant_id
    and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.command_type <> 'order.update'
      or v_existing.aggregate_id <> p_order_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_existing.status = 'completed' then
      return v_existing.response || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'COMMAND_IN_PROGRESS';
  end if;

  if v_order.version <> p_expected_version then
    raise exception using
      errcode = 'P0001',
      message = 'ORDER_VERSION_CONFLICT',
      detail = jsonb_build_object(
        'currentVersion', v_order.version,
        'updatedAt', v_order.updated_at,
        'updatedBy', v_order.updated_by
      )::text;
  end if;

  if p_patch ? 'durationMinutes'
    and ((p_patch->>'durationMinutes')::integer < 5
      or (p_patch->>'durationMinutes')::integer > 480) then
    raise exception using errcode = 'P0001', message = 'ORDER_DURATION_INVALID';
  end if;
  if p_patch ? 'tripType'
    and p_patch->>'tripType' not in ('one_way', 'round_trip') then
    raise exception using errcode = 'P0001', message = 'ORDER_TRIP_TYPE_INVALID';
  end if;
  if p_patch ? 'customerLocation'
    and char_length(btrim(p_patch->>'customerLocation')) < 2 then
    raise exception using errcode = 'P0001', message = 'ORDER_LOCATION_INVALID';
  end if;
  if p_patch ? 'specialistId'
    and nullif(p_patch->>'specialistId', '') is not null
    and not exists (
      select 1 from public.specialists
      where id = (p_patch->>'specialistId')::uuid
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
    raise exception using errcode = 'P0001', message = 'SPECIALIST_NOT_AVAILABLE';
  end if;
  if p_patch ? 'driverId'
    and nullif(p_patch->>'driverId', '') is not null
    and not exists (
      select 1 from public.drivers
      where id = (p_patch->>'driverId')::uuid
        and restaurant_id = p_restaurant_id
        and is_active = true
    ) then
    raise exception using errcode = 'P0001', message = 'DRIVER_NOT_AVAILABLE';
  end if;

  insert into public.command_receipts (
    restaurant_id, idempotency_key, command_type, aggregate_type,
    aggregate_id, actor_user_id, actor_team_member_id
  ) values (
    p_restaurant_id, p_idempotency_key, 'order.update', 'driver_order',
    p_order_id, p_actor_user_id, p_actor_team_member_id
  );

  update public.driver_orders
  set
    arrival_at = case when p_patch ? 'arrivalAt'
      then (p_patch->>'arrivalAt')::timestamptz else arrival_at end,
    customer_location = case when p_patch ? 'customerLocation'
      then btrim(p_patch->>'customerLocation') else customer_location end,
    duration_minutes = case when p_patch ? 'durationMinutes'
      then (p_patch->>'durationMinutes')::integer else duration_minutes end,
    trip_type = case when p_patch ? 'tripType'
      then p_patch->>'tripType' else trip_type end,
    specialist_id = case when p_patch ? 'specialistId'
      then nullif(p_patch->>'specialistId', '')::uuid else specialist_id end,
    driver_id = case when p_patch ? 'driverId'
      then nullif(p_patch->>'driverId', '')::uuid else driver_id end,
    price = case when p_patch ? 'price'
      then (p_patch->>'price')::numeric else price end,
    updated_by = p_actor_team_member_id,
    updated_at = now(),
    version = version + 1
  where id = p_order_id and restaurant_id = p_restaurant_id
  returning * into v_order;

  v_actor_type := case when p_actor_team_member_id is null then 'owner' else 'team_member' end;
  insert into public.operation_events (
    restaurant_id, aggregate_type, aggregate_id, event_type, actor_type,
    actor_role, actor_user_id, actor_team_member_id, idempotency_key, payload
  ) values (
    p_restaurant_id, 'driver_order', p_order_id, 'order.updated', v_actor_type,
    p_actor_role, p_actor_user_id, p_actor_team_member_id, p_idempotency_key,
    jsonb_build_object('patch', p_patch, 'version', v_order.version)
  );

  v_response := jsonb_build_object('order', to_jsonb(v_order), 'replayed', false);
  update public.command_receipts
  set status = 'completed', response = v_response
  where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key;

  return v_response;
end;
$$;


--
-- Name: match_knowledge_base(extensions.vector, double precision, integer, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_threshold double precision, match_count integer, p_restaurant_id uuid) RETURNS TABLE(id uuid, content text, similarity double precision)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  return query
  select
    kb.id,
    kb.content,
    1 - (kb.embedding <=> query_embedding) as similarity
  from public.knowledge_base kb
  where kb.restaurant_id = p_restaurant_id
    and 1 - (kb.embedding <=> query_embedding) > match_threshold
  order by kb.embedding <=> query_embedding
  limit match_count;
end;
$$;


--
-- Name: match_knowledge_base(extensions.vector, uuid, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_restaurant_id uuid, match_threshold double precision, match_count integer) RETURNS TABLE(id uuid, content text, title text, source_type text, similarity double precision)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  return query
  select
    kb.id,
    kb.content,
    kb.title,
    kb.source_type,
    1 - (kb.embedding <=> query_embedding) as similarity
  from public.knowledge_base kb
  where kb.restaurant_id = match_restaurant_id
    and 1 - (kb.embedding <=> query_embedding) > match_threshold
  order by kb.embedding <=> query_embedding
  limit match_count;
end;
$$;


--
-- Name: match_knowledge_chunks(extensions.vector, uuid, integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_knowledge_chunks(query_embedding extensions.vector, match_restaurant_id uuid, match_count integer DEFAULT 5, match_threshold double precision DEFAULT 0.4) RETURNS TABLE(id uuid, content text, source_file text, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  select
    kc.id,
    kc.content,
    kc.source_file,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where
    kc.restaurant_id = match_restaurant_id
    and 1 - (kc.embedding <=> query_embedding) > match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;


--
-- Name: mobile_inbox_list(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, customer_name text, customer_phone text, status text, last_message_at timestamp with time zone, last_inbound_at timestamp with time zone, handler_mode text, assigned_to uuid, unread_count integer, preview text, assignee_name text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with conv as (
    select c.id, c.customer_name, c.customer_phone, c.status,
           c.last_message_at, c.last_inbound_at, c.handler_mode,
           c.assigned_to, c.unread_count
    from public.conversations c
    where c.restaurant_id = p_restaurant_id
    order by c.last_message_at desc nulls last
    limit greatest(p_limit, 1)
  ),
  latest_customer as (
    -- Latest customer message per conversation in the window.
    select distinct on (m.conversation_id)
      m.conversation_id, m.content, m.created_at
    from public.messages m
    where m.conversation_id in (select id from conv)
      and m.role = 'customer'
    order by m.conversation_id, m.created_at desc
  )
  select
    c.id,
    c.customer_name,
    c.customer_phone,
    c.status,
    c.last_message_at,
    c.last_inbound_at,
    c.handler_mode,
    c.assigned_to,
    c.unread_count,
    lc.content as preview,
    tm.full_name as assignee_name
  from conv c
  left join latest_customer lc on lc.conversation_id = c.id
  left join public.team_members tm on tm.id = c.assigned_to
  order by c.last_message_at desc nulls last;
$$;


--
-- Name: mobile_inbox_list(uuid, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer DEFAULT 100, p_include_archived boolean DEFAULT false) RETURNS TABLE(id uuid, customer_name text, customer_phone text, status text, last_message_at timestamp with time zone, last_inbound_at timestamp with time zone, handler_mode text, assigned_to uuid, unread_count integer, archived_at timestamp with time zone, preview text, assignee_name text, label_ids uuid[])
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with conv as (
    select c.id, c.customer_name, c.customer_phone, c.status,
           c.last_message_at, c.last_inbound_at, c.handler_mode,
           c.assigned_to, c.unread_count, c.archived_at
    from public.conversations c
    where c.restaurant_id = p_restaurant_id
      and (p_include_archived or c.archived_at is null)
    order by c.last_message_at desc nulls last
    limit greatest(p_limit, 1)
  ),
  latest_customer as (
    select distinct on (m.conversation_id)
      m.conversation_id, m.content, m.created_at
    from public.messages m
    where m.conversation_id in (select id from conv)
      and m.role = 'customer'
    order by m.conversation_id, m.created_at desc
  ),
  labels_agg as (
    select a.conversation_id, array_agg(a.label_id order by a.assigned_at) as label_ids
    from public.conversation_label_assignments a
    where a.conversation_id in (select id from conv)
    group by a.conversation_id
  )
  select
    c.id, c.customer_name, c.customer_phone, c.status,
    c.last_message_at, c.last_inbound_at, c.handler_mode,
    c.assigned_to, c.unread_count, c.archived_at,
    lc.content as preview,
    tm.full_name as assignee_name,
    coalesce(la.label_ids, '{}'::uuid[]) as label_ids
  from conv c
  left join latest_customer lc on lc.conversation_id = c.id
  left join public.team_members tm on tm.id = c.assigned_to
  left join labels_agg la on la.conversation_id = c.id
  order by c.last_message_at desc nulls last;
$$;


--
-- Name: recompute_campaign_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_campaign_counts(p_campaign_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_sent    int;
  v_failed  int;
  v_pending int;
begin
  select
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'failed_terminal'),
    count(*) filter (where status in ('pending','sending','failed_retryable'))
  into v_sent, v_failed, v_pending
  from public.campaign_send_jobs
  where campaign_id = p_campaign_id;

  update public.marketing_campaigns
     set sent_count   = v_sent,
         failed_count = v_failed,
         status = case
           when v_pending > 0 then status
           when v_failed = 0 then 'completed'
           when v_sent  = 0 then 'failed'
           else 'partially_completed'
         end,
         sending_completed_at = case
           when v_pending = 0 and sending_completed_at is null
             then now()
           else sending_completed_at
         end,
         updated_at = now()
   where id = p_campaign_id;
end;
$$;


--
-- Name: restaurant_kpis_today(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restaurant_kpis_today(p_restaurant_id uuid) RETURNS TABLE(unassigned_count integer, human_active_count integer, bot_active_count integer, expired_count integer, orders_pending_count integer, agents_on_shift_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    (select count(*)::int from public.conversations
      where restaurant_id = p_restaurant_id
        and handler_mode = 'unassigned'
        and status = 'active'),
    (select count(*)::int from public.conversations
      where restaurant_id = p_restaurant_id
        and handler_mode = 'human'
        and status = 'active'),
    (select count(*)::int from public.conversations
      where restaurant_id = p_restaurant_id
        and handler_mode = 'bot'
        and status = 'active'),
    (select count(*)::int from public.conversations
      where restaurant_id = p_restaurant_id
        and status = 'active'
        and last_inbound_at < now() - interval '24 hours'),
    (select count(*)::int from public.orders
      where restaurant_id = p_restaurant_id
        and type = 'escalation'
        and status = 'pending'),
    (select count(distinct tm.id)::int
       from public.team_members tm
       join public.agent_shifts s on s.team_member_id = tm.id
      where tm.restaurant_id = p_restaurant_id
        and tm.is_active = true
        and s.starts_at <= now()
        and s.ends_at > now())
  where public.is_restaurant_admin(p_restaurant_id, auth.uid());
$$;


--
-- Name: set_orders_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_orders_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;


--
-- Name: set_updated_at_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;


--
-- Name: sync_opt_out_to_customers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_opt_out_to_customers() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    update public.customers
       set opted_out = true, updated_at = now()
     where restaurant_id = new.restaurant_id
       and phone_number = new.phone_number;
  elsif tg_op = 'DELETE' then
    update public.customers
       set opted_out = false, updated_at = now()
     where restaurant_id = old.restaurant_id
       and phone_number = old.phone_number;
  end if;
  return null;
end;
$$;


--
-- Name: team_performance(uuid, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.team_performance(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) RETURNS TABLE(team_member_id uuid, full_name text, role text, is_active boolean, is_available boolean, messages_sent integer, conversations_handled integer, active_now integer, first_response_p50_sec integer, first_response_p90_sec integer, reply_latency_p50_sec integer, takeovers_from_bot integer, reassigns_received integer, reassigns_given integer, sla_breaches integer, labels_applied integer, approx_hours_worked numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
with
tenant_members as (
  select tm.id, tm.user_id, tm.full_name, tm.role,
         tm.is_active, tm.is_available
    from team_members tm
   where tm.restaurant_id = p_restaurant_id
),
agent_msgs as (
  select m.sender_team_member_id as tm_id,
         m.conversation_id,
         m.created_at
    from messages m
    join conversations c on c.id = m.conversation_id
   where c.restaurant_id = p_restaurant_id
     and m.role = 'agent'
     and m.sender_team_member_id is not null
     and m.created_at >= p_from
     and m.created_at <  p_to
),
reply_latencies as (
  select m.sender_team_member_id as tm_id,
         extract(epoch from (m.created_at - prev.created_at))::int as latency_sec
    from messages m
    join conversations c on c.id = m.conversation_id
    join lateral (
      select p.role, p.created_at
        from messages p
       where p.conversation_id = m.conversation_id
         and p.created_at < m.created_at
       order by p.created_at desc
       limit 1
    ) prev on true
   where c.restaurant_id = p_restaurant_id
     and m.role = 'agent'
     and m.sender_team_member_id is not null
     and m.created_at >= p_from
     and m.created_at <  p_to
     and prev.role = 'customer'
),
first_responses as (
  select fa.tm_id, fa.conversation_id,
         extract(epoch from (fa.first_reply - last_cust.created_at))::int as frt_sec
    from (
      select tm_id,
             conversation_id,
             min(created_at) as first_reply
        from agent_msgs
       group by 1, 2
    ) fa
    join lateral (
      select p.created_at
        from messages p
       where p.conversation_id = fa.conversation_id
         and p.created_at < fa.first_reply
         and p.role = 'customer'
       order by p.created_at desc
       limit 1
    ) last_cust on true
),
daily_windows as (
  select tm_id,
         date_trunc('day', created_at) as day,
         least(
           extract(epoch from (max(created_at) - min(created_at))) / 3600.0,
           12
         ) as hours
    from agent_msgs
   group by 1, 2
),
claim_events as (
  select ce.team_member_id, ce.claimed_by_user_id, ce.event_type, ce.mode
    from conversation_claim_events ce
   where ce.restaurant_id = p_restaurant_id
     and ce.claimed_at >= p_from
     and ce.claimed_at <  p_to
),
sla as (
  select c.assigned_to as tm_id, count(*)::int as breaches
    from sla_notification_log s
    join conversations c on c.id = s.conversation_id
   where s.restaurant_id = p_restaurant_id
     and s.notified_at >= p_from
     and s.notified_at <  p_to
     and c.assigned_to is not null
   group by 1
),
labels_applied as (
  select cla.assigned_by as actor_user_id, count(*)::int as n
    from conversation_label_assignments cla
    join conversation_labels cl on cl.id = cla.label_id
   where cl.restaurant_id = p_restaurant_id
     and cla.assigned_at >= p_from
     and cla.assigned_at <  p_to
     and cla.assigned_by is not null
   group by 1
)
select
  tm.id,
  tm.full_name,
  tm.role,
  tm.is_active,
  tm.is_available,
  coalesce((select count(*)::int            from agent_msgs where tm_id = tm.id), 0),
  coalesce((select count(distinct conversation_id)::int from agent_msgs where tm_id = tm.id), 0),
  coalesce((select count(*)::int from conversations
             where restaurant_id = p_restaurant_id
               and assigned_to = tm.id
               and archived_at is null
               and status = 'active'), 0),
  coalesce((select percentile_cont(0.5) within group (order by frt_sec)
              from first_responses where tm_id = tm.id)::int, 0),
  coalesce((select percentile_cont(0.9) within group (order by frt_sec)
              from first_responses where tm_id = tm.id)::int, 0),
  coalesce((select percentile_cont(0.5) within group (order by latency_sec)
              from reply_latencies where tm_id = tm.id)::int, 0),
  coalesce((select count(*)::int from claim_events
             where team_member_id = tm.id
               and event_type = 'claim'
               and mode = 'human'), 0),
  coalesce((select count(*)::int from claim_events
             where team_member_id = tm.id
               and event_type = 'reassign'), 0),
  coalesce((select count(*)::int from claim_events
             where claimed_by_user_id = tm.user_id
               and team_member_id <> tm.id
               and event_type = 'reassign'), 0),
  coalesce((select breaches from sla where tm_id = tm.id), 0),
  coalesce((select n from labels_applied where actor_user_id = tm.user_id), 0),
  coalesce((select round(sum(hours)::numeric, 1) from daily_windows where tm_id = tm.id), 0)::numeric
from tenant_members tm
where public.is_restaurant_admin(p_restaurant_id, auth.uid())
order by tm.is_active desc, tm.full_name nulls last;
$$;


--
-- Name: tg_increment_unread_on_customer_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_increment_unread_on_customer_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if new.role = 'customer' then
    update public.conversations
       set unread_count = coalesce(unread_count, 0) + 1
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;


--
-- Name: tg_increment_unread_on_visible_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_increment_unread_on_visible_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  sent_by_team_member_id text;
begin
  sent_by_team_member_id := coalesce(new.metadata ->> 'sent_by_team_member_id', '');

  if new.role = 'customer'
     or (new.role = 'agent' and sent_by_team_member_id = '') then
    update public.conversations
       set unread_count = coalesce(unread_count, 0) + 1
     where id = new.conversation_id;
  end if;

  return new;
end;
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;


--
-- Name: access_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_name text NOT NULL,
    contact_email text NOT NULL,
    contact_phone text,
    country text DEFAULT 'SA'::text NOT NULL,
    commercial_registration text,
    message text,
    status text DEFAULT 'new'::text NOT NULL,
    source text DEFAULT 'web_signup'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_instructions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_instructions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    author_user_id uuid,
    authored_via text DEFAULT 'ai_manager'::text NOT NULL,
    source_thread_id uuid,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT agent_instructions_authored_via_check CHECK ((authored_via = ANY (ARRAY['ai_manager'::text, 'manual'::text]))),
    CONSTRAINT agent_instructions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'draft'::text])))
);


--
-- Name: agent_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    team_member_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by uuid,
    CONSTRAINT agent_shifts_time_range_check CHECK ((ends_at > starts_at))
);


--
-- Name: ai_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text DEFAULT 'مساعد المطعم'::text NOT NULL,
    avatar_url text,
    personality text DEFAULT 'friendly'::text,
    system_instructions text DEFAULT ''::text,
    chat_mode text DEFAULT 'text_input'::text,
    language_preference text DEFAULT 'ar'::text,
    off_topic_response text DEFAULT 'عذراً، أنا مساعد المطعم ويمكنني مساعدتك فقط في الاستفسارات المتعلقة بالمطعم والقائمة والطلبات.'::text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    max_context_messages integer DEFAULT 10 NOT NULL,
    temperature numeric(3,2) DEFAULT 0.40 NOT NULL,
    CONSTRAINT ai_agents_chat_mode_check CHECK ((chat_mode = ANY (ARRAY['generative_ui'::text, 'text_input'::text]))),
    CONSTRAINT ai_agents_language_preference_check CHECK ((language_preference = ANY (ARRAY['ar'::text, 'en'::text, 'auto'::text]))),
    CONSTRAINT ai_agents_personality_check CHECK ((personality = ANY (ARRAY['friendly'::text, 'professional'::text, 'creative'::text, 'strict'::text])))
);


--
-- Name: ai_kill_switch_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_kill_switch_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    enabled_from boolean NOT NULL,
    enabled_to boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_reply_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_reply_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    inbound_message_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    locked_at timestamp with time zone,
    processed_at timestamp with time zone,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    feature text NOT NULL,
    month_key text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: campaign_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    phone_number text NOT NULL,
    name text,
    metadata jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text,
    error_message text,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    twilio_message_sid text,
    CONSTRAINT campaign_recipients_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])))
);


--
-- Name: campaign_send_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_send_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    last_error text,
    error_code text,
    twilio_message_sid text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_send_jobs_attempt_check CHECK ((attempt >= 0)),
    CONSTRAINT campaign_send_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed_retryable'::text, 'failed_terminal'::text])))
);


--
-- Name: client_exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_exports (
    id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    client_name text,
    client_number text,
    status text DEFAULT 'pending_qr'::text NOT NULL,
    counts jsonb,
    archive_path text,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ingested_at timestamp with time zone,
    ingest_result jsonb
);


--
-- Name: command_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_receipts (
    restaurant_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    command_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    actor_user_id uuid,
    actor_team_member_id uuid,
    actor_field_staff_account_id uuid,
    status text DEFAULT 'in_progress'::text NOT NULL,
    response jsonb,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT command_receipts_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: conversation_claim_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_claim_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    team_member_id uuid NOT NULL,
    mode text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_by_user_id uuid,
    event_type text DEFAULT 'claim'::text NOT NULL,
    CONSTRAINT conversation_claim_events_event_type_check CHECK ((event_type = ANY (ARRAY['claim'::text, 'reassign'::text, 'force_bot'::text, 'unassign'::text]))),
    CONSTRAINT conversation_claim_events_mode_check CHECK ((mode = ANY (ARRAY['human'::text, 'bot'::text])))
);


--
-- Name: conversation_internal_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_internal_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    author_user_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_internal_notes_body_check CHECK ((char_length(TRIM(BOTH FROM body)) > 0))
);


--
-- Name: conversation_label_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_label_assignments (
    conversation_id uuid NOT NULL,
    label_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by uuid
);


--
-- Name: conversation_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_labels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'slate'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT conversation_labels_color_check CHECK ((color = ANY (ARRAY['slate'::text, 'red'::text, 'amber'::text, 'emerald'::text, 'blue'::text, 'indigo'::text, 'fuchsia'::text, 'rose'::text]))),
    CONSTRAINT conversation_labels_name_not_blank CHECK ((char_length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: customer_satisfaction_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_satisfaction_analyses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    customer_phone text NOT NULL,
    customer_name text,
    score integer NOT NULL,
    sentiment text NOT NULL,
    risk_level text NOT NULL,
    confidence integer NOT NULL,
    summary text NOT NULL,
    strengths jsonb DEFAULT '[]'::jsonb NOT NULL,
    concerns jsonb DEFAULT '[]'::jsonb NOT NULL,
    unanswered_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommended_actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    analysis_mode text NOT NULL,
    source_message_count integer DEFAULT 0 NOT NULL,
    new_message_count integer DEFAULT 0 NOT NULL,
    latest_message_at timestamp with time zone,
    whatsapp_status text DEFAULT 'unknown'::text NOT NULL,
    nehgz_status text DEFAULT 'not_paired'::text NOT NULL,
    input_hash text NOT NULL,
    model text NOT NULL,
    prompt_version text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_satisfaction_analyses_analysis_mode_check CHECK ((analysis_mode = ANY (ARRAY['fresh'::text, 'reanalysis'::text]))),
    CONSTRAINT customer_satisfaction_analyses_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100))),
    CONSTRAINT customer_satisfaction_analyses_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT customer_satisfaction_analyses_score_check CHECK (((score >= 0) AND (score <= 100))),
    CONSTRAINT customer_satisfaction_analyses_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text, 'mixed'::text])))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    phone_number text NOT NULL,
    full_name text,
    source text DEFAULT 'manual'::text NOT NULL,
    source_ref text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    opted_out boolean DEFAULT false NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_phone_e164 CHECK ((phone_number ~ '^\+[1-9]\d{1,14}$'::text)),
    CONSTRAINT customers_source_check CHECK ((source = ANY (ARRAY['rekaz_import'::text, 'manual'::text, 'csv_import'::text, 'conversation'::text])))
);


--
-- Name: dispatch_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_settings (
    restaurant_id uuid NOT NULL,
    full_trip_price numeric(10,2) DEFAULT 0 NOT NULL,
    half_trip_price numeric(10,2) DEFAULT 0 NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: driver_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    specialist_id uuid,
    driver_id uuid,
    arrival_at timestamp with time zone NOT NULL,
    customer_location text NOT NULL,
    customer_phone text NOT NULL,
    duration_minutes integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trip_type text DEFAULT 'one_way'::text NOT NULL,
    price numeric(10,2),
    updated_by uuid,
    version bigint DEFAULT 1 NOT NULL,
    dispatch_state text DEFAULT 'idle'::text NOT NULL,
    active_dispatch_command_id uuid,
    dispatch_started_at timestamp with time zone,
    rekaz_source_id text,
    CONSTRAINT driver_orders_dispatch_state_check CHECK ((dispatch_state = ANY (ARRAY['idle'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'uncertain'::text]))),
    CONSTRAINT driver_orders_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT driver_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT driver_orders_trip_type_check CHECK ((trip_type = ANY (ARRAY['one_way'::text, 'round_trip'::text])))
);


--
-- Name: drivers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: field_location_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_location_checkpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    field_staff_account_id uuid NOT NULL,
    action text NOT NULL,
    latitude double precision,
    longitude double precision,
    accuracy_meters double precision,
    captured_at timestamp with time zone,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'device'::text NOT NULL,
    permission_state text,
    exception_reason text,
    CONSTRAINT field_location_checkpoint_evidence_check CHECK (
CASE source
    WHEN 'device'::text THEN ((latitude IS NOT NULL) AND ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND (longitude IS NOT NULL) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)) AND (accuracy_meters IS NOT NULL) AND (accuracy_meters >= (0)::double precision) AND (captured_at IS NOT NULL))
    WHEN 'manual_exception'::text THEN ((exception_reason IS NOT NULL) AND ((char_length(btrim(exception_reason)) >= 3) AND (char_length(btrim(exception_reason)) <= 500)))
    ELSE false
END),
    CONSTRAINT field_location_checkpoints_action_check CHECK ((action = ANY (ARRAY['confirm_ride'::text, 'confirm_pickup'::text, 'start_service'::text, 'complete_order'::text, 'driver_arrived'::text, 'driver_return'::text]))),
    CONSTRAINT field_location_checkpoints_source_check CHECK ((source = ANY (ARRAY['device'::text, 'manual_exception'::text])))
);


--
-- Name: field_order_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_order_progress (
    order_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    driver_confirmed_at timestamp with time zone,
    specialist_pickup_at timestamp with time zone,
    service_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    last_reminder_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version bigint DEFAULT 1 NOT NULL,
    driver_arrived_at timestamp with time zone,
    driver_returned_at timestamp with time zone,
    CONSTRAINT field_order_progress_sequence_check CHECK ((((specialist_pickup_at IS NULL) OR (driver_confirmed_at IS NOT NULL)) AND ((service_started_at IS NULL) OR (specialist_pickup_at IS NOT NULL)) AND ((completed_at IS NULL) OR (service_started_at IS NOT NULL)) AND ((driver_returned_at IS NULL) OR (completed_at IS NOT NULL)) AND ((driver_arrived_at IS NULL) OR (driver_confirmed_at IS NOT NULL))))
);


--
-- Name: field_staff_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_staff_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    auth_user_id uuid NOT NULL,
    role text NOT NULL,
    specialist_id uuid,
    driver_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    last_app_activity_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_staff_accounts_role_check CHECK ((role = ANY (ARRAY['specialist'::text, 'driver'::text]))),
    CONSTRAINT field_staff_accounts_role_roster_check CHECK ((((role = 'specialist'::text) AND (specialist_id IS NOT NULL) AND (driver_id IS NULL)) OR ((role = 'driver'::text) AND (driver_id IS NOT NULL) AND (specialist_id IS NULL))))
);


--
-- Name: field_staff_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_staff_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    field_staff_account_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    expo_token text NOT NULL,
    device_id text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    disabled_reason text,
    last_error_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_staff_push_tokens_device_check CHECK (((char_length(btrim(device_id)) >= 8) AND (char_length(btrim(device_id)) <= 200))),
    CONSTRAINT field_staff_push_tokens_expo_check CHECK ((expo_token ~ '^ExponentPushToken\[[^]]+\]$|^ExpoPushToken\[[^]]+\]$'::text))
);


--
-- Name: kiara_archive_claim_events_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_claim_events_20260725 (
    id uuid,
    conversation_id uuid,
    restaurant_id uuid,
    team_member_id uuid,
    mode text,
    claimed_at timestamp with time zone,
    claimed_by_user_id uuid,
    event_type text
);


--
-- Name: kiara_archive_conversations_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_conversations_20260725 (
    id uuid,
    restaurant_id uuid,
    customer_phone text,
    customer_name text,
    status text,
    started_at timestamp with time zone,
    last_message_at timestamp with time zone,
    metadata jsonb,
    last_inbound_at timestamp with time zone,
    bot_paused boolean,
    assigned_to uuid,
    assigned_at timestamp with time zone,
    handler_mode text,
    assigned_by_user_id uuid,
    unread_count integer,
    last_read_at timestamp with time zone,
    archived_at timestamp with time zone
);


--
-- Name: kiara_archive_label_assignments_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_label_assignments_20260725 (
    conversation_id uuid,
    label_id uuid,
    assigned_at timestamp with time zone,
    assigned_by uuid
);


--
-- Name: kiara_archive_messages_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_messages_20260725 (
    id uuid,
    conversation_id uuid,
    role text,
    content text,
    message_type text,
    metadata jsonb,
    created_at timestamp with time zone,
    delivery_status text,
    error_message text,
    external_message_sid text,
    twilio_message_sid text,
    twilio_status text,
    external_error_code text,
    channel text,
    sender_team_member_id uuid
);


--
-- Name: kiara_archive_notes_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_notes_20260725 (
    id uuid,
    conversation_id uuid,
    restaurant_id uuid,
    author_user_id uuid,
    body text,
    created_at timestamp with time zone
);


--
-- Name: kiara_archive_orders_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_orders_20260725 (
    id uuid,
    restaurant_id uuid,
    conversation_id uuid,
    customer_phone text,
    customer_name text,
    type text,
    details text,
    status text,
    admin_note text,
    admin_reply text,
    replied_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    priority text,
    escalation_reason text,
    assigned_to uuid,
    claimed_at timestamp with time zone,
    ai_draft_reply text,
    ai_draft_generated_at timestamp with time zone,
    hanan_escalated_at timestamp with time zone,
    rekaz_booking_url text,
    extracted_intent jsonb
);


--
-- Name: kiara_archive_team_members_20260725; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kiara_archive_team_members_20260725 (
    id uuid,
    restaurant_id uuid,
    user_id uuid,
    role text,
    full_name text,
    is_active boolean,
    is_available boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: knowledge_base; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_base (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    title text,
    content text NOT NULL,
    embedding extensions.vector(768),
    source_type text DEFAULT 'manual'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT knowledge_base_source_type_check CHECK ((source_type = ANY (ARRAY['menu'::text, 'manual'::text, 'crawled'::text, 'document'::text])))
);


--
-- Name: knowledge_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    content text NOT NULL,
    embedding extensions.vector(768),
    source_file text,
    chunk_index integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: marketing_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    template_id uuid,
    name text NOT NULL,
    scheduled_at timestamp with time zone,
    audience_file_url text,
    audience_json jsonb,
    total_recipients integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    delivered_count integer DEFAULT 0,
    read_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sending_started_at timestamp with time zone,
    sending_completed_at timestamp with time zone,
    error_message text,
    CONSTRAINT marketing_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'queued'::text, 'scheduled'::text, 'processing'::text, 'sending'::text, 'paused'::text, 'pending_template_approval'::text, 'completed'::text, 'partially_completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: marketing_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name text NOT NULL,
    template_sid text,
    content_type text DEFAULT 'text'::text,
    body_template text NOT NULL,
    header_image_url text,
    buttons jsonb DEFAULT '[]'::jsonb,
    variables jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    language text DEFAULT 'en'::text,
    category text DEFAULT 'MARKETING'::text,
    twilio_content_sid text,
    approval_status text DEFAULT 'draft'::text,
    rejection_reason text,
    footer_text text,
    header_type text DEFAULT 'none'::text,
    header_text text,
    ai_generated boolean DEFAULT false,
    image_asset_url text,
    CONSTRAINT marketing_templates_approval_status_check CHECK ((approval_status = ANY (ARRAY['draft'::text, 'submitted'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'paused'::text, 'disabled'::text]))),
    CONSTRAINT marketing_templates_category_check CHECK ((category = ANY (ARRAY['MARKETING'::text, 'UTILITY'::text, 'AUTHENTICATION'::text]))),
    CONSTRAINT marketing_templates_content_type_check CHECK ((content_type = ANY (ARRAY['text'::text, 'image'::text, 'button'::text, 'list'::text]))),
    CONSTRAINT marketing_templates_header_type_check CHECK ((header_type = ANY (ARRAY['none'::text, 'text'::text, 'image'::text]))),
    CONSTRAINT marketing_templates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name_ar text NOT NULL,
    name_en text,
    description_ar text,
    description_en text,
    price numeric(10,2) NOT NULL,
    discounted_price numeric(10,2),
    currency text DEFAULT 'SAR'::text,
    category text NOT NULL,
    subcategory text,
    image_url text,
    is_available boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    crawled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    message_type text DEFAULT 'text'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    delivery_status text,
    error_message text,
    external_message_sid text,
    twilio_message_sid text,
    twilio_status text,
    external_error_code text,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    sender_team_member_id uuid,
    CONSTRAINT messages_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'agent'::text, 'system'::text])))
);


--
-- Name: meta_ads_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_ads_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    meta_user_id text,
    user_access_token text NOT NULL,
    ad_account_id text,
    ad_account_name text,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    page_id text,
    page_name text,
    page_access_token text,
    instagram_account_id text,
    instagram_username text
);


--
-- Name: nehgz_hub_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nehgz_hub_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    access_token text NOT NULL,
    base_url text NOT NULL,
    merchant_id text,
    merchant_name text,
    merchant_phone text,
    merchant_timezone text,
    merchant_locale text,
    webhook_secret text,
    paired_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: nehgz_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nehgz_webhook_events (
    event_id text NOT NULL,
    restaurant_id uuid NOT NULL,
    merchant_id text,
    event text NOT NULL,
    occurred_at timestamp with time zone,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    process_error text
);


--
-- Name: operation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operation_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_type text NOT NULL,
    actor_role text,
    actor_user_id uuid,
    actor_team_member_id uuid,
    actor_field_staff_account_id uuid,
    idempotency_key uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operation_events_actor_role_check CHECK ((actor_role = ANY (ARRAY['admin'::text, 'agent'::text, 'driver'::text, 'specialist'::text, 'system'::text]))),
    CONSTRAINT operation_events_actor_type_check CHECK ((actor_type = ANY (ARRAY['team_member'::text, 'owner'::text, 'field_staff'::text, 'system'::text])))
);


--
-- Name: opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opt_outs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    phone_number text NOT NULL,
    opted_out_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    reason text DEFAULT 'user_request'::text
);


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    command_id uuid NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    claimed_at timestamp with time zone,
    completed_at timestamp with time zone,
    provider_message_id text,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_events_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT outbox_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'uncertain'::text])))
);


--
-- Name: owner_ai_manager_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_ai_manager_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT owner_ai_manager_messages_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'assistant'::text, 'system'::text])))
);


--
-- Name: owner_ai_manager_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_ai_manager_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    title text,
    status text DEFAULT 'open'::text NOT NULL,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT owner_ai_manager_threads_status_check CHECK ((status = ANY (ARRAY['open'::text, 'archived'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    email text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    expo_push_token text,
    is_super_admin boolean DEFAULT false NOT NULL
);


--
-- Name: provisioning_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provisioning_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    restaurant_id uuid,
    whatsapp_number_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    current_step text DEFAULT 'account_created'::text NOT NULL,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT provisioning_runs_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending_number_assignment'::text, 'pending_embedded_signup'::text, 'pending_sender_registration'::text, 'pending_knowledge_sync'::text, 'active'::text, 'failed'::text])))
);


--
-- Name: push_broadcast_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_broadcast_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    restaurant_id uuid,
    kind text NOT NULL,
    ok boolean NOT NULL,
    sent integer DEFAULT 0 NOT NULL,
    skipped integer DEFAULT 0 NOT NULL,
    invalid integer DEFAULT 0 NOT NULL,
    on_duty_count integer DEFAULT 0 NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    manager_fallback boolean DEFAULT false NOT NULL,
    skipped_reason text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_broadcast_log_kind_check CHECK ((kind = ANY (ARRAY['escalation'::text, 'reservation'::text])))
);


--
-- Name: rekaz_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rekaz_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    sync_run_id uuid NOT NULL,
    source_id text NOT NULL,
    change_type text NOT NULL,
    previous_payload jsonb,
    next_payload jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rekaz_changes_change_type_check CHECK ((change_type = ANY (ARRAY['added'::text, 'updated'::text, 'removed'::text, 'restored'::text])))
);


--
-- Name: rekaz_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rekaz_reservations (
    restaurant_id uuid NOT NULL,
    source_id text NOT NULL,
    source_order_id text,
    payload_hash text NOT NULL,
    arrival_at timestamp with time zone NOT NULL,
    customer_phone text NOT NULL,
    customer_name text DEFAULT ''::text NOT NULL,
    status text DEFAULT ''::text NOT NULL,
    payload jsonb NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    last_sync_run_id uuid
);


--
-- Name: rekaz_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rekaz_sync_runs (
    id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    source text DEFAULT 'rekaz'::text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    actor_user_id uuid,
    actor_team_member_id uuid,
    incoming_count integer DEFAULT 0 NOT NULL,
    added_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    removed_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    error_code text,
    error_message text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT rekaz_sync_runs_source_check CHECK ((source = 'rekaz'::text)),
    CONSTRAINT rekaz_sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: restaurant_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    username public.citext NOT NULL,
    password_hash text NOT NULL,
    full_name text,
    created_by uuid,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: restaurants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    name_ar text,
    logo_url text,
    country text DEFAULT 'SA'::text,
    currency text DEFAULT 'SAR'::text,
    timezone text DEFAULT 'Asia/Riyadh'::text,
    twilio_phone_number text,
    twilio_account_sid text,
    twilio_auth_token text,
    digital_menu_url text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    primary_whatsapp_number_id uuid,
    provisioning_status text DEFAULT 'draft'::text NOT NULL,
    onboarding_completed_at timestamp with time zone,
    activation_started_at timestamp with time zone,
    activated_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    telephone text,
    opening_hours text,
    cuisine text,
    setup_status text DEFAULT 'draft'::text,
    website_url text,
    ai_enabled boolean DEFAULT true NOT NULL,
    ai_schedule_enabled boolean DEFAULT false NOT NULL,
    ai_schedule_start time without time zone DEFAULT '00:00:00'::time without time zone NOT NULL,
    ai_schedule_end time without time zone DEFAULT '23:59:00'::time without time zone NOT NULL,
    ai_schedule_weekend_24h boolean DEFAULT false NOT NULL,
    ai_schedule_timezone text DEFAULT 'Asia/Riyadh'::text NOT NULL,
    CONSTRAINT restaurants_country_check CHECK ((country = ANY (ARRAY['SA'::text, 'EG'::text]))),
    CONSTRAINT restaurants_currency_check CHECK ((currency = ANY (ARRAY['SAR'::text, 'EGP'::text]))),
    CONSTRAINT restaurants_provisioning_status_check CHECK ((provisioning_status = ANY (ARRAY['draft'::text, 'pending_number_assignment'::text, 'pending_embedded_signup'::text, 'pending_sender_registration'::text, 'pending_knowledge_sync'::text, 'active'::text, 'failed'::text])))
);


--
-- Name: saved_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_replies_body_check CHECK ((char_length(TRIM(BOTH FROM body)) > 0)),
    CONSTRAINT saved_replies_title_check CHECK ((char_length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: sla_notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_notification_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    notified_at timestamp with time zone DEFAULT now() NOT NULL,
    notification_type text DEFAULT 'sla_breach'::text NOT NULL
);


--
-- Name: specialists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.specialists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    full_name text NOT NULL,
    phone text,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nationality text
);


--
-- Name: team_member_goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_member_goals (
    team_member_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    target_first_response_sec integer,
    target_messages_per_day integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id uuid,
    CONSTRAINT team_member_goals_target_first_response_sec_check CHECK (((target_first_response_sec IS NULL) OR (target_first_response_sec > 0))),
    CONSTRAINT team_member_goals_target_messages_per_day_check CHECK (((target_messages_per_day IS NULL) OR (target_messages_per_day > 0)))
);


--
-- Name: team_member_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_member_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    team_member_id uuid NOT NULL,
    author_user_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_member_notes_body_check CHECK (((length(body) >= 1) AND (length(body) <= 4000)))
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'agent'::text NOT NULL,
    full_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'agent'::text])))
);


--
-- Name: template_approval_polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_approval_polls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    twilio_content_sid text NOT NULL,
    poll_count integer DEFAULT 0,
    next_poll_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'polling'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT template_approval_polls_status_check CHECK ((status = ANY (ARRAY['polling'::text, 'completed'::text, 'abandoned'::text])))
);


--
-- Name: twilio_status_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.twilio_status_events (
    message_sid text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_member_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    expo_token text NOT NULL,
    device_id text,
    platform text,
    last_seen_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_push_tokens_platform_check CHECK (((platform IS NULL) OR (platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))))
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    message_sid text,
    restaurant_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    processing_time_ms integer,
    error text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: whatsapp_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid,
    phone_number text NOT NULL,
    provider text DEFAULT 'twilio'::text NOT NULL,
    source_type text DEFAULT 'pool'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    assignment_status text DEFAULT 'available'::text NOT NULL,
    onboarding_status text DEFAULT 'unclaimed'::text NOT NULL,
    twilio_subaccount_sid text,
    twilio_messaging_service_sid text,
    twilio_whatsapp_sender_sid text,
    meta_business_account_id text,
    meta_waba_id text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error text,
    assigned_at timestamp with time zone,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT whatsapp_numbers_assignment_status_check CHECK ((assignment_status = ANY (ARRAY['available'::text, 'reserved'::text, 'assigned'::text, 'active'::text, 'suspended'::text, 'released'::text]))),
    CONSTRAINT whatsapp_numbers_onboarding_status_check CHECK ((onboarding_status = ANY (ARRAY['unclaimed'::text, 'pending_embedded_signup'::text, 'pending_sender_registration'::text, 'pending_test'::text, 'active'::text, 'failed'::text]))),
    CONSTRAINT whatsapp_numbers_provider_check CHECK ((provider = 'twilio'::text)),
    CONSTRAINT whatsapp_numbers_source_type_check CHECK ((source_type = ANY (ARRAY['pool'::text, 'customer_owned'::text])))
);


--
-- Name: access_requests access_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_requests
    ADD CONSTRAINT access_requests_pkey PRIMARY KEY (id);


--
-- Name: agent_instructions agent_instructions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_instructions
    ADD CONSTRAINT agent_instructions_pkey PRIMARY KEY (id);


--
-- Name: agent_instructions agent_instructions_restaurant_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_instructions
    ADD CONSTRAINT agent_instructions_restaurant_version_key UNIQUE (restaurant_id, version);


--
-- Name: agent_shifts agent_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_shifts
    ADD CONSTRAINT agent_shifts_pkey PRIMARY KEY (id);


--
-- Name: ai_agents ai_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_pkey PRIMARY KEY (id);


--
-- Name: ai_kill_switch_log ai_kill_switch_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_kill_switch_log
    ADD CONSTRAINT ai_kill_switch_log_pkey PRIMARY KEY (id);


--
-- Name: ai_reply_jobs ai_reply_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reply_jobs
    ADD CONSTRAINT ai_reply_jobs_pkey PRIMARY KEY (id);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: ai_usage ai_usage_restaurant_id_feature_month_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_restaurant_id_feature_month_key_key UNIQUE (restaurant_id, feature, month_key);


--
-- Name: campaign_recipients campaign_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT campaign_recipients_pkey PRIMARY KEY (id);


--
-- Name: campaign_send_jobs campaign_send_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_send_jobs
    ADD CONSTRAINT campaign_send_jobs_pkey PRIMARY KEY (id);


--
-- Name: client_exports client_exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_exports
    ADD CONSTRAINT client_exports_pkey PRIMARY KEY (id);


--
-- Name: command_receipts command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_receipts
    ADD CONSTRAINT command_receipts_pkey PRIMARY KEY (restaurant_id, idempotency_key);


--
-- Name: conversation_claim_events conversation_claim_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_claim_events
    ADD CONSTRAINT conversation_claim_events_pkey PRIMARY KEY (id);


--
-- Name: conversation_internal_notes conversation_internal_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_internal_notes
    ADD CONSTRAINT conversation_internal_notes_pkey PRIMARY KEY (id);


--
-- Name: conversation_label_assignments conversation_label_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_label_assignments
    ADD CONSTRAINT conversation_label_assignments_pkey PRIMARY KEY (conversation_id, label_id);


--
-- Name: conversation_labels conversation_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_pkey PRIMARY KEY (id);


--
-- Name: conversation_labels conversation_labels_restaurant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_restaurant_id_name_key UNIQUE (restaurant_id, name);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: customer_satisfaction_analyses customer_satisfaction_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_satisfaction_analyses
    ADD CONSTRAINT customer_satisfaction_analyses_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: dispatch_settings dispatch_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_settings
    ADD CONSTRAINT dispatch_settings_pkey PRIMARY KEY (restaurant_id);


--
-- Name: driver_orders driver_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_orders
    ADD CONSTRAINT driver_orders_pkey PRIMARY KEY (id);


--
-- Name: drivers drivers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_pkey PRIMARY KEY (id);


--
-- Name: field_location_checkpoints field_location_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_location_checkpoints
    ADD CONSTRAINT field_location_checkpoints_pkey PRIMARY KEY (id);


--
-- Name: field_order_progress field_order_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_order_progress
    ADD CONSTRAINT field_order_progress_pkey PRIMARY KEY (order_id);


--
-- Name: field_staff_accounts field_staff_accounts_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_accounts
    ADD CONSTRAINT field_staff_accounts_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: field_staff_accounts field_staff_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_accounts
    ADD CONSTRAINT field_staff_accounts_pkey PRIMARY KEY (id);


--
-- Name: field_staff_push_tokens field_staff_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_push_tokens
    ADD CONSTRAINT field_staff_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: knowledge_base knowledge_base_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_base
    ADD CONSTRAINT knowledge_base_pkey PRIMARY KEY (id);


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id);


--
-- Name: marketing_campaigns marketing_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_pkey PRIMARY KEY (id);


--
-- Name: marketing_templates marketing_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_templates
    ADD CONSTRAINT marketing_templates_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: meta_ads_connections meta_ads_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_ads_connections
    ADD CONSTRAINT meta_ads_connections_pkey PRIMARY KEY (id);


--
-- Name: meta_ads_connections meta_ads_connections_restaurant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_ads_connections
    ADD CONSTRAINT meta_ads_connections_restaurant_id_key UNIQUE (restaurant_id);


--
-- Name: nehgz_hub_connections nehgz_hub_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nehgz_hub_connections
    ADD CONSTRAINT nehgz_hub_connections_pkey PRIMARY KEY (id);


--
-- Name: nehgz_hub_connections nehgz_hub_connections_restaurant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nehgz_hub_connections
    ADD CONSTRAINT nehgz_hub_connections_restaurant_id_key UNIQUE (restaurant_id);


--
-- Name: nehgz_webhook_events nehgz_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nehgz_webhook_events
    ADD CONSTRAINT nehgz_webhook_events_pkey PRIMARY KEY (event_id);


--
-- Name: operation_events operation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_events
    ADD CONSTRAINT operation_events_pkey PRIMARY KEY (id);


--
-- Name: opt_outs opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_pkey PRIMARY KEY (id);


--
-- Name: opt_outs opt_outs_restaurant_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_restaurant_phone_key UNIQUE (restaurant_id, phone_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_restaurant_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_restaurant_id_idempotency_key_key UNIQUE (restaurant_id, idempotency_key);


--
-- Name: owner_ai_manager_messages owner_ai_manager_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_ai_manager_messages
    ADD CONSTRAINT owner_ai_manager_messages_pkey PRIMARY KEY (id);


--
-- Name: owner_ai_manager_threads owner_ai_manager_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_ai_manager_threads
    ADD CONSTRAINT owner_ai_manager_threads_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: provisioning_runs provisioning_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_runs
    ADD CONSTRAINT provisioning_runs_pkey PRIMARY KEY (id);


--
-- Name: push_broadcast_log push_broadcast_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_broadcast_log
    ADD CONSTRAINT push_broadcast_log_pkey PRIMARY KEY (id);


--
-- Name: rekaz_changes rekaz_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_changes
    ADD CONSTRAINT rekaz_changes_pkey PRIMARY KEY (id);


--
-- Name: rekaz_changes rekaz_changes_sync_run_id_source_id_change_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_changes
    ADD CONSTRAINT rekaz_changes_sync_run_id_source_id_change_type_key UNIQUE (sync_run_id, source_id, change_type);


--
-- Name: rekaz_reservations rekaz_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_reservations
    ADD CONSTRAINT rekaz_reservations_pkey PRIMARY KEY (restaurant_id, source_id);


--
-- Name: rekaz_sync_runs rekaz_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_sync_runs
    ADD CONSTRAINT rekaz_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: rekaz_sync_runs rekaz_sync_runs_restaurant_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_sync_runs
    ADD CONSTRAINT rekaz_sync_runs_restaurant_id_id_key UNIQUE (restaurant_id, id);


--
-- Name: restaurant_members restaurant_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_members
    ADD CONSTRAINT restaurant_members_pkey PRIMARY KEY (id);


--
-- Name: restaurant_members restaurant_members_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_members
    ADD CONSTRAINT restaurant_members_username_key UNIQUE (username);


--
-- Name: restaurants restaurants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);


--
-- Name: restaurants restaurants_twilio_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_twilio_phone_number_key UNIQUE (twilio_phone_number);


--
-- Name: saved_replies saved_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_replies
    ADD CONSTRAINT saved_replies_pkey PRIMARY KEY (id);


--
-- Name: sla_notification_log sla_notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_notification_log
    ADD CONSTRAINT sla_notification_log_pkey PRIMARY KEY (id);


--
-- Name: specialists specialists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialists
    ADD CONSTRAINT specialists_pkey PRIMARY KEY (id);


--
-- Name: team_member_goals team_member_goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_goals
    ADD CONSTRAINT team_member_goals_pkey PRIMARY KEY (team_member_id);


--
-- Name: team_member_notes team_member_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_notes
    ADD CONSTRAINT team_member_notes_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_restaurant_user_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_restaurant_user_key UNIQUE (restaurant_id, user_id);


--
-- Name: template_approval_polls template_approval_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_approval_polls
    ADD CONSTRAINT template_approval_polls_pkey PRIMARY KEY (id);


--
-- Name: twilio_status_events twilio_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.twilio_status_events
    ADD CONSTRAINT twilio_status_events_pkey PRIMARY KEY (message_sid, status);


--
-- Name: user_push_tokens user_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_numbers whatsapp_numbers_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_numbers
    ADD CONSTRAINT whatsapp_numbers_phone_number_key UNIQUE (phone_number);


--
-- Name: whatsapp_numbers whatsapp_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_numbers
    ADD CONSTRAINT whatsapp_numbers_pkey PRIMARY KEY (id);


--
-- Name: agent_instructions_restaurant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_instructions_restaurant_status_idx ON public.agent_instructions USING btree (restaurant_id, status);


--
-- Name: agent_instructions_tags_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_instructions_tags_gin_idx ON public.agent_instructions USING gin (tags);


--
-- Name: agent_shifts_restaurant_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_shifts_restaurant_window_idx ON public.agent_shifts USING btree (restaurant_id, starts_at, ends_at);


--
-- Name: agent_shifts_team_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_shifts_team_member_idx ON public.agent_shifts USING btree (team_member_id, starts_at);


--
-- Name: ai_agents_one_active_per_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_agents_one_active_per_restaurant_idx ON public.ai_agents USING btree (restaurant_id) WHERE is_active;


--
-- Name: ai_kill_switch_log_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_kill_switch_log_restaurant_idx ON public.ai_kill_switch_log USING btree (restaurant_id, created_at DESC);


--
-- Name: ai_reply_jobs_inbound_message_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_reply_jobs_inbound_message_id_key ON public.ai_reply_jobs USING btree (inbound_message_id);


--
-- Name: ai_reply_jobs_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_reply_jobs_status_created_idx ON public.ai_reply_jobs USING btree (status, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'retryable'::text]));


--
-- Name: ai_usage_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_lookup_idx ON public.ai_usage USING btree (restaurant_id, feature, month_key);


--
-- Name: campaign_send_jobs_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_send_jobs_campaign_idx ON public.campaign_send_jobs USING btree (campaign_id);


--
-- Name: campaign_send_jobs_poll_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_send_jobs_poll_idx ON public.campaign_send_jobs USING btree (status, next_run_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed_retryable'::text]));


--
-- Name: campaign_send_jobs_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX campaign_send_jobs_recipient_idx ON public.campaign_send_jobs USING btree (recipient_id);


--
-- Name: claim_events_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_events_conv_idx ON public.conversation_claim_events USING btree (conversation_id, claimed_at DESC);


--
-- Name: claim_events_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX claim_events_restaurant_idx ON public.conversation_claim_events USING btree (restaurant_id, claimed_at DESC);


--
-- Name: client_exports_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_exports_created_at_idx ON public.client_exports USING btree (created_at DESC);


--
-- Name: client_exports_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_exports_restaurant_id_idx ON public.client_exports USING btree (restaurant_id);


--
-- Name: command_receipts_aggregate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX command_receipts_aggregate_idx ON public.command_receipts USING btree (restaurant_id, aggregate_type, aggregate_id, created_at DESC);


--
-- Name: conversation_label_assignments_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_label_assignments_conv_idx ON public.conversation_label_assignments USING btree (conversation_id);


--
-- Name: conversation_label_assignments_label_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_label_assignments_label_idx ON public.conversation_label_assignments USING btree (label_id);


--
-- Name: conversation_labels_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_labels_restaurant_idx ON public.conversation_labels USING btree (restaurant_id, name);


--
-- Name: conversations_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_active_idx ON public.conversations USING btree (restaurant_id, last_message_at DESC) WHERE (archived_at IS NULL);


--
-- Name: conversations_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_assigned_to_idx ON public.conversations USING btree (assigned_to);


--
-- Name: conversations_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_assignee_idx ON public.conversations USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);


--
-- Name: conversations_handler_mode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_handler_mode_idx ON public.conversations USING btree (restaurant_id, handler_mode);


--
-- Name: conversations_restaurant_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_restaurant_assigned_idx ON public.conversations USING btree (restaurant_id, assigned_to);


--
-- Name: conversations_restaurant_last_inbound_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_restaurant_last_inbound_idx ON public.conversations USING btree (restaurant_id, last_inbound_at DESC NULLS LAST);


--
-- Name: conversations_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_unread_idx ON public.conversations USING btree (restaurant_id, last_message_at DESC) WHERE (unread_count > 0);


--
-- Name: customer_satisfaction_conversation_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_satisfaction_conversation_created_idx ON public.customer_satisfaction_analyses USING btree (conversation_id, created_at DESC);


--
-- Name: customer_satisfaction_input_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_satisfaction_input_hash_idx ON public.customer_satisfaction_analyses USING btree (conversation_id, input_hash);


--
-- Name: customer_satisfaction_restaurant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_satisfaction_restaurant_created_idx ON public.customer_satisfaction_analyses USING btree (restaurant_id, created_at DESC);


--
-- Name: customers_restaurant_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_restaurant_last_seen_idx ON public.customers USING btree (restaurant_id, last_seen_at DESC NULLS LAST);


--
-- Name: customers_restaurant_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_restaurant_phone_idx ON public.customers USING btree (restaurant_id, phone_number);


--
-- Name: driver_orders_active_dispatch_command_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX driver_orders_active_dispatch_command_key ON public.driver_orders USING btree (active_dispatch_command_id) WHERE (active_dispatch_command_id IS NOT NULL);


--
-- Name: driver_orders_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_orders_conversation_idx ON public.driver_orders USING btree (conversation_id);


--
-- Name: driver_orders_rekaz_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_orders_rekaz_lookup_idx ON public.driver_orders USING btree (restaurant_id, arrival_at) WHERE (rekaz_source_id IS NOT NULL);


--
-- Name: driver_orders_rekaz_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX driver_orders_rekaz_source_key ON public.driver_orders USING btree (restaurant_id, rekaz_source_id) WHERE (rekaz_source_id IS NOT NULL);


--
-- Name: driver_orders_restaurant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_orders_restaurant_created_idx ON public.driver_orders USING btree (restaurant_id, created_at DESC);


--
-- Name: drivers_restaurant_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX drivers_restaurant_active_idx ON public.drivers USING btree (restaurant_id) WHERE is_active;


--
-- Name: field_location_checkpoints_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_location_checkpoints_order_idx ON public.field_location_checkpoints USING btree (restaurant_id, order_id, received_at DESC);


--
-- Name: field_order_progress_pending_reminders_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_order_progress_pending_reminders_idx ON public.field_order_progress USING btree (last_activity_at) WHERE (driver_returned_at IS NULL);


--
-- Name: field_staff_accounts_auth_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_staff_accounts_auth_active_idx ON public.field_staff_accounts USING btree (auth_user_id) WHERE (is_active = true);


--
-- Name: field_staff_accounts_driver_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX field_staff_accounts_driver_key ON public.field_staff_accounts USING btree (driver_id) WHERE (driver_id IS NOT NULL);


--
-- Name: field_staff_accounts_specialist_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX field_staff_accounts_specialist_key ON public.field_staff_accounts USING btree (specialist_id) WHERE (specialist_id IS NOT NULL);


--
-- Name: field_staff_push_tokens_account_device_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX field_staff_push_tokens_account_device_key ON public.field_staff_push_tokens USING btree (field_staff_account_id, device_id);


--
-- Name: field_staff_push_tokens_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_staff_push_tokens_active_idx ON public.field_staff_push_tokens USING btree (field_staff_account_id) WHERE (disabled = false);


--
-- Name: field_staff_push_tokens_expo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX field_staff_push_tokens_expo_key ON public.field_staff_push_tokens USING btree (expo_token);


--
-- Name: idx_ai_agents_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_agents_restaurant ON public.ai_agents USING btree (restaurant_id);


--
-- Name: idx_campaign_recipients_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_recipients_campaign ON public.campaign_recipients USING btree (campaign_id);


--
-- Name: idx_campaigns_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_restaurant ON public.marketing_campaigns USING btree (restaurant_id);


--
-- Name: idx_cin_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cin_conversation ON public.conversation_internal_notes USING btree (conversation_id, created_at);


--
-- Name: idx_conversations_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_phone ON public.conversations USING btree (customer_phone);


--
-- Name: idx_conversations_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_restaurant ON public.conversations USING btree (restaurant_id);


--
-- Name: idx_conversations_restaurant_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_restaurant_last_message ON public.conversations USING btree (restaurant_id, last_message_at DESC);


--
-- Name: idx_knowledge_base_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_base_restaurant ON public.knowledge_base USING btree (restaurant_id);


--
-- Name: idx_marketing_campaigns_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_campaigns_scheduled ON public.marketing_campaigns USING btree (restaurant_id, scheduled_at) WHERE (scheduled_at IS NOT NULL);


--
-- Name: idx_marketing_templates_approval_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_templates_approval_status ON public.marketing_templates USING btree (restaurant_id, approval_status);


--
-- Name: idx_marketing_templates_content_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_templates_content_sid ON public.marketing_templates USING btree (twilio_content_sid) WHERE (twilio_content_sid IS NOT NULL);


--
-- Name: idx_marketing_templates_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_templates_restaurant ON public.marketing_templates USING btree (restaurant_id);


--
-- Name: idx_menu_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_category ON public.menu_items USING btree (restaurant_id, category);


--
-- Name: idx_menu_items_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_menu_items_restaurant ON public.menu_items USING btree (restaurant_id);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);


--
-- Name: idx_messages_conversation_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_created ON public.messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created ON public.messages USING btree (created_at);


--
-- Name: idx_restaurants_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_owner ON public.restaurants USING btree (owner_id);


--
-- Name: idx_saved_replies_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_replies_restaurant ON public.saved_replies USING btree (restaurant_id);


--
-- Name: idx_template_approval_polls_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_approval_polls_active ON public.template_approval_polls USING btree (status, next_poll_at) WHERE (status = 'polling'::text);


--
-- Name: idx_template_approval_polls_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_approval_polls_due ON public.template_approval_polls USING btree (status, next_poll_at);


--
-- Name: idx_template_approval_polls_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_approval_polls_template ON public.template_approval_polls USING btree (template_id);


--
-- Name: knowledge_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_embedding_idx ON public.knowledge_chunks USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists='100');


--
-- Name: knowledge_chunks_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_restaurant_id_idx ON public.knowledge_chunks USING btree (restaurant_id);


--
-- Name: messages_external_message_sid_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_external_message_sid_key ON public.messages USING btree (external_message_sid) WHERE (external_message_sid IS NOT NULL);


--
-- Name: messages_sender_team_member_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_sender_team_member_id_idx ON public.messages USING btree (sender_team_member_id) WHERE (sender_team_member_id IS NOT NULL);


--
-- Name: messages_twilio_message_sid_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_twilio_message_sid_key ON public.messages USING btree (twilio_message_sid) WHERE (twilio_message_sid IS NOT NULL);


--
-- Name: nehgz_webhook_events_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nehgz_webhook_events_event_idx ON public.nehgz_webhook_events USING btree (event, received_at DESC);


--
-- Name: nehgz_webhook_events_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nehgz_webhook_events_restaurant_idx ON public.nehgz_webhook_events USING btree (restaurant_id, received_at DESC);


--
-- Name: operation_events_actor_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operation_events_actor_timeline_idx ON public.operation_events USING btree (restaurant_id, actor_team_member_id, occurred_at DESC) WHERE (actor_team_member_id IS NOT NULL);


--
-- Name: operation_events_aggregate_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operation_events_aggregate_timeline_idx ON public.operation_events USING btree (restaurant_id, aggregate_type, aggregate_id, occurred_at DESC);


--
-- Name: operation_events_command_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX operation_events_command_type_key ON public.operation_events USING btree (restaurant_id, idempotency_key, event_type) WHERE (idempotency_key IS NOT NULL);


--
-- Name: opt_outs_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opt_outs_phone_idx ON public.opt_outs USING btree (phone_number);


--
-- Name: orders_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_assigned_to_idx ON public.orders USING btree (assigned_to);


--
-- Name: orders_assigned_to_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_assigned_to_status_idx ON public.orders USING btree (assigned_to, status) WHERE (assigned_to IS NOT NULL);


--
-- Name: orders_conversation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_conversation_id_idx ON public.orders USING btree (conversation_id);


--
-- Name: orders_priority_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_priority_idx ON public.orders USING btree (priority);


--
-- Name: orders_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_restaurant_id_idx ON public.orders USING btree (restaurant_id);


--
-- Name: orders_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_status_idx ON public.orders USING btree (status);


--
-- Name: orders_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_type_idx ON public.orders USING btree (type);


--
-- Name: orders_unclaimed_escalations_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_unclaimed_escalations_idx ON public.orders USING btree (restaurant_id, created_at) WHERE ((type = 'escalation'::text) AND (assigned_to IS NULL));


--
-- Name: outbox_events_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_events_pending_idx ON public.outbox_events USING btree (restaurant_id, created_at) WHERE (status = 'pending'::text);


--
-- Name: owner_ai_manager_messages_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX owner_ai_manager_messages_thread_created_idx ON public.owner_ai_manager_messages USING btree (thread_id, created_at);


--
-- Name: owner_ai_manager_threads_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX owner_ai_manager_threads_owner_idx ON public.owner_ai_manager_threads USING btree (owner_user_id);


--
-- Name: owner_ai_manager_threads_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX owner_ai_manager_threads_restaurant_idx ON public.owner_ai_manager_threads USING btree (restaurant_id, last_message_at DESC NULLS LAST);


--
-- Name: provisioning_runs_owner_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provisioning_runs_owner_id_idx ON public.provisioning_runs USING btree (owner_id);


--
-- Name: provisioning_runs_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provisioning_runs_restaurant_id_idx ON public.provisioning_runs USING btree (restaurant_id);


--
-- Name: provisioning_runs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provisioning_runs_status_idx ON public.provisioning_runs USING btree (status);


--
-- Name: provisioning_runs_whatsapp_number_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX provisioning_runs_whatsapp_number_id_idx ON public.provisioning_runs USING btree (whatsapp_number_id);


--
-- Name: push_broadcast_log_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_broadcast_log_order_idx ON public.push_broadcast_log USING btree (order_id, created_at DESC);


--
-- Name: push_broadcast_log_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_broadcast_log_restaurant_idx ON public.push_broadcast_log USING btree (restaurant_id, created_at DESC);


--
-- Name: rekaz_changes_tenant_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rekaz_changes_tenant_timeline_idx ON public.rekaz_changes USING btree (restaurant_id, changed_at DESC);


--
-- Name: rekaz_reservations_calendar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rekaz_reservations_calendar_idx ON public.rekaz_reservations USING btree (restaurant_id, arrival_at) WHERE (removed_at IS NULL);


--
-- Name: rekaz_reservations_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rekaz_reservations_customer_idx ON public.rekaz_reservations USING btree (restaurant_id, customer_phone, arrival_at DESC);


--
-- Name: rekaz_sync_runs_tenant_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rekaz_sync_runs_tenant_started_idx ON public.rekaz_sync_runs USING btree (restaurant_id, started_at DESC);


--
-- Name: restaurant_members_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX restaurant_members_restaurant_id_idx ON public.restaurant_members USING btree (restaurant_id);


--
-- Name: restaurants_primary_whatsapp_number_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX restaurants_primary_whatsapp_number_id_key ON public.restaurants USING btree (primary_whatsapp_number_id) WHERE (primary_whatsapp_number_id IS NOT NULL);


--
-- Name: sla_notification_log_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sla_notification_log_conv_idx ON public.sla_notification_log USING btree (conversation_id, notified_at DESC);


--
-- Name: sla_notification_log_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sla_notification_log_restaurant_idx ON public.sla_notification_log USING btree (restaurant_id, notified_at DESC);


--
-- Name: specialists_restaurant_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX specialists_restaurant_active_idx ON public.specialists USING btree (restaurant_id) WHERE is_active;


--
-- Name: team_member_goals_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_member_goals_restaurant_idx ON public.team_member_goals USING btree (restaurant_id);


--
-- Name: team_member_notes_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_member_notes_restaurant_idx ON public.team_member_notes USING btree (restaurant_id, created_at DESC);


--
-- Name: team_member_notes_tm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_member_notes_tm_idx ON public.team_member_notes USING btree (team_member_id, created_at DESC);


--
-- Name: team_members_available_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_members_available_idx ON public.team_members USING btree (restaurant_id, is_active, is_available) WHERE (is_active AND is_available);


--
-- Name: team_members_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_members_restaurant_id_idx ON public.team_members USING btree (restaurant_id);


--
-- Name: team_members_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX team_members_user_id_idx ON public.team_members USING btree (user_id);


--
-- Name: user_push_tokens_expo_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_push_tokens_expo_token_key ON public.user_push_tokens USING btree (expo_token) WHERE (disabled = false);


--
-- Name: user_push_tokens_member_device_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_push_tokens_member_device_key ON public.user_push_tokens USING btree (team_member_id, device_id) WHERE (device_id IS NOT NULL);


--
-- Name: user_push_tokens_restaurant_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_push_tokens_restaurant_active_idx ON public.user_push_tokens USING btree (restaurant_id) WHERE (disabled = false);


--
-- Name: webhook_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_events_created_at_idx ON public.webhook_events USING btree (created_at);


--
-- Name: webhook_events_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_events_restaurant_id_idx ON public.webhook_events USING btree (restaurant_id);


--
-- Name: whatsapp_numbers_assignment_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_numbers_assignment_status_idx ON public.whatsapp_numbers USING btree (assignment_status);


--
-- Name: whatsapp_numbers_onboarding_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_numbers_onboarding_status_idx ON public.whatsapp_numbers USING btree (onboarding_status);


--
-- Name: whatsapp_numbers_primary_per_restaurant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_numbers_primary_per_restaurant_idx ON public.whatsapp_numbers USING btree (restaurant_id) WHERE is_primary;


--
-- Name: whatsapp_numbers_restaurant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_numbers_restaurant_id_idx ON public.whatsapp_numbers USING btree (restaurant_id);


--
-- Name: whatsapp_numbers_twilio_subaccount_sid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_numbers_twilio_subaccount_sid_idx ON public.whatsapp_numbers USING btree (twilio_subaccount_sid);


--
-- Name: agent_instructions agent_instructions_assign_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_instructions_assign_version BEFORE INSERT ON public.agent_instructions FOR EACH ROW EXECUTE FUNCTION public.assign_agent_instruction_version();


--
-- Name: messages increment_unread_on_visible_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER increment_unread_on_visible_message AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.tg_increment_unread_on_visible_message();


--
-- Name: opt_outs opt_outs_sync_customers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER opt_outs_sync_customers AFTER INSERT OR DELETE ON public.opt_outs FOR EACH ROW EXECUTE FUNCTION public.sync_opt_out_to_customers();


--
-- Name: orders orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_orders_updated_at();


--
-- Name: owner_ai_manager_threads owner_ai_manager_threads_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER owner_ai_manager_threads_set_updated_at BEFORE UPDATE ON public.owner_ai_manager_threads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();


--
-- Name: restaurant_members restaurant_members_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER restaurant_members_set_updated_at BEFORE UPDATE ON public.restaurant_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();


--
-- Name: provisioning_runs set_provisioning_runs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_provisioning_runs_updated_at BEFORE UPDATE ON public.provisioning_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();


--
-- Name: team_members set_team_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_team_members_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();


--
-- Name: ai_reply_jobs set_updated_at_ai_reply_jobs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_ai_reply_jobs BEFORE UPDATE ON public.ai_reply_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: whatsapp_numbers set_whatsapp_numbers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_whatsapp_numbers_updated_at BEFORE UPDATE ON public.whatsapp_numbers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();


--
-- Name: command_receipts touch_command_receipts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_command_receipts_updated_at BEFORE UPDATE ON public.command_receipts FOR EACH ROW EXECUTE FUNCTION kiara_private.tg_touch_operational_updated_at();


--
-- Name: field_order_progress touch_field_order_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_field_order_progress_updated_at BEFORE UPDATE ON public.field_order_progress FOR EACH ROW EXECUTE FUNCTION kiara_private.tg_touch_field_workflow_updated_at();


--
-- Name: field_staff_accounts touch_field_staff_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_field_staff_accounts_updated_at BEFORE UPDATE ON public.field_staff_accounts FOR EACH ROW EXECUTE FUNCTION kiara_private.tg_touch_field_workflow_updated_at();


--
-- Name: field_staff_push_tokens touch_field_staff_push_tokens_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_field_staff_push_tokens_updated_at BEFORE UPDATE ON public.field_staff_push_tokens FOR EACH ROW EXECUTE FUNCTION kiara_private.tg_touch_field_workflow_updated_at();


--
-- Name: outbox_events touch_outbox_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_outbox_events_updated_at BEFORE UPDATE ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION kiara_private.tg_touch_operational_updated_at();


--
-- Name: ai_agents update_ai_agents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_agents_updated_at BEFORE UPDATE ON public.ai_agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: marketing_campaigns update_campaigns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.marketing_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: knowledge_base update_knowledge_base_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_knowledge_base_updated_at BEFORE UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: menu_items update_menu_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: restaurants update_restaurants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: marketing_templates update_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.marketing_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: agent_instructions agent_instructions_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_instructions
    ADD CONSTRAINT agent_instructions_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_instructions agent_instructions_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_instructions
    ADD CONSTRAINT agent_instructions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: agent_instructions agent_instructions_source_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_instructions
    ADD CONSTRAINT agent_instructions_source_thread_id_fkey FOREIGN KEY (source_thread_id) REFERENCES public.owner_ai_manager_threads(id) ON DELETE SET NULL;


--
-- Name: agent_instructions agent_instructions_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_instructions
    ADD CONSTRAINT agent_instructions_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.agent_instructions(id) ON DELETE SET NULL;


--
-- Name: agent_shifts agent_shifts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_shifts
    ADD CONSTRAINT agent_shifts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_shifts agent_shifts_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_shifts
    ADD CONSTRAINT agent_shifts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: agent_shifts agent_shifts_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_shifts
    ADD CONSTRAINT agent_shifts_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: ai_agents ai_agents_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agents
    ADD CONSTRAINT ai_agents_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: ai_kill_switch_log ai_kill_switch_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_kill_switch_log
    ADD CONSTRAINT ai_kill_switch_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);


--
-- Name: ai_kill_switch_log ai_kill_switch_log_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_kill_switch_log
    ADD CONSTRAINT ai_kill_switch_log_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: ai_reply_jobs ai_reply_jobs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reply_jobs
    ADD CONSTRAINT ai_reply_jobs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: ai_reply_jobs ai_reply_jobs_inbound_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reply_jobs
    ADD CONSTRAINT ai_reply_jobs_inbound_message_id_fkey FOREIGN KEY (inbound_message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: ai_reply_jobs ai_reply_jobs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_reply_jobs
    ADD CONSTRAINT ai_reply_jobs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: ai_usage ai_usage_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: campaign_recipients campaign_recipients_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_recipients
    ADD CONSTRAINT campaign_recipients_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_send_jobs campaign_send_jobs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_send_jobs
    ADD CONSTRAINT campaign_send_jobs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_send_jobs campaign_send_jobs_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_send_jobs
    ADD CONSTRAINT campaign_send_jobs_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.campaign_recipients(id) ON DELETE CASCADE;


--
-- Name: client_exports client_exports_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_exports
    ADD CONSTRAINT client_exports_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: command_receipts command_receipts_actor_field_staff_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_receipts
    ADD CONSTRAINT command_receipts_actor_field_staff_account_id_fkey FOREIGN KEY (actor_field_staff_account_id) REFERENCES public.field_staff_accounts(id) ON DELETE SET NULL;


--
-- Name: command_receipts command_receipts_actor_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_receipts
    ADD CONSTRAINT command_receipts_actor_team_member_id_fkey FOREIGN KEY (actor_team_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: command_receipts command_receipts_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_receipts
    ADD CONSTRAINT command_receipts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: conversation_claim_events conversation_claim_events_claimed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_claim_events
    ADD CONSTRAINT conversation_claim_events_claimed_by_user_id_fkey FOREIGN KEY (claimed_by_user_id) REFERENCES auth.users(id);


--
-- Name: conversation_claim_events conversation_claim_events_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_claim_events
    ADD CONSTRAINT conversation_claim_events_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_claim_events conversation_claim_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_claim_events
    ADD CONSTRAINT conversation_claim_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: conversation_claim_events conversation_claim_events_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_claim_events
    ADD CONSTRAINT conversation_claim_events_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id);


--
-- Name: conversation_internal_notes conversation_internal_notes_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_internal_notes
    ADD CONSTRAINT conversation_internal_notes_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id);


--
-- Name: conversation_internal_notes conversation_internal_notes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_internal_notes
    ADD CONSTRAINT conversation_internal_notes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_internal_notes conversation_internal_notes_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_internal_notes
    ADD CONSTRAINT conversation_internal_notes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: conversation_label_assignments conversation_label_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_label_assignments
    ADD CONSTRAINT conversation_label_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);


--
-- Name: conversation_label_assignments conversation_label_assignments_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_label_assignments
    ADD CONSTRAINT conversation_label_assignments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_label_assignments conversation_label_assignments_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_label_assignments
    ADD CONSTRAINT conversation_label_assignments_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.conversation_labels(id) ON DELETE CASCADE;


--
-- Name: conversation_labels conversation_labels_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: conversation_labels conversation_labels_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_labels
    ADD CONSTRAINT conversation_labels_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_assigned_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_assigned_by_user_id_fkey FOREIGN KEY (assigned_by_user_id) REFERENCES auth.users(id);


--
-- Name: conversations conversations_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: customer_satisfaction_analyses customer_satisfaction_analyses_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_satisfaction_analyses
    ADD CONSTRAINT customer_satisfaction_analyses_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: customer_satisfaction_analyses customer_satisfaction_analyses_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_satisfaction_analyses
    ADD CONSTRAINT customer_satisfaction_analyses_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: customers customers_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: dispatch_settings dispatch_settings_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_settings
    ADD CONSTRAINT dispatch_settings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: driver_orders driver_orders_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_orders
    ADD CONSTRAINT driver_orders_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: driver_orders driver_orders_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_orders
    ADD CONSTRAINT driver_orders_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;


--
-- Name: driver_orders driver_orders_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_orders
    ADD CONSTRAINT driver_orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: driver_orders driver_orders_specialist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_orders
    ADD CONSTRAINT driver_orders_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES public.specialists(id) ON DELETE SET NULL;


--
-- Name: driver_orders driver_orders_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_orders
    ADD CONSTRAINT driver_orders_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.team_members(id);


--
-- Name: drivers drivers_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drivers
    ADD CONSTRAINT drivers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: field_location_checkpoints field_location_checkpoints_field_staff_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_location_checkpoints
    ADD CONSTRAINT field_location_checkpoints_field_staff_account_id_fkey FOREIGN KEY (field_staff_account_id) REFERENCES public.field_staff_accounts(id) ON DELETE RESTRICT;


--
-- Name: field_location_checkpoints field_location_checkpoints_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_location_checkpoints
    ADD CONSTRAINT field_location_checkpoints_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.driver_orders(id) ON DELETE CASCADE;


--
-- Name: field_location_checkpoints field_location_checkpoints_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_location_checkpoints
    ADD CONSTRAINT field_location_checkpoints_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: field_order_progress field_order_progress_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_order_progress
    ADD CONSTRAINT field_order_progress_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.driver_orders(id) ON DELETE CASCADE;


--
-- Name: field_order_progress field_order_progress_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_order_progress
    ADD CONSTRAINT field_order_progress_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: field_staff_accounts field_staff_accounts_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_accounts
    ADD CONSTRAINT field_staff_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: field_staff_accounts field_staff_accounts_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_accounts
    ADD CONSTRAINT field_staff_accounts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE CASCADE;


--
-- Name: field_staff_accounts field_staff_accounts_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_accounts
    ADD CONSTRAINT field_staff_accounts_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: field_staff_accounts field_staff_accounts_specialist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_accounts
    ADD CONSTRAINT field_staff_accounts_specialist_id_fkey FOREIGN KEY (specialist_id) REFERENCES public.specialists(id) ON DELETE CASCADE;


--
-- Name: field_staff_push_tokens field_staff_push_tokens_field_staff_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_push_tokens
    ADD CONSTRAINT field_staff_push_tokens_field_staff_account_id_fkey FOREIGN KEY (field_staff_account_id) REFERENCES public.field_staff_accounts(id) ON DELETE CASCADE;


--
-- Name: field_staff_push_tokens field_staff_push_tokens_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_staff_push_tokens
    ADD CONSTRAINT field_staff_push_tokens_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: knowledge_base knowledge_base_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_base
    ADD CONSTRAINT knowledge_base_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: knowledge_chunks knowledge_chunks_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: marketing_campaigns marketing_campaigns_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: marketing_campaigns marketing_campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.marketing_templates(id) ON DELETE SET NULL;


--
-- Name: marketing_templates marketing_templates_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_templates
    ADD CONSTRAINT marketing_templates_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_team_member_id_fkey FOREIGN KEY (sender_team_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: meta_ads_connections meta_ads_connections_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_ads_connections
    ADD CONSTRAINT meta_ads_connections_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: nehgz_hub_connections nehgz_hub_connections_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nehgz_hub_connections
    ADD CONSTRAINT nehgz_hub_connections_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: nehgz_webhook_events nehgz_webhook_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nehgz_webhook_events
    ADD CONSTRAINT nehgz_webhook_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: operation_events operation_events_actor_field_staff_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_events
    ADD CONSTRAINT operation_events_actor_field_staff_account_id_fkey FOREIGN KEY (actor_field_staff_account_id) REFERENCES public.field_staff_accounts(id) ON DELETE SET NULL;


--
-- Name: operation_events operation_events_actor_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_events
    ADD CONSTRAINT operation_events_actor_team_member_id_fkey FOREIGN KEY (actor_team_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: operation_events operation_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operation_events
    ADD CONSTRAINT operation_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: opt_outs opt_outs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: orders orders_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: orders orders_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: orders orders_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: outbox_events outbox_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: owner_ai_manager_messages owner_ai_manager_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_ai_manager_messages
    ADD CONSTRAINT owner_ai_manager_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.owner_ai_manager_threads(id) ON DELETE CASCADE;


--
-- Name: owner_ai_manager_threads owner_ai_manager_threads_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_ai_manager_threads
    ADD CONSTRAINT owner_ai_manager_threads_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: owner_ai_manager_threads owner_ai_manager_threads_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_ai_manager_threads
    ADD CONSTRAINT owner_ai_manager_threads_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: provisioning_runs provisioning_runs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_runs
    ADD CONSTRAINT provisioning_runs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: provisioning_runs provisioning_runs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_runs
    ADD CONSTRAINT provisioning_runs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: provisioning_runs provisioning_runs_whatsapp_number_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_runs
    ADD CONSTRAINT provisioning_runs_whatsapp_number_id_fkey FOREIGN KEY (whatsapp_number_id) REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;


--
-- Name: push_broadcast_log push_broadcast_log_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_broadcast_log
    ADD CONSTRAINT push_broadcast_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: rekaz_changes rekaz_changes_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_changes
    ADD CONSTRAINT rekaz_changes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: rekaz_changes rekaz_changes_sync_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_changes
    ADD CONSTRAINT rekaz_changes_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES public.rekaz_sync_runs(id) ON DELETE CASCADE;


--
-- Name: rekaz_reservations rekaz_reservations_last_sync_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_reservations
    ADD CONSTRAINT rekaz_reservations_last_sync_run_id_fkey FOREIGN KEY (last_sync_run_id) REFERENCES public.rekaz_sync_runs(id) ON DELETE SET NULL;


--
-- Name: rekaz_reservations rekaz_reservations_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_reservations
    ADD CONSTRAINT rekaz_reservations_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: rekaz_sync_runs rekaz_sync_runs_actor_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_sync_runs
    ADD CONSTRAINT rekaz_sync_runs_actor_team_member_id_fkey FOREIGN KEY (actor_team_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: rekaz_sync_runs rekaz_sync_runs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rekaz_sync_runs
    ADD CONSTRAINT rekaz_sync_runs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurant_members restaurant_members_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_members
    ADD CONSTRAINT restaurant_members_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: restaurant_members restaurant_members_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_members
    ADD CONSTRAINT restaurant_members_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurants restaurants_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: restaurants restaurants_primary_whatsapp_number_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_primary_whatsapp_number_id_fkey FOREIGN KEY (primary_whatsapp_number_id) REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL;


--
-- Name: saved_replies saved_replies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_replies
    ADD CONSTRAINT saved_replies_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: saved_replies saved_replies_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_replies
    ADD CONSTRAINT saved_replies_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: sla_notification_log sla_notification_log_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_notification_log
    ADD CONSTRAINT sla_notification_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: sla_notification_log sla_notification_log_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_notification_log
    ADD CONSTRAINT sla_notification_log_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: specialists specialists_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.specialists
    ADD CONSTRAINT specialists_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: team_member_goals team_member_goals_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_goals
    ADD CONSTRAINT team_member_goals_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: team_member_goals team_member_goals_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_goals
    ADD CONSTRAINT team_member_goals_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: team_member_goals team_member_goals_updated_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_goals
    ADD CONSTRAINT team_member_goals_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: team_member_notes team_member_notes_author_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_notes
    ADD CONSTRAINT team_member_notes_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: team_member_notes team_member_notes_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_notes
    ADD CONSTRAINT team_member_notes_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: team_member_notes team_member_notes_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_member_notes
    ADD CONSTRAINT team_member_notes_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: team_members team_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: template_approval_polls template_approval_polls_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_approval_polls
    ADD CONSTRAINT template_approval_polls_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: template_approval_polls template_approval_polls_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_approval_polls
    ADD CONSTRAINT template_approval_polls_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.marketing_templates(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: user_push_tokens user_push_tokens_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_push_tokens
    ADD CONSTRAINT user_push_tokens_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: whatsapp_numbers whatsapp_numbers_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_numbers
    ADD CONSTRAINT whatsapp_numbers_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE SET NULL;


--
-- Name: restaurants Owners can create restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can create restaurants" ON public.restaurants FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: restaurants Owners can delete own restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can delete own restaurants" ON public.restaurants FOR DELETE USING ((auth.uid() = owner_id));


--
-- Name: ai_agents Owners can manage ai agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage ai agents" ON public.ai_agents USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: marketing_campaigns Owners can manage campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage campaigns" ON public.marketing_campaigns USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: knowledge_base Owners can manage knowledge base; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage knowledge base" ON public.knowledge_base USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: menu_items Owners can manage menu items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage menu items" ON public.menu_items USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: campaign_recipients Owners can manage recipients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage recipients" ON public.campaign_recipients USING ((campaign_id IN ( SELECT mc.id
   FROM (public.marketing_campaigns mc
     JOIN public.restaurants r ON ((mc.restaurant_id = r.id)))
  WHERE (r.owner_id = auth.uid()))));


--
-- Name: marketing_templates Owners can manage templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can manage templates" ON public.marketing_templates USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: orders Owners can update orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update orders" ON public.orders FOR UPDATE USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid())))) WITH CHECK ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: restaurants Owners can update own restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update own restaurants" ON public.restaurants FOR UPDATE USING ((auth.uid() = owner_id));


--
-- Name: conversations Owners can view conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can view conversations" ON public.conversations USING ((restaurant_id IN ( SELECT r.id
   FROM public.restaurants r
  WHERE (r.owner_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: messages Owners can view messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can view messages" ON public.messages USING ((conversation_id IN ( SELECT c.id
   FROM (public.conversations c
     JOIN public.restaurants r ON ((c.restaurant_id = r.id)))
  WHERE (r.owner_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: orders Owners can view orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can view orders" ON public.orders FOR SELECT USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: restaurants Owners can view own restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can view own restaurants" ON public.restaurants FOR SELECT USING ((auth.uid() = owner_id));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: access_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_instructions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_instructions ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_instructions agent_instructions_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_instructions_owner_all ON public.agent_instructions USING (public.is_restaurant_owner(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: agent_instructions agent_instructions_select_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_instructions_select_members ON public.agent_instructions FOR SELECT USING (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: agent_shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_shifts agent_shifts_delete_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_shifts_delete_owner ON public.agent_shifts FOR DELETE USING (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: agent_shifts agent_shifts_insert_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_shifts_insert_owner ON public.agent_shifts FOR INSERT WITH CHECK (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: agent_shifts agent_shifts_select_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_shifts_select_members ON public.agent_shifts FOR SELECT USING (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: agent_shifts agent_shifts_update_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_shifts_update_owner ON public.agent_shifts FOR UPDATE USING (public.is_restaurant_owner(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: ai_agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_kill_switch_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_kill_switch_log ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_kill_switch_log ai_kill_switch_log_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_kill_switch_log_select_admin ON public.ai_kill_switch_log FOR SELECT USING (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: ai_reply_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_reply_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_send_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_send_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_send_jobs campaign_send_jobs_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_send_jobs_select_admin ON public.campaign_send_jobs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.marketing_campaigns c
  WHERE ((c.id = campaign_send_jobs.campaign_id) AND public.is_restaurant_admin(c.restaurant_id, auth.uid())))));


--
-- Name: conversation_internal_notes cin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cin_insert ON public.conversation_internal_notes FOR INSERT WITH CHECK (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: conversation_internal_notes cin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cin_select ON public.conversation_internal_notes FOR SELECT USING (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: conversation_label_assignments cla_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cla_delete ON public.conversation_label_assignments FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversation_label_assignments.conversation_id) AND public.is_restaurant_member(c.restaurant_id, auth.uid())))));


--
-- Name: conversation_label_assignments cla_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cla_insert ON public.conversation_label_assignments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversation_label_assignments.conversation_id) AND public.is_restaurant_member(c.restaurant_id, auth.uid())))));


--
-- Name: conversation_label_assignments cla_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cla_select ON public.conversation_label_assignments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.conversations c
  WHERE ((c.id = conversation_label_assignments.conversation_id) AND public.is_restaurant_member(c.restaurant_id, auth.uid())))));


--
-- Name: conversation_claim_events claim_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY claim_events_read ON public.conversation_claim_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.restaurant_id = conversation_claim_events.restaurant_id) AND (tm.user_id = auth.uid()) AND (tm.is_active = true)))));


--
-- Name: client_exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_exports ENABLE ROW LEVEL SECURITY;

--
-- Name: command_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.command_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_claim_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_claim_events ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_internal_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_internal_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_label_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_label_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_labels conversation_labels_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_labels_delete ON public.conversation_labels FOR DELETE USING (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: conversation_labels conversation_labels_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_labels_insert ON public.conversation_labels FOR INSERT WITH CHECK (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: conversation_labels conversation_labels_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_labels_select ON public.conversation_labels FOR SELECT USING (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: conversation_labels conversation_labels_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversation_labels_update ON public.conversation_labels FOR UPDATE USING (public.is_restaurant_member(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_select_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_select_members ON public.conversations FOR SELECT USING (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: conversations conversations_update_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_update_members ON public.conversations FOR UPDATE USING (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: customer_satisfaction_analyses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_satisfaction_analyses ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_select_admin ON public.customers FOR SELECT USING (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: customers customers_upsert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_upsert_admin ON public.customers USING (public.is_restaurant_admin(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: dispatch_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dispatch_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: dispatch_settings dispatch_settings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dispatch_settings_insert ON public.dispatch_settings FOR INSERT WITH CHECK (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: dispatch_settings dispatch_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dispatch_settings_select ON public.dispatch_settings FOR SELECT USING (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: dispatch_settings dispatch_settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dispatch_settings_update ON public.dispatch_settings FOR UPDATE USING (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: driver_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_orders driver_orders_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_orders_insert ON public.driver_orders FOR INSERT WITH CHECK (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: driver_orders driver_orders_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_orders_select ON public.driver_orders FOR SELECT USING (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: driver_orders driver_orders_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_orders_update ON public.driver_orders FOR UPDATE USING (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: drivers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

--
-- Name: drivers drivers_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY drivers_delete ON public.drivers FOR DELETE USING (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: drivers drivers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY drivers_insert ON public.drivers FOR INSERT WITH CHECK (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: drivers drivers_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY drivers_select ON public.drivers FOR SELECT USING (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: drivers drivers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY drivers_update ON public.drivers FOR UPDATE USING (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: field_location_checkpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_location_checkpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: field_order_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_order_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: field_staff_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_staff_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: field_staff_push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_staff_push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_claim_events_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_claim_events_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_conversations_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_conversations_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_label_assignments_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_label_assignments_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_messages_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_messages_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_notes_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_notes_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_orders_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_orders_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: kiara_archive_team_members_20260725; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kiara_archive_team_members_20260725 ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_base; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_chunks knowledge_chunks_select_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_chunks_select_members ON public.knowledge_chunks FOR SELECT USING (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: marketing_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_select_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select_members ON public.messages FOR SELECT USING (public.can_access_conversation(conversation_id, ( SELECT auth.uid() AS uid)));


--
-- Name: meta_ads_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_ads_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: nehgz_hub_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nehgz_hub_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: nehgz_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nehgz_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: operation_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operation_events ENABLE ROW LEVEL SECURITY;

--
-- Name: opt_outs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opt_outs ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: outbox_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_ai_manager_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_ai_manager_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_ai_manager_messages owner_ai_manager_messages_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_ai_manager_messages_owner_all ON public.owner_ai_manager_messages USING ((EXISTS ( SELECT 1
   FROM public.owner_ai_manager_threads t
  WHERE ((t.id = owner_ai_manager_messages.thread_id) AND ((t.owner_user_id = auth.uid()) OR public.is_restaurant_owner(t.restaurant_id, auth.uid())))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.owner_ai_manager_threads t
  WHERE ((t.id = owner_ai_manager_messages.thread_id) AND ((t.owner_user_id = auth.uid()) OR public.is_restaurant_owner(t.restaurant_id, auth.uid()))))));


--
-- Name: owner_ai_manager_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_ai_manager_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_ai_manager_threads owner_ai_manager_threads_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_ai_manager_threads_owner_all ON public.owner_ai_manager_threads USING (((owner_user_id = auth.uid()) OR public.is_restaurant_owner(restaurant_id, auth.uid()))) WITH CHECK (((owner_user_id = auth.uid()) OR public.is_restaurant_owner(restaurant_id, auth.uid())));


--
-- Name: provisioning_runs owners_can_manage_their_provisioning_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owners_can_manage_their_provisioning_runs ON public.provisioning_runs USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: opt_outs owners_can_view_opt_outs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owners_can_view_opt_outs ON public.opt_outs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.restaurants
  WHERE ((restaurants.id = opt_outs.restaurant_id) AND (restaurants.owner_id = auth.uid())))));


--
-- Name: whatsapp_numbers owners_can_view_their_restaurant_numbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owners_can_view_their_restaurant_numbers ON public.whatsapp_numbers FOR SELECT USING (((restaurant_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.restaurants
  WHERE ((restaurants.id = whatsapp_numbers.restaurant_id) AND (restaurants.owner_id = auth.uid()))))));


--
-- Name: template_approval_polls owners_can_view_their_template_polls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owners_can_view_their_template_polls ON public.template_approval_polls FOR SELECT USING ((restaurant_id IN ( SELECT restaurants.id
   FROM public.restaurants
  WHERE (restaurants.owner_id = auth.uid()))));


--
-- Name: webhook_events owners_can_view_webhook_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owners_can_view_webhook_events ON public.webhook_events FOR SELECT USING (((restaurant_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.restaurants
  WHERE ((restaurants.id = webhook_events.restaurant_id) AND (restaurants.owner_id = auth.uid()))))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: provisioning_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.provisioning_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: push_broadcast_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_broadcast_log ENABLE ROW LEVEL SECURITY;

--
-- Name: push_broadcast_log push_broadcast_log_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_broadcast_log_select_admin ON public.push_broadcast_log FOR SELECT USING (((restaurant_id IS NOT NULL) AND public.is_restaurant_admin(restaurant_id, auth.uid())));


--
-- Name: rekaz_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rekaz_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: rekaz_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rekaz_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: rekaz_sync_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rekaz_sync_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants restaurants_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY restaurants_update_admin ON public.restaurants FOR UPDATE USING (public.is_restaurant_admin(id, auth.uid())) WITH CHECK (public.is_restaurant_admin(id, auth.uid()));


--
-- Name: saved_replies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_replies ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_replies saved_replies_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_replies_all ON public.saved_replies USING (public.is_restaurant_member(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: saved_replies saved_replies_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_replies_select ON public.saved_replies FOR SELECT USING (public.is_restaurant_member(restaurant_id, auth.uid()));


--
-- Name: sla_notification_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sla_notification_log ENABLE ROW LEVEL SECURITY;

--
-- Name: sla_notification_log sla_notification_log_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sla_notification_log_select_admin ON public.sla_notification_log FOR SELECT USING (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: specialists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.specialists ENABLE ROW LEVEL SECURITY;

--
-- Name: specialists specialists_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY specialists_delete ON public.specialists FOR DELETE USING (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: specialists specialists_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY specialists_insert ON public.specialists FOR INSERT WITH CHECK (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: specialists specialists_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY specialists_select ON public.specialists FOR SELECT USING (public.is_restaurant_member(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: specialists specialists_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY specialists_update ON public.specialists FOR UPDATE USING (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid))) WITH CHECK (public.is_restaurant_admin(restaurant_id, ( SELECT auth.uid() AS uid)));


--
-- Name: team_member_goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_member_goals ENABLE ROW LEVEL SECURITY;

--
-- Name: team_member_goals team_member_goals_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_member_goals_select_admin ON public.team_member_goals FOR SELECT USING (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: team_member_goals team_member_goals_upsert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_member_goals_upsert_admin ON public.team_member_goals USING (public.is_restaurant_admin(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: team_member_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_member_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: team_member_notes team_member_notes_delete_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_member_notes_delete_self ON public.team_member_notes FOR DELETE USING ((public.is_restaurant_admin(restaurant_id, auth.uid()) AND ((author_user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.restaurants r
  WHERE ((r.id = team_member_notes.restaurant_id) AND (r.owner_id = auth.uid())))))));


--
-- Name: team_member_notes team_member_notes_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_member_notes_insert_admin ON public.team_member_notes FOR INSERT WITH CHECK ((public.is_restaurant_admin(restaurant_id, auth.uid()) AND (author_user_id = auth.uid())));


--
-- Name: team_member_notes team_member_notes_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_member_notes_select_admin ON public.team_member_notes FOR SELECT USING (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members team_members_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_admin_update ON public.team_members FOR UPDATE USING (public.is_restaurant_admin(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_admin(restaurant_id, auth.uid()));


--
-- Name: orders team_members_can_view_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_can_view_orders ON public.orders FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.restaurant_id = orders.restaurant_id) AND (tm.user_id = auth.uid()) AND (tm.is_active = true)))));


--
-- Name: team_members team_members_owner_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_owner_delete ON public.team_members FOR DELETE USING (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: team_members team_members_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_owner_insert ON public.team_members FOR INSERT WITH CHECK (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: team_members team_members_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_owner_update ON public.team_members FOR UPDATE USING (public.is_restaurant_owner(restaurant_id, auth.uid())) WITH CHECK (public.is_restaurant_owner(restaurant_id, auth.uid()));


--
-- Name: team_members team_members_select_self_admin_or_owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_members_select_self_admin_or_owner ON public.team_members FOR SELECT USING (((user_id = auth.uid()) OR public.is_restaurant_admin(restaurant_id, auth.uid())));


--
-- Name: template_approval_polls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.template_approval_polls ENABLE ROW LEVEL SECURITY;

--
-- Name: user_push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: user_push_tokens user_push_tokens_delete_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_push_tokens_delete_self ON public.user_push_tokens FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.id = user_push_tokens.team_member_id) AND (tm.user_id = auth.uid())))));


--
-- Name: user_push_tokens user_push_tokens_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_push_tokens_insert_self ON public.user_push_tokens FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.id = user_push_tokens.team_member_id) AND (tm.user_id = auth.uid()) AND (tm.restaurant_id = user_push_tokens.restaurant_id) AND (tm.is_active = true)))));


--
-- Name: user_push_tokens user_push_tokens_select_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_push_tokens_select_self ON public.user_push_tokens FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.id = user_push_tokens.team_member_id) AND (tm.user_id = auth.uid())))) OR public.is_restaurant_owner(restaurant_id, auth.uid())));


--
-- Name: user_push_tokens user_push_tokens_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_push_tokens_update_self ON public.user_push_tokens FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.id = user_push_tokens.team_member_id) AND (tm.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.team_members tm
  WHERE ((tm.id = user_push_tokens.team_member_id) AND (tm.user_id = auth.uid())))));


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_numbers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_numbers ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION call_kiara_endpoint(path text, method text); Type: ACL; Schema: kiara_private; Owner: -
--

REVOKE ALL ON FUNCTION kiara_private.call_kiara_endpoint(path text, method text) FROM PUBLIC;


--
-- Name: FUNCTION enqueue_field_reminders(); Type: ACL; Schema: kiara_private; Owner: -
--

REVOKE ALL ON FUNCTION kiara_private.enqueue_field_reminders() FROM PUBLIC;
GRANT ALL ON FUNCTION kiara_private.enqueue_field_reminders() TO service_role;


--
-- Name: FUNCTION get_secret(name text); Type: ACL; Schema: kiara_private; Owner: -
--

REVOKE ALL ON FUNCTION kiara_private.get_secret(name text) FROM PUBLIC;


--
-- Name: FUNCTION tg_touch_field_workflow_updated_at(); Type: ACL; Schema: kiara_private; Owner: -
--

REVOKE ALL ON FUNCTION kiara_private.tg_touch_field_workflow_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION tg_touch_operational_updated_at(); Type: ACL; Schema: kiara_private; Owner: -
--

REVOKE ALL ON FUNCTION kiara_private.tg_touch_operational_updated_at() FROM PUBLIC;


--
-- Name: FUNCTION agent_performance_detail(p_restaurant_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.agent_performance_detail(p_restaurant_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.agent_performance_detail(p_restaurant_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.agent_performance_detail(p_restaurant_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.agent_performance_detail(p_restaurant_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;


--
-- Name: FUNCTION assign_agent_instruction_version(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.assign_agent_instruction_version() TO anon;
GRANT ALL ON FUNCTION public.assign_agent_instruction_version() TO authenticated;
GRANT ALL ON FUNCTION public.assign_agent_instruction_version() TO service_role;


--
-- Name: FUNCTION auto_resolve_stale_conversations(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.auto_resolve_stale_conversations() TO anon;
GRANT ALL ON FUNCTION public.auto_resolve_stale_conversations() TO authenticated;
GRANT ALL ON FUNCTION public.auto_resolve_stale_conversations() TO service_role;


--
-- Name: FUNCTION can_access_conversation(p_conversation_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_access_conversation(p_conversation_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_access_conversation(p_conversation_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_conversation(p_conversation_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION claim_campaign_send_jobs(p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_campaign_send_jobs(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.claim_campaign_send_jobs(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.claim_campaign_send_jobs(p_limit integer) TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: FUNCTION claim_conversation(p_conversation_id uuid, p_mode text, p_team_member_id uuid, p_force boolean, p_assign_to_team_member_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_conversation(p_conversation_id uuid, p_mode text, p_team_member_id uuid, p_force boolean, p_assign_to_team_member_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_conversation(p_conversation_id uuid, p_mode text, p_team_member_id uuid, p_force boolean, p_assign_to_team_member_id uuid) TO anon;
GRANT ALL ON FUNCTION public.claim_conversation(p_conversation_id uuid, p_mode text, p_team_member_id uuid, p_force boolean, p_assign_to_team_member_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_conversation(p_conversation_id uuid, p_mode text, p_team_member_id uuid, p_force boolean, p_assign_to_team_member_id uuid) TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: FUNCTION claim_escalation(p_order_id uuid, p_team_member_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_escalation(p_order_id uuid, p_team_member_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_escalation(p_order_id uuid, p_team_member_id uuid) TO anon;
GRANT ALL ON FUNCTION public.claim_escalation(p_order_id uuid, p_team_member_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.claim_escalation(p_order_id uuid, p_team_member_id uuid) TO service_role;


--
-- Name: FUNCTION current_on_duty_agents(p_restaurant_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_on_duty_agents(p_restaurant_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_on_duty_agents(p_restaurant_id uuid) TO anon;
GRANT ALL ON FUNCTION public.current_on_duty_agents(p_restaurant_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.current_on_duty_agents(p_restaurant_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_restaurant_admin(p_restaurant_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_restaurant_member(p_restaurant_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_restaurant_member(p_restaurant_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_restaurant_member(p_restaurant_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_restaurant_member(p_restaurant_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_restaurant_member(p_restaurant_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION kiara_apply_rekaz_snapshot(p_restaurant_id uuid, p_sync_run_id uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_rows jsonb, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_actor_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kiara_apply_rekaz_snapshot(p_restaurant_id uuid, p_sync_run_id uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_rows jsonb, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_actor_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kiara_apply_rekaz_snapshot(p_restaurant_id uuid, p_sync_run_id uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_rows jsonb, p_window_start timestamp with time zone, p_window_end timestamp with time zone, p_actor_role text) TO service_role;


--
-- Name: FUNCTION kiara_claim_outbox_event(p_restaurant_id uuid, p_command_id uuid, p_event_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kiara_claim_outbox_event(p_restaurant_id uuid, p_command_id uuid, p_event_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kiara_claim_outbox_event(p_restaurant_id uuid, p_command_id uuid, p_event_id uuid) TO service_role;


--
-- Name: FUNCTION kiara_command_field_order_step(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_field_staff_account_id uuid, p_role text, p_roster_id uuid, p_action text, p_location jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kiara_command_field_order_step(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_field_staff_account_id uuid, p_role text, p_roster_id uuid, p_action text, p_location jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kiara_command_field_order_step(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_field_staff_account_id uuid, p_role text, p_roster_id uuid, p_action text, p_location jsonb) TO service_role;


--
-- Name: FUNCTION kiara_command_finish_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_command_id uuid, p_driver_sent boolean, p_specialist_sent boolean, p_driver_error text, p_specialist_error text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kiara_command_finish_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_command_id uuid, p_driver_sent boolean, p_specialist_sent boolean, p_driver_error text, p_specialist_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kiara_command_finish_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_command_id uuid, p_driver_sent boolean, p_specialist_sent boolean, p_driver_error text, p_specialist_error text) TO service_role;


--
-- Name: FUNCTION kiara_command_prepare_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_specialist_id uuid, p_driver_id uuid, p_trip_type text, p_price numeric, p_driver_phone text, p_driver_message text, p_specialist_phone text, p_specialist_message text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kiara_command_prepare_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_specialist_id uuid, p_driver_id uuid, p_trip_type text, p_price numeric, p_driver_phone text, p_driver_message text, p_specialist_phone text, p_specialist_message text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kiara_command_prepare_order_dispatch(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_specialist_id uuid, p_driver_id uuid, p_trip_type text, p_price numeric, p_driver_phone text, p_driver_message text, p_specialist_phone text, p_specialist_message text) TO service_role;


--
-- Name: FUNCTION kiara_command_update_driver_order(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_patch jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kiara_command_update_driver_order(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_patch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kiara_command_update_driver_order(p_restaurant_id uuid, p_order_id uuid, p_expected_version bigint, p_idempotency_key uuid, p_actor_user_id uuid, p_actor_team_member_id uuid, p_actor_role text, p_patch jsonb) TO service_role;


--
-- Name: FUNCTION match_knowledge_base(query_embedding extensions.vector, match_threshold double precision, match_count integer, p_restaurant_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_threshold double precision, match_count integer, p_restaurant_id uuid) TO anon;
GRANT ALL ON FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_threshold double precision, match_count integer, p_restaurant_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_threshold double precision, match_count integer, p_restaurant_id uuid) TO service_role;


--
-- Name: FUNCTION match_knowledge_base(query_embedding extensions.vector, match_restaurant_id uuid, match_threshold double precision, match_count integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_restaurant_id uuid, match_threshold double precision, match_count integer) TO anon;
GRANT ALL ON FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_restaurant_id uuid, match_threshold double precision, match_count integer) TO authenticated;
GRANT ALL ON FUNCTION public.match_knowledge_base(query_embedding extensions.vector, match_restaurant_id uuid, match_threshold double precision, match_count integer) TO service_role;


--
-- Name: FUNCTION match_knowledge_chunks(query_embedding extensions.vector, match_restaurant_id uuid, match_count integer, match_threshold double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_knowledge_chunks(query_embedding extensions.vector, match_restaurant_id uuid, match_count integer, match_threshold double precision) TO anon;
GRANT ALL ON FUNCTION public.match_knowledge_chunks(query_embedding extensions.vector, match_restaurant_id uuid, match_count integer, match_threshold double precision) TO authenticated;
GRANT ALL ON FUNCTION public.match_knowledge_chunks(query_embedding extensions.vector, match_restaurant_id uuid, match_count integer, match_threshold double precision) TO service_role;


--
-- Name: FUNCTION mobile_inbox_list(p_restaurant_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer) TO service_role;


--
-- Name: FUNCTION mobile_inbox_list(p_restaurant_id uuid, p_limit integer, p_include_archived boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer, p_include_archived boolean) TO anon;
GRANT ALL ON FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer, p_include_archived boolean) TO authenticated;
GRANT ALL ON FUNCTION public.mobile_inbox_list(p_restaurant_id uuid, p_limit integer, p_include_archived boolean) TO service_role;


--
-- Name: FUNCTION recompute_campaign_counts(p_campaign_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.recompute_campaign_counts(p_campaign_id uuid) TO anon;
GRANT ALL ON FUNCTION public.recompute_campaign_counts(p_campaign_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.recompute_campaign_counts(p_campaign_id uuid) TO service_role;


--
-- Name: FUNCTION restaurant_kpis_today(p_restaurant_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.restaurant_kpis_today(p_restaurant_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.restaurant_kpis_today(p_restaurant_id uuid) TO anon;
GRANT ALL ON FUNCTION public.restaurant_kpis_today(p_restaurant_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.restaurant_kpis_today(p_restaurant_id uuid) TO service_role;


--
-- Name: FUNCTION set_orders_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_orders_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_orders_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_orders_updated_at() TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION set_updated_at_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at_timestamp() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at_timestamp() TO service_role;


--
-- Name: FUNCTION sync_opt_out_to_customers(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_opt_out_to_customers() TO anon;
GRANT ALL ON FUNCTION public.sync_opt_out_to_customers() TO authenticated;
GRANT ALL ON FUNCTION public.sync_opt_out_to_customers() TO service_role;


--
-- Name: FUNCTION team_performance(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.team_performance(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.team_performance(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.team_performance(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.team_performance(p_restaurant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;


--
-- Name: FUNCTION tg_increment_unread_on_customer_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tg_increment_unread_on_customer_message() TO anon;
GRANT ALL ON FUNCTION public.tg_increment_unread_on_customer_message() TO authenticated;
GRANT ALL ON FUNCTION public.tg_increment_unread_on_customer_message() TO service_role;


--
-- Name: FUNCTION tg_increment_unread_on_visible_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tg_increment_unread_on_visible_message() TO anon;
GRANT ALL ON FUNCTION public.tg_increment_unread_on_visible_message() TO authenticated;
GRANT ALL ON FUNCTION public.tg_increment_unread_on_visible_message() TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: TABLE access_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.access_requests TO anon;
GRANT ALL ON TABLE public.access_requests TO authenticated;
GRANT ALL ON TABLE public.access_requests TO service_role;


--
-- Name: TABLE agent_instructions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_instructions TO anon;
GRANT ALL ON TABLE public.agent_instructions TO authenticated;
GRANT ALL ON TABLE public.agent_instructions TO service_role;


--
-- Name: TABLE agent_shifts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_shifts TO anon;
GRANT ALL ON TABLE public.agent_shifts TO authenticated;
GRANT ALL ON TABLE public.agent_shifts TO service_role;


--
-- Name: TABLE ai_agents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_agents TO anon;
GRANT ALL ON TABLE public.ai_agents TO authenticated;
GRANT ALL ON TABLE public.ai_agents TO service_role;


--
-- Name: TABLE ai_kill_switch_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_kill_switch_log TO anon;
GRANT ALL ON TABLE public.ai_kill_switch_log TO authenticated;
GRANT ALL ON TABLE public.ai_kill_switch_log TO service_role;


--
-- Name: TABLE ai_reply_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_reply_jobs TO anon;
GRANT ALL ON TABLE public.ai_reply_jobs TO authenticated;
GRANT ALL ON TABLE public.ai_reply_jobs TO service_role;


--
-- Name: TABLE ai_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_usage TO anon;
GRANT ALL ON TABLE public.ai_usage TO authenticated;
GRANT ALL ON TABLE public.ai_usage TO service_role;


--
-- Name: TABLE campaign_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.campaign_recipients TO anon;
GRANT ALL ON TABLE public.campaign_recipients TO authenticated;
GRANT ALL ON TABLE public.campaign_recipients TO service_role;


--
-- Name: TABLE campaign_send_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.campaign_send_jobs TO anon;
GRANT ALL ON TABLE public.campaign_send_jobs TO authenticated;
GRANT ALL ON TABLE public.campaign_send_jobs TO service_role;


--
-- Name: TABLE client_exports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_exports TO anon;
GRANT ALL ON TABLE public.client_exports TO authenticated;
GRANT ALL ON TABLE public.client_exports TO service_role;


--
-- Name: TABLE command_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.command_receipts TO service_role;


--
-- Name: TABLE conversation_claim_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_claim_events TO anon;
GRANT ALL ON TABLE public.conversation_claim_events TO authenticated;
GRANT ALL ON TABLE public.conversation_claim_events TO service_role;


--
-- Name: TABLE conversation_internal_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_internal_notes TO anon;
GRANT ALL ON TABLE public.conversation_internal_notes TO authenticated;
GRANT ALL ON TABLE public.conversation_internal_notes TO service_role;


--
-- Name: TABLE conversation_label_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_label_assignments TO anon;
GRANT ALL ON TABLE public.conversation_label_assignments TO authenticated;
GRANT ALL ON TABLE public.conversation_label_assignments TO service_role;


--
-- Name: TABLE conversation_labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_labels TO anon;
GRANT ALL ON TABLE public.conversation_labels TO authenticated;
GRANT ALL ON TABLE public.conversation_labels TO service_role;


--
-- Name: TABLE customer_satisfaction_analyses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customer_satisfaction_analyses TO anon;
GRANT ALL ON TABLE public.customer_satisfaction_analyses TO authenticated;
GRANT ALL ON TABLE public.customer_satisfaction_analyses TO service_role;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- Name: TABLE dispatch_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dispatch_settings TO anon;
GRANT ALL ON TABLE public.dispatch_settings TO authenticated;
GRANT ALL ON TABLE public.dispatch_settings TO service_role;


--
-- Name: TABLE driver_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.driver_orders TO anon;
GRANT ALL ON TABLE public.driver_orders TO authenticated;
GRANT ALL ON TABLE public.driver_orders TO service_role;


--
-- Name: TABLE drivers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.drivers TO anon;
GRANT ALL ON TABLE public.drivers TO authenticated;
GRANT ALL ON TABLE public.drivers TO service_role;


--
-- Name: TABLE field_location_checkpoints; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_location_checkpoints TO service_role;


--
-- Name: TABLE field_order_progress; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_order_progress TO service_role;


--
-- Name: TABLE field_staff_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_staff_accounts TO service_role;


--
-- Name: TABLE field_staff_push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_staff_push_tokens TO service_role;


--
-- Name: TABLE kiara_archive_claim_events_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_claim_events_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_claim_events_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_claim_events_20260725 TO service_role;


--
-- Name: TABLE kiara_archive_conversations_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_conversations_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_conversations_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_conversations_20260725 TO service_role;


--
-- Name: TABLE kiara_archive_label_assignments_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_label_assignments_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_label_assignments_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_label_assignments_20260725 TO service_role;


--
-- Name: TABLE kiara_archive_messages_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_messages_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_messages_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_messages_20260725 TO service_role;


--
-- Name: TABLE kiara_archive_notes_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_notes_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_notes_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_notes_20260725 TO service_role;


--
-- Name: TABLE kiara_archive_orders_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_orders_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_orders_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_orders_20260725 TO service_role;


--
-- Name: TABLE kiara_archive_team_members_20260725; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kiara_archive_team_members_20260725 TO anon;
GRANT ALL ON TABLE public.kiara_archive_team_members_20260725 TO authenticated;
GRANT ALL ON TABLE public.kiara_archive_team_members_20260725 TO service_role;


--
-- Name: TABLE knowledge_base; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.knowledge_base TO anon;
GRANT ALL ON TABLE public.knowledge_base TO authenticated;
GRANT ALL ON TABLE public.knowledge_base TO service_role;


--
-- Name: TABLE knowledge_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.knowledge_chunks TO anon;
GRANT ALL ON TABLE public.knowledge_chunks TO authenticated;
GRANT ALL ON TABLE public.knowledge_chunks TO service_role;


--
-- Name: TABLE marketing_campaigns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.marketing_campaigns TO anon;
GRANT ALL ON TABLE public.marketing_campaigns TO authenticated;
GRANT ALL ON TABLE public.marketing_campaigns TO service_role;


--
-- Name: TABLE marketing_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.marketing_templates TO anon;
GRANT ALL ON TABLE public.marketing_templates TO authenticated;
GRANT ALL ON TABLE public.marketing_templates TO service_role;


--
-- Name: TABLE menu_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.menu_items TO anon;
GRANT ALL ON TABLE public.menu_items TO authenticated;
GRANT ALL ON TABLE public.menu_items TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE meta_ads_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meta_ads_connections TO anon;
GRANT ALL ON TABLE public.meta_ads_connections TO authenticated;
GRANT ALL ON TABLE public.meta_ads_connections TO service_role;


--
-- Name: TABLE nehgz_hub_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nehgz_hub_connections TO anon;
GRANT ALL ON TABLE public.nehgz_hub_connections TO authenticated;
GRANT ALL ON TABLE public.nehgz_hub_connections TO service_role;


--
-- Name: TABLE nehgz_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nehgz_webhook_events TO anon;
GRANT ALL ON TABLE public.nehgz_webhook_events TO authenticated;
GRANT ALL ON TABLE public.nehgz_webhook_events TO service_role;


--
-- Name: TABLE operation_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.operation_events TO service_role;


--
-- Name: TABLE opt_outs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.opt_outs TO anon;
GRANT ALL ON TABLE public.opt_outs TO authenticated;
GRANT ALL ON TABLE public.opt_outs TO service_role;


--
-- Name: TABLE outbox_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.outbox_events TO service_role;


--
-- Name: TABLE owner_ai_manager_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.owner_ai_manager_messages TO anon;
GRANT ALL ON TABLE public.owner_ai_manager_messages TO authenticated;
GRANT ALL ON TABLE public.owner_ai_manager_messages TO service_role;


--
-- Name: TABLE owner_ai_manager_threads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.owner_ai_manager_threads TO anon;
GRANT ALL ON TABLE public.owner_ai_manager_threads TO authenticated;
GRANT ALL ON TABLE public.owner_ai_manager_threads TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE provisioning_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.provisioning_runs TO anon;
GRANT ALL ON TABLE public.provisioning_runs TO authenticated;
GRANT ALL ON TABLE public.provisioning_runs TO service_role;


--
-- Name: TABLE push_broadcast_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_broadcast_log TO anon;
GRANT ALL ON TABLE public.push_broadcast_log TO authenticated;
GRANT ALL ON TABLE public.push_broadcast_log TO service_role;


--
-- Name: TABLE rekaz_changes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rekaz_changes TO service_role;


--
-- Name: TABLE rekaz_reservations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rekaz_reservations TO service_role;


--
-- Name: TABLE rekaz_sync_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rekaz_sync_runs TO service_role;


--
-- Name: TABLE restaurant_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.restaurant_members TO anon;
GRANT ALL ON TABLE public.restaurant_members TO authenticated;
GRANT ALL ON TABLE public.restaurant_members TO service_role;


--
-- Name: TABLE restaurants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.restaurants TO anon;
GRANT ALL ON TABLE public.restaurants TO authenticated;
GRANT ALL ON TABLE public.restaurants TO service_role;


--
-- Name: TABLE saved_replies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.saved_replies TO anon;
GRANT ALL ON TABLE public.saved_replies TO authenticated;
GRANT ALL ON TABLE public.saved_replies TO service_role;


--
-- Name: TABLE sla_notification_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sla_notification_log TO anon;
GRANT ALL ON TABLE public.sla_notification_log TO authenticated;
GRANT ALL ON TABLE public.sla_notification_log TO service_role;


--
-- Name: TABLE specialists; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.specialists TO anon;
GRANT ALL ON TABLE public.specialists TO authenticated;
GRANT ALL ON TABLE public.specialists TO service_role;


--
-- Name: TABLE team_member_goals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_member_goals TO anon;
GRANT ALL ON TABLE public.team_member_goals TO authenticated;
GRANT ALL ON TABLE public.team_member_goals TO service_role;


--
-- Name: TABLE team_member_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_member_notes TO anon;
GRANT ALL ON TABLE public.team_member_notes TO authenticated;
GRANT ALL ON TABLE public.team_member_notes TO service_role;


--
-- Name: TABLE team_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_members TO anon;
GRANT ALL ON TABLE public.team_members TO authenticated;
GRANT ALL ON TABLE public.team_members TO service_role;


--
-- Name: TABLE template_approval_polls; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.template_approval_polls TO anon;
GRANT ALL ON TABLE public.template_approval_polls TO authenticated;
GRANT ALL ON TABLE public.template_approval_polls TO service_role;


--
-- Name: TABLE twilio_status_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.twilio_status_events TO anon;
GRANT ALL ON TABLE public.twilio_status_events TO authenticated;
GRANT ALL ON TABLE public.twilio_status_events TO service_role;


--
-- Name: TABLE user_push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_push_tokens TO anon;
GRANT ALL ON TABLE public.user_push_tokens TO authenticated;
GRANT ALL ON TABLE public.user_push_tokens TO service_role;


--
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.webhook_events TO anon;
GRANT ALL ON TABLE public.webhook_events TO authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;


--
-- Name: TABLE whatsapp_numbers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_numbers TO anon;
GRANT ALL ON TABLE public.whatsapp_numbers TO authenticated;
GRANT ALL ON TABLE public.whatsapp_numbers TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 4cOa3fMr0LWSwDpqIii7NOpVUTo6zIaWfrhIyfQzg1mGWYth70tkkYyag0pBDVo

