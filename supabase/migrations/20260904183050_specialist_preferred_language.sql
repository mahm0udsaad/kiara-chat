-- A specialist's nationality and the language she reads are not always the
-- same thing. Keep an explicit, nullable override; null continues to derive
-- the language from nationality for existing roster rows.
alter table public.specialists
  add column if not exists preferred_language text;

alter table public.specialists
  drop constraint if exists specialists_preferred_language_check;

alter table public.specialists
  add constraint specialists_preferred_language_check
  check (
    preferred_language is null
    or preferred_language in ('ar', 'id', 'fil', 'ru', 'am')
  );

comment on column public.specialists.preferred_language is
  'BCP-47-style app/dispatch language override; null derives from nationality.';

-- Mira reads Amharic even though her roster nationality is currently Filipino.
-- Target the immutable UUID so similarly named people in other tenants are not
-- changed when this migration is replayed.
update public.specialists
set preferred_language = 'am', updated_at = now()
where id = '978f26b7-c0da-43df-8282-1d904a0d2659';
