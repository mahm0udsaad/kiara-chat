-- Capture what actually happened at close-out, separately from the dispatch
-- instructions written before the visit. A completed workflow step can mean
-- either that the service was carried out or that the team closed the visit
-- without carrying it out; the optional note explains exceptions to the owner.
alter table public.field_order_progress
  add column if not exists completion_outcome text,
  add column if not exists completion_note text,
  add column if not exists completion_recorded_by uuid
    references public.field_staff_accounts(id) on delete set null;

create schema if not exists kiara_private;
revoke all on schema kiara_private from public, anon, authenticated;

-- A phone on the previous build still calls the v1 command. Give that path
-- the historical meaning (`done`) so rolling deployment never blocks a field
-- specialist from closing her visit.
create or replace function kiara_private.tg_default_completion_outcome()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.completed_at is not null and new.completion_outcome is null then
    new.completion_outcome := 'done';
  end if;
  return new;
end;
$$;

revoke all on function kiara_private.tg_default_completion_outcome()
  from public, anon, authenticated;

drop trigger if exists default_field_order_completion_outcome
  on public.field_order_progress;
create trigger default_field_order_completion_outcome
before insert or update on public.field_order_progress
for each row execute function kiara_private.tg_default_completion_outcome();

-- Existing completions predate the question and therefore mean the original
-- successful-completion path. Backfill before installing the invariant.
-- Cancelled orders are immutable through the normal workflow trigger. This is
-- a one-time metadata backfill, so suspend that trigger transactionally and
-- restore it before committing; any error rolls the disable back as well.
begin;
alter table public.field_order_progress
  disable trigger reject_cancelled_field_progress_update;
update public.field_order_progress
set completion_outcome = 'done'
where completed_at is not null
  and completion_outcome is null;
alter table public.field_order_progress
  enable trigger reject_cancelled_field_progress_update;
commit;

alter table public.field_order_progress
  drop constraint if exists field_order_progress_completion_outcome_check;
alter table public.field_order_progress
  add constraint field_order_progress_completion_outcome_check check (
    (completed_at is null and completion_outcome is null and completion_note is null)
    or (
      completed_at is not null
      and completion_outcome in ('done', 'not_done')
      and (completion_note is null or char_length(completion_note) between 1 and 500)
    )
  );

-- Keep the old command available during a rolling mobile deploy. The new
-- wrapper adds the outcome atomically in the same transaction and enriches
-- the existing audit event. Old clients still record a normal `done` result.
create or replace function public.kiara_command_field_order_step_v2(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_actor_user_id uuid,
  p_field_staff_account_id uuid,
  p_role text,
  p_roster_id uuid,
  p_action text,
  p_location jsonb default null,
  p_completion_outcome text default null,
  p_completion_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_response jsonb;
  v_progress public.field_order_progress%rowtype;
  v_outcome text := nullif(btrim(coalesce(p_completion_outcome, '')), '');
  v_note text := nullif(btrim(coalesce(p_completion_note, '')), '');
begin
  if p_action = 'complete_order' then
    v_outcome := coalesce(v_outcome, 'done');
    if v_outcome not in ('done', 'not_done') then
      raise exception using errcode = 'P0001', message = 'FIELD_COMPLETION_OUTCOME_INVALID';
    end if;
    if v_note is not null and char_length(v_note) > 500 then
      raise exception using errcode = 'P0001', message = 'FIELD_COMPLETION_NOTE_INVALID';
    end if;
  elsif v_outcome is not null or v_note is not null then
    raise exception using errcode = 'P0001', message = 'FIELD_COMPLETION_ONLY';
  end if;

  v_response := public.kiara_command_field_order_step(
    p_restaurant_id, p_order_id, p_expected_version, p_idempotency_key,
    p_actor_user_id, p_field_staff_account_id, p_role, p_roster_id,
    p_action, p_location
  );

  if coalesce((v_response->>'replayed')::boolean, false) then
    return v_response;
  end if;

  if p_action = 'complete_order' then
    update public.field_order_progress
    set completion_outcome = v_outcome,
        completion_note = v_note,
        completion_recorded_by = p_field_staff_account_id
    where order_id = p_order_id
      and restaurant_id = p_restaurant_id
    returning * into v_progress;

    update public.operation_events
    set payload = payload || jsonb_build_object(
      'completionOutcome', v_outcome,
      'completionNote', v_note
    )
    where restaurant_id = p_restaurant_id
      and idempotency_key = p_idempotency_key
      and aggregate_id = p_order_id
      and event_type = 'field.complete_order';

    v_response := v_response || jsonb_build_object(
      'progress', to_jsonb(v_progress),
      'completionOutcome', v_outcome,
      'completionNote', v_note
    );
    update public.command_receipts
    set response = v_response
    where restaurant_id = p_restaurant_id
      and idempotency_key = p_idempotency_key;
  end if;

  return v_response;
end;
$$;

revoke all on function public.kiara_command_field_order_step_v2(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.kiara_command_field_order_step_v2(
  uuid, uuid, bigint, uuid, uuid, uuid, text, uuid, text, jsonb, text, text
) to service_role;
