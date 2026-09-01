-- Kiara was provisioned under a legacy technical account, while Hanan is the
-- actual product owner. Owner-only application capabilities intentionally rely
-- on restaurants.owner_id, so correct the source of truth instead of adding an
-- email-based authorization bypass in application code.
do $$
declare
  kiara_id constant uuid := '2ba8f6c8-aff9-4147-8f13-cdcb732de698';
  hanan_id uuid;
  current_owner_id uuid;
  current_owner_email text;
begin
  select r.owner_id, p.email
    into current_owner_id, current_owner_email
    from public.restaurants r
    left join public.profiles p on p.id = r.owner_id
   where r.id = kiara_id
   for update of r;

  -- Fresh and test databases may not contain the dedicated Kiara tenant yet.
  if current_owner_id is null then
    return;
  end if;

  select p.id
    into hanan_id
    from public.profiles p
   where lower(trim(p.email)) = 'hanan@kiara.com';

  if hanan_id is null then
    raise exception 'Cannot assign Kiara ownership: Hanan profile was not found';
  end if;

  if not exists (
    select 1
      from public.team_members tm
     where tm.restaurant_id = kiara_id
       and tm.user_id = hanan_id
       and tm.role = 'admin'
       and tm.is_active = true
  ) then
    raise exception 'Cannot assign Kiara ownership: Hanan is not an active Kiara admin';
  end if;

  -- Idempotent for databases where the correction has already been applied.
  if current_owner_id = hanan_id then
    return;
  end if;

  -- Refuse to silently replace an unexpected human owner in another database.
  if lower(coalesce(trim(current_owner_email), '')) <> 'kiara@nehgez.com' then
    raise exception 'Cannot assign Kiara ownership: unexpected current owner %',
      coalesce(current_owner_email, current_owner_id::text);
  end if;

  update public.restaurants
     set owner_id = hanan_id,
         updated_at = now()
   where id = kiara_id
     and owner_id = current_owner_id;
end
$$;
